/**
 * Compile a JSON extension against an extension type spec into a
 * {@link CompiledExtension} whose slots can be run against a `ctx`.
 *
 * Flow (SPEC §8.2): validate shape → compile slot source → return an object
 * that freezes/validates/traces each run.
 */
import type {
  CompileInput,
  CompileOptions,
  CompiledExtension,
  CompiledFn,
  CompiledSlotInfo,
  ExtensionJson,
  ExtensionTypeSpec,
  RunOptions,
  SlotResult,
  TraceSink,
} from "./types";
import { collectExtensionErrors } from "./validateExtension";
import { resolveEvaluator } from "./evaluator";
import { getSlotSource } from "./slots";
import { executeSlot, type ExecuteParams } from "./executeSlot";
import { Trace } from "./trace";

export async function compileExtension(
  spec: ExtensionTypeSpec,
  json: unknown,
  options: CompileOptions = {},
): Promise<CompiledExtension> {
  const errors = collectExtensionErrors(spec, json, options);
  if (errors.length > 0) {
    // Throw the highest-priority error (checks run in priority order).
    throw errors[0];
  }

  const ext = json as ExtensionJson;
  const extId =
    typeof ext.$id === "string"
      ? ext.$id
      : typeof ext.id === "string"
        ? ext.id
        : undefined;

  const evaluator = resolveEvaluator(options.evaluator);
  const validateReturns = options.validateReturns !== false;
  const freezeContext = options.freezeContext === true;

  const compiled = new Map<string, CompiledFn>();
  for (const [slotName, slotSpec] of Object.entries(spec.slots)) {
    const source = getSlotSource(ext, slotName);
    if (typeof source !== "string") continue; // optional & missing (already validated)
    const input: CompileInput = {
      slot: slotName,
      source,
      async: slotSpec.async === true,
    };
    if (slotSpec.timeoutMs !== undefined) input.timeoutMs = slotSpec.timeoutMs;
    compiled.set(slotName, await evaluator.compile(input));
  }

  const resolveTimeout = (
    slotName: string,
    runOptions: RunOptions,
  ): number | undefined => {
    if (runOptions.timeoutMs !== undefined) return runOptions.timeoutMs;
    const specTimeout = spec.slots[slotName]?.timeoutMs;
    if (specTimeout !== undefined) return specTimeout;
    return options.defaultTimeoutMs;
  };

  const resolveTraceSink = (runOptions: RunOptions): TraceSink | undefined => {
    const trace = runOptions.trace;
    if (trace === true) return new Trace();
    if (trace) return trace; // a TraceSink instance
    return undefined;
  };

  const buildParams = (
    slot: string,
    ctx: unknown,
    runOptions: RunOptions,
  ): ExecuteParams => {
    const slotSpec = spec.slots[slot];
    return {
      slot,
      fn: compiled.get(slot),
      ctx,
      returns: slotSpec?.returns,
      validateReturns,
      timeoutMs: resolveTimeout(slot, runOptions),
      freezeContext,
      extensionId: extId,
      phase: slotSpec?.phase,
      trace: resolveTraceSink(runOptions),
    };
  };

  return {
    kind: spec.kind,
    id: extId,
    spec,
    json: ext,

    has(slot: string): boolean {
      return compiled.has(slot);
    },

    slots(): CompiledSlotInfo[] {
      return Object.entries(spec.slots).map(([name, slotSpec]) => {
        const info: CompiledSlotInfo = {
          name,
          required: slotSpec.required === true,
          compiled: compiled.has(name),
          async: slotSpec.async === true,
        };
        if (slotSpec.phase !== undefined) info.phase = slotSpec.phase;
        if (slotSpec.description !== undefined) {
          info.description = slotSpec.description;
        }
        return info;
      });
    },

    async exec<T = unknown>(
      slot: string,
      ctx: unknown = {},
      runOptions: RunOptions = {},
    ): Promise<SlotResult<T>> {
      const result = await executeSlot(buildParams(slot, ctx, runOptions));
      return result.public as SlotResult<T>;
    },

    async run<T = unknown>(
      slot: string,
      ctx: unknown = {},
      runOptions: RunOptions = {},
    ): Promise<T> {
      const result = await executeSlot(buildParams(slot, ctx, runOptions));
      if (!result.public.ok) {
        throw (
          result.errorInstance ??
          new Error(result.public.error?.message ?? "Slot execution failed")
        );
      }
      return result.public.result as T;
    },
  };
}
