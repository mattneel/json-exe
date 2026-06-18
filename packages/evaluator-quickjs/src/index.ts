/**
 * A sandboxed JSON.exe {@link Evaluator} backed by QuickJS-ng compiled to
 * WebAssembly (via quickjs-emscripten). Unlike the dev `new Function` evaluator,
 * slot code runs in an isolated VM with:
 *
 * - no access to host globals (no `process`, `fetch`, `globalThis`, etc.),
 * - a memory limit,
 * - a CPU deadline that actually interrupts infinite loops,
 * - `ctx` marshalled in across a value boundary (host capabilities are exposed
 *   as VM functions; sync and async are both supported).
 *
 * Works in Node, browsers, Deno, and edge runtimes (it's WASM).
 */
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
  type SuccessOrFail,
} from "quickjs-emscripten-core";
import releaseSyncVariant from "@jitl/quickjs-ng-wasmfile-release-sync";
import {
  TimeoutError,
  type CompileInput,
  type CompiledFn,
  type Evaluator,
} from "@json-exe/runtime";

export interface QuickJSEvaluatorOptions {
  /** A pre-created QuickJS module. If omitted, one is loaded from `variant`. */
  module?: QuickJSWASMModule;
  /** A quickjs-emscripten variant to load (default: quickjs-ng wasmfile release sync). */
  variant?: unknown;
  /** Memory limit per run, in bytes (default 16 MiB). */
  memoryLimitBytes?: number;
  /** Max stack size per run, in bytes (default 512 KiB). */
  maxStackSizeBytes?: number;
  /** CPU deadline per run, in ms — interrupts infinite loops (default 1000). */
  deadlineMs?: number;
}

export interface QuickJSEvaluator extends Evaluator {
  readonly name: "quickjs";
  readonly module: QuickJSWASMModule;
  /** No-op; kept for symmetry (the WASM module needs no cleanup). */
  dispose(): void;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Marshal a host value into a VM handle. The returned handle is owned by the
 * caller (dispose it after use / setProp). Host functions are wrapped so the
 * guest can call them (sync return values and Promises are both handled).
 */
function toVm(
  vm: QuickJSContext,
  runtime: QuickJSRuntime,
  value: unknown,
  deferreds: QuickJSDeferredPromise[],
): QuickJSHandle {
  if (value === undefined) return vm.undefined;
  if (value === null) return vm.null;

  switch (typeof value) {
    case "boolean":
      return value ? vm.true : vm.false;
    case "number":
      return vm.newNumber(value);
    case "bigint":
      return vm.newNumber(Number(value));
    case "string":
      return vm.newString(value);
    case "function":
      return marshalFunction(vm, runtime, value as (...a: unknown[]) => unknown, deferreds);
    case "object": {
      if (Array.isArray(value)) {
        const arr = vm.newArray();
        for (let i = 0; i < value.length; i++) {
          const child = toVm(vm, runtime, value[i], deferreds);
          vm.setProp(arr, i, child);
          child.dispose();
        }
        return arr;
      }
      const obj = vm.newObject();
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const child = toVm(vm, runtime, val, deferreds);
        vm.setProp(obj, key, child);
        child.dispose();
      }
      return obj;
    }
    default:
      return vm.undefined;
  }
}

function marshalFunction(
  vm: QuickJSContext,
  runtime: QuickJSRuntime,
  fn: (...args: unknown[]) => unknown,
  deferreds: QuickJSDeferredPromise[],
): QuickJSHandle {
  return vm.newFunction("", (...argHandles) => {
    const args = argHandles.map((h) => vm.dump(h));
    let result: unknown;
    try {
      result = fn(...args);
    } catch (err) {
      return { error: vm.newString(errMsg(err)) };
    }

    if (isThenable(result)) {
      const deferred = vm.newPromise();
      deferreds.push(deferred);
      Promise.resolve(result).then(
        (resolved) => {
          // resolve() invokes the VM resolver but does NOT dispose the handle
          // we pass, so we own it and must dispose it.
          const handle = toVm(vm, runtime, resolved, deferreds);
          deferred.resolve(handle);
          handle.dispose();
          runtime.executePendingJobs();
        },
        (rejected) => {
          const handle = vm.newString(errMsg(rejected));
          deferred.reject(handle);
          handle.dispose();
          runtime.executePendingJobs();
        },
      );
      return deferred.handle;
    }

    return toVm(vm, runtime, result, deferreds);
  });
}

interface RunParams {
  slot: string;
  wrapped: string;
  async: boolean;
  ctx: unknown;
  memoryLimitBytes: number;
  maxStackSizeBytes: number;
  deadlineMs: number;
}

async function runOnce(module: QuickJSWASMModule, p: RunParams): Promise<unknown> {
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(p.memoryLimitBytes);
  runtime.setMaxStackSize(p.maxStackSizeBytes);

  const deadline = Date.now() + p.deadlineMs;
  let interrupted = false;
  runtime.setInterruptHandler(() => {
    if (Date.now() > deadline) {
      interrupted = true;
      return true;
    }
    return false;
  });

  const vm = runtime.newContext();
  const deferreds: QuickJSDeferredPromise[] = [];

  // Unwrap a VM result to its value handle, or throw. unwrapResult disposes the
  // error handle for us; we surface a TimeoutError when the CPU deadline fired.
  const unwrap = (
    result: SuccessOrFail<QuickJSHandle, QuickJSHandle>,
  ): QuickJSHandle => {
    try {
      return vm.unwrapResult(result);
    } catch (err) {
      if (interrupted) throw new TimeoutError(p.slot, p.deadlineMs);
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  };

  try {
    const ctxHandle = toVm(vm, runtime, p.ctx, deferreds);
    const globalHandle = vm.global;
    vm.setProp(globalHandle, "ctx", ctxHandle);
    ctxHandle.dispose();
    globalHandle.dispose();

    const resultHandle = unwrap(vm.evalCode(p.wrapped, "slot.js"));

    if (p.async) {
      const hostPromise = vm.resolvePromise(resultHandle);
      resultHandle.dispose();
      runtime.executePendingJobs();
      const settled = await hostPromise;
      runtime.executePendingJobs();
      const valueHandle = unwrap(settled);
      const out = vm.dump(valueHandle);
      valueHandle.dispose();
      return out;
    }

    const out = vm.dump(resultHandle);
    resultHandle.dispose();
    return out;
  } finally {
    for (const deferred of deferreds) {
      try {
        deferred.dispose();
      } catch {
        /* already settled/disposed */
      }
    }
    vm.dispose();
    runtime.dispose();
  }
}

/**
 * Create a sandboxed QuickJS evaluator. Loading the WASM module is async, so
 * this returns a Promise.
 *
 * ```ts
 * const evaluator = await createQuickJSEvaluator();
 * const ext = await compileExtension(spec, json, { evaluator });
 * ```
 */
export async function createQuickJSEvaluator(
  options: QuickJSEvaluatorOptions = {},
): Promise<QuickJSEvaluator> {
  const module =
    options.module ??
    (await newQuickJSWASMModuleFromVariant(
      (options.variant ?? releaseSyncVariant) as Parameters<
        typeof newQuickJSWASMModuleFromVariant
      >[0],
    ));
  const memoryLimitBytes = options.memoryLimitBytes ?? 16 * 1024 * 1024;
  const maxStackSizeBytes = options.maxStackSizeBytes ?? 512 * 1024;
  const deadlineMs = options.deadlineMs ?? 1000;

  return {
    name: "quickjs",
    module,
    compile({ slot, source, async }: CompileInput): CompiledFn {
      const wrapped = async
        ? `(async () => {\n${source}\n})()`
        : `(() => {\n${source}\n})()`;
      return (ctx: unknown) =>
        runOnce(module, {
          slot,
          wrapped,
          async,
          ctx,
          memoryLimitBytes,
          maxStackSizeBytes,
          deadlineMs,
        });
    },
    dispose() {
      // The WASM module is reusable and holds no per-run resources (runtimes
      // and contexts are disposed after each run), so there's nothing to free.
    },
  };
}
