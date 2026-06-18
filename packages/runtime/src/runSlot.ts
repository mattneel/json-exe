import type { CompileOptions, ExtensionTypeSpec, RunOptions } from "./types";
import { compileExtension } from "./compileExtension";

/**
 * One-shot convenience: compile an extension and run a single slot. Prefer
 * {@link compileExtension} when you will run multiple slots (it compiles once).
 */
export async function runSlot<T = unknown>(
  spec: ExtensionTypeSpec,
  json: unknown,
  slot: string,
  ctx?: unknown,
  options: CompileOptions & RunOptions = {},
): Promise<T> {
  const extension = await compileExtension(spec, json, options);
  const runOptions: RunOptions = {};
  if (options.trace !== undefined) runOptions.trace = options.trace;
  if (options.timeoutMs !== undefined) runOptions.timeoutMs = options.timeoutMs;
  return extension.run<T>(slot, ctx, runOptions);
}
