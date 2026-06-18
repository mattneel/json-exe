import { describe, expect, it } from "vitest";
import { defineExtensionType } from "@json-exe/runtime";
import { testExtension } from "@json-exe/testing";

const spec = defineExtensionType({
  kind: "form-validator/v1",
  slots: {
    validate: { required: true, returns: { type: "boolean" } },
  },
});

describe("testExtension", () => {
  it("runs embedded $tests and reports pass/fail", async () => {
    const report = await testExtension(spec, {
      $kind: "form-validator/v1",
      id: "email-validator",
      validate:
        "return typeof ctx.value === 'string' && ctx.value.includes('@')",
      $tests: [
        {
          name: "valid email",
          ctx: { value: "matt@example.com" },
          slot: "validate",
          expect: true,
        },
        {
          name: "invalid email",
          ctx: { value: "nope" },
          slot: "validate",
          expect: false,
        },
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.total).toBe(2);
    expect(report.tests.map((t) => t.ok)).toEqual([true, true]);
  });

  it("reports failures with expected/actual", async () => {
    const report = await testExtension(spec, {
      $kind: "form-validator/v1",
      validate: "return ctx.value === 'x'",
      $tests: [
        { name: "wrong", ctx: { value: "y" }, slot: "validate", expect: true },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.failed).toBe(1);
    expect(report.tests[0]?.expected).toBe(true);
    expect(report.tests[0]?.actual).toBe(false);
  });

  it("supports `throws` assertions", async () => {
    const report = await testExtension(spec, {
      $kind: "form-validator/v1",
      validate: "return 'not a boolean'",
      $tests: [
        {
          name: "expects return validation error",
          slot: "validate",
          throws: "ReturnValidationError",
        },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.tests[0]?.ok).toBe(true);
  });

  it("marks all tests failed when compilation fails", async () => {
    const report = await testExtension(spec, {
      $kind: "form-validator/v1",
      validate: "return (",
      $tests: [{ name: "t", slot: "validate", expect: true }],
    });
    expect(report.ok).toBe(false);
    expect(report.compileError?.kind).toBe("SlotCompileError");
    expect(report.tests[0]?.ok).toBe(false);
  });

  it("accepts extra tests via options", async () => {
    const report = await testExtension(
      spec,
      {
        $kind: "form-validator/v1",
        validate: "return ctx.value.length > 0",
      },
      {
        tests: [
          { name: "non-empty", slot: "validate", ctx: { value: "a" }, expect: true },
        ],
      },
    );
    expect(report.ok).toBe(true);
    expect(report.total).toBe(1);
  });
});
