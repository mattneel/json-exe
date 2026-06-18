import { describe, expect, it } from "vitest";
import {
  deepEqual,
  describeType,
  validateAgainstSchema,
} from "@json-exe/runtime";

describe("validateAgainstSchema", () => {
  it("validates string-shorthand primitive types", () => {
    expect(validateAgainstSchema("boolean", true).ok).toBe(true);
    expect(validateAgainstSchema("boolean", false).ok).toBe(true);
    const bad = validateAgainstSchema("boolean", "yes");
    expect(bad.ok).toBe(false);
    expect(bad.expected).toBe("boolean");
    expect(bad.received).toBe("string");
  });

  it("treats unknown/any and unrecognized type names as unconstrained", () => {
    expect(validateAgainstSchema("unknown", 123).ok).toBe(true);
    expect(validateAgainstSchema("any", null).ok).toBe(true);
    expect(validateAgainstSchema("Field", { anything: true }).ok).toBe(true);
  });

  it("validates object type with required keys", () => {
    const schema = { type: "object", required: ["tool", "args"] } as const;
    expect(validateAgainstSchema(schema, { tool: "search", args: {} }).ok).toBe(
      true,
    );
    const missing = validateAgainstSchema(schema, { tool: "search" });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("args");
  });

  it("rejects arrays and null for object type", () => {
    expect(validateAgainstSchema("object", []).ok).toBe(false);
    expect(validateAgainstSchema("object", null).ok).toBe(false);
  });

  it("validates enums by deep value", () => {
    const schema = { enum: ["info", "warning", "error"] } as const;
    expect(validateAgainstSchema(schema, "warning").ok).toBe(true);
    expect(validateAgainstSchema(schema, "fatal").ok).toBe(false);
  });

  it("validates const", () => {
    expect(validateAgainstSchema({ const: 42 }, 42).ok).toBe(true);
    expect(validateAgainstSchema({ const: 42 }, 43).ok).toBe(false);
  });

  it("supports type unions and nullable", () => {
    expect(validateAgainstSchema({ type: ["string", "number"] }, 1).ok).toBe(
      true,
    );
    expect(validateAgainstSchema({ type: ["string", "number"] }, true).ok).toBe(
      false,
    );
    expect(validateAgainstSchema({ type: "string", nullable: true }, null).ok).toBe(
      true,
    );
    expect(validateAgainstSchema({ type: "string" }, null).ok).toBe(false);
  });

  it("validates integers vs numbers", () => {
    expect(validateAgainstSchema("integer", 3).ok).toBe(true);
    expect(validateAgainstSchema("integer", 3.5).ok).toBe(false);
    expect(validateAgainstSchema("number", 3.5).ok).toBe(true);
    expect(validateAgainstSchema("number", Number.NaN).ok).toBe(false);
  });

  it("validates array items", () => {
    const schema = { type: "array", items: "string" } as const;
    expect(validateAgainstSchema(schema, ["a", "b"]).ok).toBe(true);
    expect(validateAgainstSchema(schema, ["a", 2]).ok).toBe(false);
  });

  it("validates nested properties and additionalProperties", () => {
    const schema = {
      type: "object",
      properties: { id: "string", n: "number" },
      additionalProperties: false,
    } as const;
    expect(validateAgainstSchema(schema, { id: "x", n: 1 }).ok).toBe(true);
    expect(validateAgainstSchema(schema, { id: "x", n: "no" }).ok).toBe(false);
    expect(validateAgainstSchema(schema, { id: "x", extra: 1 }).ok).toBe(false);
  });
});

describe("validateAgainstSchema — null / const / enum / additionalProperties edge cases", () => {
  it("accepts null as a const or enum member", () => {
    expect(validateAgainstSchema({ const: null }, null).ok).toBe(true);
    expect(validateAgainstSchema({ enum: [null, "x"] }, null).ok).toBe(true);
    expect(validateAgainstSchema({ enum: [1, 2] }, null).ok).toBe(false);
  });

  it("does not let null bypass object/array constraints", () => {
    expect(
      validateAgainstSchema({ required: ["a"], properties: { a: "string" } }, null).ok,
    ).toBe(false);
    expect(validateAgainstSchema({ items: "string" }, null).ok).toBe(false);
  });

  it("still allows null for a truly unconstrained schema", () => {
    expect(validateAgainstSchema({}, null).ok).toBe(true);
    expect(validateAgainstSchema("unknown", null).ok).toBe(true);
    expect(validateAgainstSchema({ type: "string", nullable: true }, null).ok).toBe(
      true,
    );
  });

  it("enforces additionalProperties:false even without a properties map", () => {
    expect(
      validateAgainstSchema({ type: "object", additionalProperties: false }, {}).ok,
    ).toBe(true);
    expect(
      validateAgainstSchema(
        { type: "object", additionalProperties: false },
        { extra: 1 },
      ).ok,
    ).toBe(false);
  });

  it("const/enum win over a contradictory nullable/type:null", () => {
    expect(validateAgainstSchema({ type: "null", const: 5 }, null).ok).toBe(false);
    expect(validateAgainstSchema({ nullable: true, enum: [1, 2] }, null).ok).toBe(
      false,
    );
  });
});

describe("describeType", () => {
  it("refines null, array, NaN", () => {
    expect(describeType(null)).toBe("null");
    expect(describeType([])).toBe("array");
    expect(describeType(Number.NaN)).toBe("NaN");
    expect(describeType("x")).toBe("string");
    expect(describeType({})).toBe("object");
  });
});

describe("deepEqual", () => {
  it("compares nested structures", () => {
    expect(deepEqual({ a: [1, 2], b: { c: 3 } }, { a: [1, 2], b: { c: 3 } })).toBe(
      true,
    );
    expect(deepEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
  });
});
