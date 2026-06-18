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
  type ContextOptions,
  type InterruptHandler,
  type Intrinsics,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
  type RuntimeOptions,
  type SuccessOrFail,
} from "quickjs-emscripten-core";
import releaseSyncVariant from "@jitl/quickjs-ng-wasmfile-release-sync";
import {
  TimeoutError,
  type CompileInput,
  type CompiledFn,
  type Evaluator,
} from "@json-exe/runtime";

/** Tunable QuickJS evaluation limits/config. All fields are optional. */
export interface QuickJSEvaluatorOptions {
  /** A pre-created QuickJS module. If omitted, one is loaded from `variant`. */
  module?: QuickJSWASMModule;
  /** A quickjs-emscripten variant to load (default: quickjs-ng wasmfile release sync). */
  variant?: unknown;
  /** Memory limit per run, in bytes. Default 16 MiB. Use `-1` to disable. */
  memoryLimitBytes?: number;
  /** Max stack size per run, in bytes. Default 512 KiB. Use `-1` to disable. */
  maxStackSizeBytes?: number;
  /**
   * CPU deadline per run, in ms — interrupts infinite loops (surfaced as a
   * `TimeoutError`). Default 1000. Set `0` or `Infinity` to disable.
   */
  deadlineMs?: number;
  /**
   * Custom interrupt handler (in addition to `deadlineMs`). Return `true` to
   * abort the running code; an abort is reported as a `TimeoutError`.
   */
  interruptHandler?: InterruptHandler;
  /**
   * Which language intrinsics/built-ins to enable in the VM (e.g. disable
   * `Date`, `Proxy`, `Eval`). Defaults to QuickJS's full default set.
   */
  intrinsics?: Intrinsics;
  /** Max QuickJS jobs to drain per microtask pump (default: all). */
  maxJobsPerTick?: number;
  /** Advanced: extra runtime options merged into `newRuntime`. */
  runtimeOptions?: RuntimeOptions;
  /** Advanced: extra context options merged into `newContext`. */
  contextOptions?: ContextOptions;
}

/** The default limits applied when options are omitted. */
export const DEFAULT_QUICKJS_LIMITS = {
  memoryLimitBytes: 16 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  deadlineMs: 1000,
} as const;

interface ResolvedConfig {
  memoryLimitBytes: number;
  maxStackSizeBytes: number;
  deadlineMs: number;
  interruptHandler?: InterruptHandler;
  intrinsics?: Intrinsics;
  maxJobsPerTick?: number;
  runtimeOptions?: RuntimeOptions;
  contextOptions?: ContextOptions;
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
interface Marshaller {
  vm: QuickJSContext;
  runtime: QuickJSRuntime;
  deferreds: QuickJSDeferredPromise[];
  maxJobs: number | undefined;
}

function toVm(m: Marshaller, value: unknown): QuickJSHandle {
  const { vm } = m;
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
      return marshalFunction(m, value as (...a: unknown[]) => unknown);
    case "object": {
      if (Array.isArray(value)) {
        const arr = vm.newArray();
        for (let i = 0; i < value.length; i++) {
          const child = toVm(m, value[i]);
          vm.setProp(arr, i, child);
          child.dispose();
        }
        return arr;
      }
      const obj = vm.newObject();
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const child = toVm(m, val);
        vm.setProp(obj, key, child);
        child.dispose();
      }
      return obj;
    }
    default:
      return vm.undefined;
  }
}

function marshalFunction(m: Marshaller, fn: (...args: unknown[]) => unknown): QuickJSHandle {
  const { vm, runtime } = m;
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
      m.deferreds.push(deferred);
      Promise.resolve(result).then(
        (resolved) => {
          // resolve() invokes the VM resolver but does NOT dispose the handle
          // we pass, so we own it and must dispose it.
          const handle = toVm(m, resolved);
          deferred.resolve(handle);
          handle.dispose();
          runtime.executePendingJobs(m.maxJobs);
        },
        (rejected) => {
          const handle = vm.newString(errMsg(rejected));
          deferred.reject(handle);
          handle.dispose();
          runtime.executePendingJobs(m.maxJobs);
        },
      );
      return deferred.handle;
    }

    return toVm(m, result);
  });
}

interface RunParams {
  slot: string;
  wrapped: string;
  async: boolean;
  ctx: unknown;
}

async function runOnce(
  module: QuickJSWASMModule,
  config: ResolvedConfig,
  p: RunParams,
): Promise<unknown> {
  const runtime = module.newRuntime(config.runtimeOptions ?? {});
  runtime.setMemoryLimit(config.memoryLimitBytes);
  runtime.setMaxStackSize(config.maxStackSizeBytes);

  const useDeadline =
    Number.isFinite(config.deadlineMs) && config.deadlineMs > 0;
  const deadline = useDeadline ? Date.now() + config.deadlineMs : 0;
  let interrupted = false;
  if (useDeadline || config.interruptHandler) {
    runtime.setInterruptHandler((rt) => {
      if (useDeadline && Date.now() > deadline) {
        interrupted = true;
        return true;
      }
      if (config.interruptHandler?.(rt)) {
        interrupted = true;
        return true;
      }
      return false;
    });
  }

  const contextOptions: ContextOptions = { ...config.contextOptions };
  if (config.intrinsics) contextOptions.intrinsics = config.intrinsics;
  const vm = runtime.newContext(contextOptions);
  const deferreds: QuickJSDeferredPromise[] = [];

  // Unwrap a VM result to its value handle, or throw. unwrapResult disposes the
  // error handle for us; we surface a TimeoutError when an interrupt fired.
  const unwrap = (
    result: SuccessOrFail<QuickJSHandle, QuickJSHandle>,
  ): QuickJSHandle => {
    try {
      return vm.unwrapResult(result);
    } catch (err) {
      if (interrupted) throw new TimeoutError(p.slot, config.deadlineMs);
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  };

  const marshaller: Marshaller = {
    vm,
    runtime,
    deferreds,
    maxJobs: config.maxJobsPerTick,
  };

  try {
    const ctxHandle = toVm(marshaller, p.ctx);
    const globalHandle = vm.global;
    vm.setProp(globalHandle, "ctx", ctxHandle);
    ctxHandle.dispose();
    globalHandle.dispose();

    const resultHandle = unwrap(vm.evalCode(p.wrapped, "slot.js"));

    if (p.async) {
      const hostPromise = vm.resolvePromise(resultHandle);
      resultHandle.dispose();
      runtime.executePendingJobs(config.maxJobsPerTick);
      const settled = await hostPromise;
      runtime.executePendingJobs(config.maxJobsPerTick);
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
  const config: ResolvedConfig = {
    memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_QUICKJS_LIMITS.memoryLimitBytes,
    maxStackSizeBytes: options.maxStackSizeBytes ?? DEFAULT_QUICKJS_LIMITS.maxStackSizeBytes,
    deadlineMs: options.deadlineMs ?? DEFAULT_QUICKJS_LIMITS.deadlineMs,
    interruptHandler: options.interruptHandler,
    intrinsics: options.intrinsics,
    maxJobsPerTick: options.maxJobsPerTick,
    runtimeOptions: options.runtimeOptions,
    contextOptions: options.contextOptions,
  };

  return {
    name: "quickjs",
    module,
    compile({ slot, source, async }: CompileInput): CompiledFn {
      const wrapped = async
        ? `(async () => {\n${source}\n})()`
        : `(() => {\n${source}\n})()`;
      return (ctx: unknown) => runOnce(module, config, { slot, wrapped, async, ctx });
    },
    dispose() {
      // The WASM module is reusable and holds no per-run resources (runtimes
      // and contexts are disposed after each run), so there's nothing to free.
    },
  };
}
