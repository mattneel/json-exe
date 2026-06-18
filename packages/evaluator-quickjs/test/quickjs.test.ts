import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileExtension, defineExtensionType } from "@json-exe/runtime";
import { createQuickJSEvaluator, type QuickJSEvaluator } from "../src/index";

let evaluator: QuickJSEvaluator;

beforeAll(async () => {
  evaluator = await createQuickJSEvaluator({ deadlineMs: 2000 });
});
afterAll(() => evaluator.dispose());

describe("QuickJS evaluator", () => {
  it("runs a sync slot in the sandbox", async () => {
    const spec = defineExtensionType({
      kind: "fv/v1",
      slots: { validate: { required: true, returns: { type: "boolean" } } },
    });
    const ext = await compileExtension(
      spec,
      {
        $kind: "fv/v1",
        validate: "return typeof ctx.value === 'string' && ctx.value.includes('@')",
      },
      { evaluator },
    );
    expect(await ext.run("validate", { value: "a@b.com" })).toBe(true);
    expect(await ext.run("validate", { value: "nope" })).toBe(false);
  });

  it("returns objects across the boundary", async () => {
    const spec = defineExtensionType({
      kind: "dt/v1",
      slots: { map: { required: true, returns: { type: "object" } } },
    });
    const ext = await compileExtension(
      spec,
      {
        $kind: "dt/v1",
        map: "return { id: String(ctx.row.id), email: String(ctx.row.email).toLowerCase() }",
      },
      { evaluator },
    );
    expect(await ext.run("map", { row: { id: 7, email: "A@B.COM" } })).toEqual({
      id: "7",
      email: "a@b.com",
    });
  });

  it("calls sync host capabilities exposed on ctx", async () => {
    const spec = defineExtensionType({
      kind: "h/v1",
      slots: { go: { returns: { type: "string" } } },
    });
    const ext = await compileExtension(
      spec,
      { $kind: "h/v1", go: "return ctx.helpers.up(ctx.input)" },
      { evaluator },
    );
    const out = await ext.run("go", {
      input: "hello",
      helpers: { up: (s: string) => s.toUpperCase() },
    });
    expect(out).toBe("HELLO");
  });

  it("awaits async host capabilities in async slots", async () => {
    const spec = defineExtensionType({
      kind: "agent/v1",
      slots: { toolCall: { async: true, returns: { type: "object" } } },
    });
    const ext = await compileExtension(
      spec,
      {
        $kind: "agent/v1",
        toolCall: "const r = await ctx.tools.search({ q: ctx.input }); return { items: r.items };",
      },
      { evaluator },
    );
    const out = await ext.run("toolCall", {
      input: "vaccines",
      tools: { search: async ({ q }: { q: string }) => ({ items: [q, q] }) },
    });
    expect(out).toEqual({ items: ["vaccines", "vaccines"] });
  });

  it("isolates slot code from host globals", async () => {
    const spec = defineExtensionType({
      kind: "iso/v1",
      slots: { probe: { returns: { type: "string" } } },
    });
    const ext = await compileExtension(
      spec,
      {
        $kind: "iso/v1",
        probe:
          "return [typeof process, typeof globalThis.fetch, typeof require].join(',')",
      },
      { evaluator },
    );
    expect(await ext.run("probe")).toBe("undefined,undefined,undefined");
  });

  it("interrupts infinite loops via the CPU deadline (does not hang)", async () => {
    const fast = await createQuickJSEvaluator({
      module: evaluator.module,
      deadlineMs: 150,
    });
    const spec = defineExtensionType({
      kind: "loop/v1",
      slots: { spin: { returns: "unknown" } },
    });
    const ext = await compileExtension(
      spec,
      { $kind: "loop/v1", spin: "while (true) {}\nreturn 1;" },
      { evaluator: fast },
    );
    const res = await ext.exec("spin");
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("TimeoutError");
  });

  it("still validates return values through the sandbox", async () => {
    const spec = defineExtensionType({
      kind: "rv/v1",
      slots: { validate: { returns: { type: "boolean" } } },
    });
    const ext = await compileExtension(
      spec,
      { $kind: "rv/v1", validate: "return 'yes'" },
      { evaluator },
    );
    const res = await ext.exec("validate");
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("ReturnValidationError");
  });
});
