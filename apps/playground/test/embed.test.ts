import { describe, expect, it } from "vitest";
import { defineExtensionType } from "@json-exe/runtime";
import {
  buildEscapeMap,
  buildSlotModule,
  collectSlotStrings,
  decodedToRawOffset,
  findValueRange,
  rawToDecodedOffset,
  schemaToTsType,
  specToJsonSchema,
  synthesizeCtxDecls,
} from "../src/lib/embed";

describe("buildEscapeMap", () => {
  it("decodes escapes and maps offsets both ways", () => {
    const raw = "a\\nb"; // JSON source chars: a \ n b
    const map = buildEscapeMap(raw);
    expect(map.decoded).toBe("a\nb"); // real newline
    expect(map.decodedToRaw).toEqual([0, 1, 3, 4]);

    // decoded offset -> raw offset
    expect(decodedToRawOffset(map, 0)).toBe(0);
    expect(decodedToRawOffset(map, 1)).toBe(1); // the '\n' starts at raw 1
    expect(decodedToRawOffset(map, 2)).toBe(3); // 'b' at raw 3
    expect(decodedToRawOffset(map, 3)).toBe(4); // end

    // raw offset -> decoded offset
    expect(rawToDecodedOffset(map, 0)).toBe(0);
    expect(rawToDecodedOffset(map, 1)).toBe(1);
    expect(rawToDecodedOffset(map, 2)).toBe(1); // inside the escape
    expect(rawToDecodedOffset(map, 3)).toBe(2);
    expect(rawToDecodedOffset(map, 4)).toBe(3);
  });

  it("handles quotes, backslashes, and unicode escapes", () => {
    const raw = '\\"\\\\\\u0041'; // JSON source for: " \ A
    const map = buildEscapeMap(raw);
    expect(map.decoded).toBe('"\\A');
    // round-trip a couple of offsets
    expect(decodedToRawOffset(map, 0)).toBe(0);
    expect(map.decoded.length).toBe(3);
  });

  it("is identity for an unescaped string", () => {
    const map = buildEscapeMap("return ctx.value");
    expect(map.decoded).toBe("return ctx.value");
    expect(decodedToRawOffset(map, 7)).toBe(7);
    expect(rawToDecodedOffset(map, 7)).toBe(7);
  });

  it("does not overshoot on a truncated \\u escape", () => {
    const map = buildEscapeMap("\\u12"); // invalid: only 2 hex digits
    expect(map.decoded).toBe("u12");
    expect(map.decodedToRaw).toEqual([0, 2, 3, 4]);
  });
});

describe("synthesizeCtxDecls", () => {
  const spec = defineExtensionType({
    kind: "x/v1",
    context: {
      value: "unknown",
      user: "User | null",
      form: "Record<string, unknown>",
    },
    slots: { validate: { returns: { type: "boolean" } } },
  });

  it("declares ctx and aliases unknown capitalized types to any", () => {
    const decls = synthesizeCtxDecls(spec);
    expect(decls).toContain("declare const ctx: {");
    expect(decls).toContain('"value": unknown;');
    expect(decls).toContain('"user": User | null;');
    expect(decls).toContain("type User = any;");
    // Built-ins are not aliased.
    expect(decls).not.toContain("type Record = any;");
  });

  it("falls back to an index signature when no context is declared", () => {
    const bare = defineExtensionType({ kind: "y/v1", slots: {} });
    expect(synthesizeCtxDecls(bare)).toContain("[key: string]: unknown;");
  });

  it("aliases lowercase custom type names too (not just capitalized)", () => {
    const s = defineExtensionType({
      kind: "z/v1",
      context: { widget: "myWidget", count: "number" },
      slots: {},
    });
    const decls = synthesizeCtxDecls(s);
    expect(decls).toContain("type myWidget = any;");
    expect(decls).not.toContain("type number = any;");
  });
});

describe("specToJsonSchema", () => {
  const spec = defineExtensionType({
    kind: "form-validator/v1",
    staticFields: { id: { required: true, schema: { type: "string" } } },
    slots: {
      validate: { required: true, returns: { type: "boolean" }, description: "is it valid" },
      message: { returns: { type: "string" } },
    },
  });

  it("produces a lenient schema with slot keys, $kind default, and static fields", () => {
    const schema = specToJsonSchema(spec) as {
      type: string;
      additionalProperties: boolean;
      properties: Record<string, { default?: string }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(true);
    expect(schema.properties.$kind?.default).toBe("form-validator/v1");
    expect(schema.properties.validate).toBeDefined();
    expect(schema.properties.message).toBeDefined();
    expect(schema.properties.id).toBeDefined();
  });
});

describe("collectSlotStrings", () => {
  const slots = new Set(["validate", "state.init", "tool.search"]);
  const text = `{
  "$kind": "k",
  "validate": "return 1",
  "state.init": "return 2",
  "tool": { "search": "return 3" },
  "id": "x"
}`;

  it("finds flat dotted keys and nested objects, ignoring non-slots", () => {
    const found = collectSlotStrings(text, slots);
    const names = found.map((f) => f.slot).sort();
    expect(names).toEqual(["state.init", "tool.search", "validate"]);
    for (const f of found) {
      // The content slice must be exactly the JS source.
      const content = text.slice(f.start, f.end);
      expect(content.startsWith("return ")).toBe(true);
    }
  });

  it("returns nothing for invalid JSON", () => {
    expect(collectSlotStrings("{ not json", slots)).toEqual([]);
  });
});

describe("findValueRange", () => {
  it("locates a top-level value including quotes", () => {
    const text = `{ "$kind": "form-validator/v1" }`;
    const range = findValueRange(text, "$kind");
    expect(range).toBeDefined();
    expect(text.slice(range!.start, range!.end)).toBe('"form-validator/v1"');
  });
});

describe("schemaToTsType", () => {
  it("maps primitives", () => {
    expect(schemaToTsType("boolean")).toBe("boolean");
    expect(schemaToTsType({ type: "string" })).toBe("string");
    expect(schemaToTsType({ type: "integer" })).toBe("number");
    expect(schemaToTsType({ type: "object" })).toBe("Record<string, unknown>");
    expect(schemaToTsType(undefined)).toBe("unknown");
    expect(schemaToTsType("unknown")).toBe("unknown");
  });

  it("maps enums to string-literal unions", () => {
    expect(schemaToTsType({ enum: ["info", "warning", "error"] })).toBe(
      '"info" | "warning" | "error"',
    );
  });

  it("maps const, unions, arrays, and nullable", () => {
    expect(schemaToTsType({ const: 42 })).toBe("42");
    expect(schemaToTsType({ type: ["string", "number"] })).toBe("string | number");
    expect(schemaToTsType({ type: "array", items: "string" })).toBe("Array<string>");
    expect(schemaToTsType({ type: "string", nullable: true })).toBe("string | null");
  });
});

describe("buildSlotModule", () => {
  it("places the decoded source at bodyOffset", () => {
    const mod = buildSlotModule("declare const ctx: any;\n", "return ctx.value");
    expect(mod.content.slice(mod.bodyOffset, mod.bodyOffset + "return ctx.value".length)).toBe(
      "return ctx.value",
    );
    expect(mod.content).toContain("async function __slot__");
  });

  it("annotates the wrapper return type from the schema", () => {
    const mod = buildSlotModule("", "return true", "boolean");
    expect(mod.content).toContain("Promise<boolean>");
  });
});
