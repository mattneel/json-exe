import { describe, expect, it } from "vitest";
import { defineExtensionType } from "@json-exe/runtime";
import {
  buildEscapeMap,
  buildSlotModule,
  collectSlotStrings,
  decodedToRawOffset,
  findValueRange,
  rawToDecodedOffset,
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

describe("buildSlotModule", () => {
  it("places the decoded source at bodyOffset", () => {
    const mod = buildSlotModule("declare const ctx: any;\n", "return ctx.value");
    expect(mod.content.slice(mod.bodyOffset, mod.bodyOffset + "return ctx.value".length)).toBe(
      "return ctx.value",
    );
    expect(mod.content).toContain("async function __slot__");
  });
});
