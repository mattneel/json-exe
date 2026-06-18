/**
 * The default development evaluator.
 *
 * It compiles slot source with `new Function`. This is NOT a sandbox: the code
 * runs with the full privileges of the host process. Use it only for trusted /
 * local / admin-authored extensions and tests. Production deployments should
 * supply an isolated {@link Evaluator} (worker, subprocess, QuickJS, …).
 */
import type { CompileInput, CompiledFn, Evaluator } from "./types";
import { JsonExeError, SlotCompileError, SlotRuntimeError } from "./errors";
import { errorMessage } from "./util";

/**
 * Source-line mapping
 * -------------------
 * `new Function(arg, body)` wraps the body inside a `function anonymous(...)`
 * whose header occupies a fixed, V8-specific number of lines before the body.
 * Rather than hardcode that offset we calibrate it once at runtime by compiling
 * a probe whose user-source line 1 throws, then read the reported line number.
 * If calibration fails for any reason, line mapping is silently disabled (we
 * never report a guessed/wrong location).
 */

let syncOffset: number | null | undefined;

function frameLineCol(stack: string | undefined): {
  line?: number;
  column?: number;
} {
  if (!stack) return {};
  const m = stack.match(/<anonymous>:(\d+):(\d+)/);
  if (!m) return {};
  return { line: Number(m[1]), column: Number(m[2]) };
}

function calibrate(): number | null {
  try {
    // User source = line 1 of the body after the `"use strict";` prefix line.
    // eslint-disable-next-line no-new-func
    const probe = new Function(
      "ctx",
      `"use strict";\nthrow new Error("__jsonexe_calibrate__");`,
    ) as (ctx: unknown) => unknown;
    probe(undefined);
    return null;
  } catch (e) {
    const { line } = frameLineCol((e as Error).stack);
    // The thrown line corresponds to user-source line 1.
    return typeof line === "number" ? line - 1 : null;
  }
}

function getSyncOffset(): number | null {
  if (syncOffset === undefined) syncOffset = calibrate();
  return syncOffset;
}

/** Map a thrown error's stack frame back to a slot-source line/column. */
export function mapErrorLocation(
  err: unknown,
  isAsync: boolean,
): { line?: number; column?: number } {
  const base = getSyncOffset();
  if (base === null) return {};
  // The async wrapper adds exactly one extra prefix line before user source.
  const offset = isAsync ? base + 1 : base;
  const { line, column } = frameLineCol((err as Error)?.stack);
  if (typeof line !== "number") return {};
  const mapped = line - offset;
  if (mapped < 1) return { column };
  return column !== undefined ? { line: mapped, column } : { line: mapped };
}

function remapRuntimeError(
  slot: string,
  err: unknown,
  isAsync: boolean,
): JsonExeError {
  // Preserve structured errors thrown from inside a slot (e.g. PermissionError).
  if (err instanceof JsonExeError) return err;
  const { line, column } = mapErrorLocation(err, isAsync);
  return new SlotRuntimeError(slot, errorMessage(err), { line, column, cause: err });
}

export const newFunctionEvaluator: Evaluator = {
  name: "unsafe-new-function",
  compile({ slot, source, async }: CompileInput): CompiledFn {
    let inner: (ctx: unknown) => unknown;
    try {
      inner = async
        ? (new Function(
            "ctx",
            `"use strict";\nreturn (async () => {\n${source}\n})();`,
          ) as (ctx: unknown) => unknown)
        : (new Function("ctx", `"use strict";\n${source}`) as (
            ctx: unknown,
          ) => unknown);
    } catch (err) {
      throw new SlotCompileError(slot, errorMessage(err), { cause: err });
    }

    // Wrap so that thrown / rejected errors carry mapped source locations.
    return (ctx: unknown) => {
      try {
        const out = inner(ctx);
        if (async && out instanceof Promise) {
          return out.catch((err: unknown) => {
            throw remapRuntimeError(slot, err, true);
          });
        }
        return out;
      } catch (err) {
        throw remapRuntimeError(slot, err, async);
      }
    };
  },
};

/** Resolve a {@link CompileOptions.evaluator} value to an {@link Evaluator}. */
export function resolveEvaluator(
  evaluator: Evaluator | "unsafe-new-function" | undefined,
): Evaluator {
  if (evaluator === undefined || evaluator === "unsafe-new-function") {
    return newFunctionEvaluator;
  }
  return evaluator;
}
