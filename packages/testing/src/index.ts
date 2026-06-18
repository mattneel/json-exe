/**
 * @json-exe/testing — run the `$tests` embedded in a JSON.exe extension.
 *
 * Each test names a slot, an input `ctx`, and either an expected return value
 * (`expect`) or an expected thrown error (`throws`).
 */
import {
  compileExtension,
  deepEqual,
  toJsonExeError,
  type CompileOptions,
  type ExtensionJson,
  type ExtensionTest,
  type ExtensionTypeSpec,
  type JsonExeErrorObject,
} from "@json-exe/runtime";

export interface TestCaseResult {
  name: string;
  slot: string;
  ok: boolean;
  expected?: unknown;
  actual?: unknown;
  error?: JsonExeErrorObject;
  message?: string;
  durationMs: number;
}

export interface TestReport {
  ok: boolean;
  passed: number;
  failed: number;
  total: number;
  tests: TestCaseResult[];
  /** Set when the extension failed to compile (all cases then fail). */
  compileError?: JsonExeErrorObject;
}

export interface TestExtensionOptions extends CompileOptions {
  /** Extra tests to run in addition to embedded `$tests` / spec.tests. */
  tests?: ExtensionTest[];
  /** Include `spec.tests` as well as the extension's `$tests` (default true). */
  includeSpecTests?: boolean;
}

function gatherTests(
  spec: ExtensionTypeSpec,
  ext: ExtensionJson,
  options: TestExtensionOptions,
): ExtensionTest[] {
  const embedded = Array.isArray(ext.$tests) ? ext.$tests : [];
  const specTests =
    options.includeSpecTests !== false && spec.tests ? spec.tests : [];
  const extra = options.tests ?? [];
  return [...embedded, ...specTests, ...extra];
}

/** Compile an extension and run all of its tests. */
export async function testExtension(
  spec: ExtensionTypeSpec,
  json: unknown,
  options: TestExtensionOptions = {},
): Promise<TestReport> {
  const ext = (json ?? {}) as ExtensionJson;
  const cases = gatherTests(spec, ext, options);

  let compiled;
  try {
    compiled = await compileExtension(spec, json, options);
  } catch (err) {
    const compileError = toJsonExeError(err, "<compile>").toJSON();
    const tests: TestCaseResult[] = cases.map((c) => ({
      name: c.name,
      slot: c.slot,
      ok: false,
      error: compileError,
      message: "Extension failed to compile.",
      durationMs: 0,
    }));
    return {
      ok: false,
      passed: 0,
      failed: tests.length,
      total: tests.length,
      tests,
      compileError,
    };
  }

  const results: TestCaseResult[] = [];
  for (const test of cases) {
    const start = performance.now();
    const res = await compiled.exec(test.slot, test.ctx);
    const durationMs = performance.now() - start;

    const base: TestCaseResult = {
      name: test.name,
      slot: test.slot,
      ok: false,
      durationMs,
    };

    if (test.throws !== undefined) {
      const threw = !res.ok;
      const kindMatches =
        typeof test.throws === "string"
          ? res.error?.kind === test.throws
          : true;
      base.ok = threw && kindMatches;
      if (res.error) base.error = res.error;
      if (!base.ok) {
        base.message = threw
          ? `Expected error kind "${String(test.throws)}" but got "${res.error?.kind}".`
          : "Expected the slot to throw, but it returned a value.";
        if (!threw) base.actual = res.result;
      }
    } else if (Object.prototype.hasOwnProperty.call(test, "expect")) {
      if (!res.ok) {
        base.ok = false;
        if (res.error) base.error = res.error;
        base.expected = test.expect;
        base.message = res.error?.message ?? "Slot threw an error.";
      } else {
        base.ok = deepEqual(res.result, test.expect);
        base.expected = test.expect;
        base.actual = res.result;
        if (!base.ok) base.message = "Result did not match expected value.";
      }
    } else {
      // No assertion: pass if the slot ran without error.
      base.ok = res.ok;
      if (!res.ok && res.error) {
        base.error = res.error;
        base.message = res.error.message;
      }
      if (res.ok) base.actual = res.result;
    }

    results.push(base);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    passed,
    failed,
    total: results.length,
    tests: results,
  };
}
