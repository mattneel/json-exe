import { describe, expect, it } from "vitest";
import {
  compileExtension,
  createRuntime,
  defineExtensionType,
  runSlot,
  Trace,
  validateExtension,
} from "@json-exe/runtime";

const formValidator = defineExtensionType({
  kind: "form-validator/v1",
  context: {
    value: "unknown",
    field: "Field",
    form: "Record<string, unknown>",
  },
  slots: {
    validate: { required: true, returns: { type: "boolean" } },
    message: { returns: { type: "string" } },
    severity: { returns: { enum: ["info", "warning", "error"] } },
  },
});

const requiredEmail = {
  $kind: "form-validator/v1",
  id: "required-email",
  validate:
    "return typeof ctx.value === 'string' && ctx.value.includes('@')",
  message: "return 'Please enter a valid email address.'",
  severity: "return 'error'",
};

describe("defineExtensionType", () => {
  it("returns the spec unchanged", () => {
    expect(formValidator.kind).toBe("form-validator/v1");
  });

  it("throws when kind is missing", () => {
    // @ts-expect-error intentional bad spec
    expect(() => defineExtensionType({ slots: {} })).toThrow();
  });
});

describe("compileExtension + run (the core loop)", () => {
  it("compiles and runs the form-validator example", async () => {
    const ext = await compileExtension(formValidator, requiredEmail);
    expect(ext.kind).toBe("form-validator/v1");
    expect(ext.id).toBe("required-email");
    expect(await ext.run("validate", { value: "matt@example.com" })).toBe(true);
    expect(await ext.run("validate", { value: "nope" })).toBe(false);
    expect(await ext.run<string>("message")).toContain("email");
    expect(await ext.run<string>("severity")).toBe("error");
  });

  it("has() and slots() report slot info", async () => {
    const ext = await compileExtension(formValidator, requiredEmail);
    expect(ext.has("validate")).toBe(true);
    expect(ext.has("missing")).toBe(false);
    const slots = ext.slots();
    const validate = slots.find((s) => s.name === "validate");
    expect(validate).toMatchObject({ required: true, compiled: true });
  });

  it("throws KindMismatchError when $kind differs", async () => {
    await expect(
      compileExtension(formValidator, { ...requiredEmail, $kind: "other/v1" }),
    ).rejects.toMatchObject({ kind: "KindMismatchError" });
  });

  it("throws MissingRequiredSlotError when a required slot is absent", async () => {
    await expect(
      compileExtension(formValidator, { $kind: "form-validator/v1" }),
    ).rejects.toMatchObject({ kind: "MissingRequiredSlotError", slot: "validate" });
  });

  it("throws SlotCompileError on syntax errors", async () => {
    await expect(
      compileExtension(formValidator, {
        $kind: "form-validator/v1",
        validate: "return (",
      }),
    ).rejects.toMatchObject({ kind: "SlotCompileError", slot: "validate" });
  });

  it("throws SlotCompileError when a slot field is not a string", async () => {
    await expect(
      compileExtension(formValidator, {
        $kind: "form-validator/v1",
        validate: 123,
      }),
    ).rejects.toMatchObject({ kind: "SlotCompileError", slot: "validate" });
  });
});

describe("return validation", () => {
  const spec = defineExtensionType({
    kind: "rv/v1",
    slots: { validate: { required: true, returns: { type: "boolean" } } },
  });

  it("throws ReturnValidationError when run() gets a wrong type", async () => {
    const ext = await compileExtension(spec, {
      $kind: "rv/v1",
      validate: "return 'yes'",
    });
    await expect(ext.run("validate")).rejects.toMatchObject({
      kind: "ReturnValidationError",
      slot: "validate",
      expected: "boolean",
      received: "string",
    });
  });

  it("exec() returns an envelope instead of throwing", async () => {
    const ext = await compileExtension(spec, {
      $kind: "rv/v1",
      validate: "return 'yes'",
    });
    const res = await ext.exec("validate");
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("ReturnValidationError");
    expect(res.trace?.validation?.ok).toBe(false);
  });

  it("can be disabled with validateReturns: false", async () => {
    const ext = await compileExtension(
      spec,
      { $kind: "rv/v1", validate: "return 'yes'" },
      { validateReturns: false },
    );
    expect(await ext.run("validate")).toBe("yes");
  });
});

describe("tracing", () => {
  it("attaches a trace record to the result with trace:true", async () => {
    const ext = await compileExtension(formValidator, requiredEmail);
    const res = await ext.exec("validate", { value: "a@b.co" }, { trace: true });
    expect(res.trace).toBeDefined();
    expect(res.trace?.slot).toBe("validate");
    expect(res.trace?.ok).toBe(true);
    expect(typeof res.trace?.durationMs).toBe("number");
    expect(res.trace?.validation).toEqual({ ok: true });
    expect(typeof res.trace?.startedAt).toBe("string");
  });

  it("accumulates records in a shared Trace sink", async () => {
    const ext = await compileExtension(formValidator, requiredEmail);
    const trace = new Trace();
    await ext.run("validate", { value: "a@b.co" }, { trace });
    await ext.run("message", {}, { trace });
    expect(trace.records).toHaveLength(2);
    expect(trace.ok).toBe(true);
    expect(trace.last?.slot).toBe("message");
  });
});

describe("async slots", () => {
  const spec = defineExtensionType({
    kind: "agent/v1",
    slots: {
      toolCall: { async: true, returns: { type: "object" } },
    },
  });

  it("awaits ctx capabilities", async () => {
    const ext = await compileExtension(spec, {
      $kind: "agent/v1",
      toolCall:
        "const r = await ctx.tools.search({ q: ctx.input }); return { items: r };",
    });
    const result = await ext.run("toolCall", {
      input: "hi",
      tools: { search: async ({ q }: { q: string }) => [q, q] },
    });
    expect(result).toEqual({ items: ["hi", "hi"] });
  });

  it("rejects await inside a sync slot at compile time", async () => {
    const syncSpec = defineExtensionType({
      kind: "sync/v1",
      slots: { go: { returns: "unknown" } },
    });
    await expect(
      compileExtension(syncSpec, { $kind: "sync/v1", go: "return await 1" }),
    ).rejects.toMatchObject({ kind: "SlotCompileError" });
  });
});

describe("timeout", () => {
  const spec = defineExtensionType({
    kind: "to/v1",
    slots: { slow: { async: true, timeoutMs: 20, returns: "unknown" } },
  });

  it("produces a TimeoutError for a slot that never resolves", async () => {
    const ext = await compileExtension(spec, {
      $kind: "to/v1",
      slow: "await new Promise(() => {}); return 1;",
    });
    const res = await ext.exec("slow");
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("TimeoutError");
    expect(res.error?.timeoutMs).toBe(20);
  });
});

describe("freezeContext", () => {
  it("makes ctx immutable so mutation throws", async () => {
    const ext = await compileExtension(
      formValidator,
      { $kind: "form-validator/v1", validate: "ctx.touched = true; return true" },
      { freezeContext: true },
    );
    const res = await ext.exec("validate", { value: 1 });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("SlotRuntimeError");
  });
});

describe("dotted and nested slot names", () => {
  const spec = defineExtensionType({
    kind: "nested/v1",
    slots: {
      "state.init": { returns: { type: "object" } },
      "tool.search": { returns: { type: "object" } },
    },
  });

  it("resolves flat dotted keys", async () => {
    const ext = await compileExtension(spec, {
      $kind: "nested/v1",
      "state.init": "return { count: 0 }",
      "tool.search": "return { query: ctx.input }",
    });
    expect(await ext.run("state.init")).toEqual({ count: 0 });
    expect(await ext.run("tool.search", { input: "q" })).toEqual({ query: "q" });
  });

  it("resolves nested objects to the same canonical paths", async () => {
    const ext = await compileExtension(spec, {
      $kind: "nested/v1",
      state: { init: "return { count: 1 }" },
      tool: { search: "return { query: 'x' }" },
    });
    expect(await ext.run("state.init")).toEqual({ count: 1 });
    expect(await ext.run("tool.search")).toEqual({ query: "x" });
  });
});

describe("runtime error location mapping", () => {
  it("maps a thrown error to the slot source line (best effort)", async () => {
    const spec = defineExtensionType({
      kind: "err/v1",
      slots: { boom: { returns: "unknown" } },
    });
    const ext = await compileExtension(spec, {
      $kind: "err/v1",
      boom: "const a = 1;\nthrow new Error('boom');",
    });
    const res = await ext.exec("boom");
    expect(res.error?.kind).toBe("SlotRuntimeError");
    expect(res.error?.message).toContain("boom");
    // Line mapping is best-effort; if present it must be correct (line 2).
    if (res.error?.line !== undefined) {
      expect(res.error.line).toBe(2);
    }
  });
});

describe("validateExtension (non-throwing)", () => {
  it("returns ok:true for a valid extension", () => {
    expect(validateExtension(formValidator, requiredEmail).ok).toBe(true);
  });

  it("collects multiple errors", () => {
    const result = validateExtension(formValidator, {
      $kind: "wrong/v1",
      severity: "return 'nope-not-a-slot-issue'",
    });
    expect(result.ok).toBe(false);
    const kinds = result.errors.map((e) => e.kind);
    expect(kinds).toContain("KindMismatchError");
    expect(kinds).toContain("MissingRequiredSlotError");
  });
});

describe("unknown-slot policy", () => {
  const spec = defineExtensionType({
    kind: "u/v1",
    slots: { go: { returns: "boolean" } },
    unknownSlots: "error",
  });

  it("rejects undeclared string fields when policy is error", () => {
    const result = validateExtension(spec, {
      $kind: "u/v1",
      go: "return true",
      sneaky: "return 'i am not declared'",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.kind === "UnknownSlotError")).toBe(true);
  });

  it("allows standard metadata fields", () => {
    const result = validateExtension(spec, {
      $kind: "u/v1",
      id: "x",
      name: "X",
      description: "desc",
      go: "return true",
    });
    expect(result.ok).toBe(true);
  });
});

describe("permissions", () => {
  const spec = defineExtensionType({
    kind: "p/v1",
    slots: { go: { returns: "boolean" } },
  });
  const json = {
    $kind: "p/v1",
    $permissions: { tools: ["search", "danger"] },
    go: "return true",
  };

  it("flags declared permissions not granted by the host", () => {
    const result = validateExtension(spec, json, {
      grantedPermissions: { tools: ["search"] },
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.kind === "PermissionError" && e.permission === "tools.danger",
      ),
    ).toBe(true);
  });

  it("compileExtension throws PermissionError on over-reach", async () => {
    await expect(
      compileExtension(spec, json, {
        grantedPermissions: { tools: ["search"] },
      }),
    ).rejects.toMatchObject({ kind: "PermissionError" });
  });
});

describe("error context (SPEC §11: phase + traceId)", () => {
  const spec = defineExtensionType({
    kind: "ph/v1",
    slots: { run: { phase: "run", returns: { type: "object" } } },
  });

  it("populates phase and traceId on errors and matches the trace record", async () => {
    const ext = await compileExtension(spec, {
      $kind: "ph/v1",
      run: "throw new Error('boom')",
    });
    const res = await ext.exec("run");
    expect(res.ok).toBe(false);
    expect(res.error?.phase).toBe("run");
    expect(typeof res.error?.traceId).toBe("string");
    expect(res.error?.traceId).toBe(res.trace?.traceId);
  });

  it("includes the precise validation reason in ReturnValidationError", async () => {
    const ext = await compileExtension(spec, {
      $kind: "ph/v1",
      run: "return { tool: 'x' }",
    });
    // returns must be an object with required keys:
    const strict = defineExtensionType({
      kind: "ph2/v1",
      slots: {
        run: { returns: { type: "object", required: ["tool", "args"] } },
      },
    });
    const ext2 = await compileExtension(strict, {
      $kind: "ph2/v1",
      run: "return { tool: 'x' }",
    });
    const res = await ext2.exec("run");
    expect(res.error?.kind).toBe("ReturnValidationError");
    expect(res.error?.message).toContain("args");
  });
});

describe("getSlotSource prototype-chain safety", () => {
  const spec = defineExtensionType({
    kind: "proto/v1",
    slots: { "handlers.toString": { returns: "unknown" } },
  });

  it("does not resolve inherited Object.prototype members as slot source", () => {
    // Leaf 'toString' is absent; must not pick up Object.prototype.toString.
    const result = validateExtension(spec, {
      $kind: "proto/v1",
      handlers: { onClick: "return 1" },
    });
    expect(result.ok).toBe(true);
  });
});

describe("permission enforcement modes", () => {
  const spec = defineExtensionType({
    kind: "perm/v1",
    slots: { go: { returns: "boolean" } },
  });
  const json = {
    $kind: "perm/v1",
    $permissions: { tools: ["search"] },
    go: "return true",
  };

  it("skips the check by default (trusting) when no grants are given", () => {
    expect(validateExtension(spec, json).ok).toBe(true);
  });

  it("enforces deny-all when enforcePermissions is set without grants", () => {
    const result = validateExtension(spec, json, { enforcePermissions: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.kind === "PermissionError")).toBe(true);
  });
});

describe("runSlot one-shot + createRuntime", () => {
  it("runSlot compiles and runs in one call", async () => {
    const ok = await runSlot<boolean>(
      formValidator,
      requiredEmail,
      "validate",
      { value: "a@b.com" },
    );
    expect(ok).toBe(true);
  });

  it("createRuntime applies default options", async () => {
    const runtime = createRuntime({ freezeContext: true });
    const ext = await runtime.compile(formValidator, {
      $kind: "form-validator/v1",
      validate: "ctx.x = 1; return true",
    });
    const res = await ext.exec("validate", { value: 1 });
    expect(res.ok).toBe(false);
    expect(runtime.validate(formValidator, requiredEmail).ok).toBe(true);
  });
});
