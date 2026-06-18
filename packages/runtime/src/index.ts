/**
 * @json-exe/runtime — JSON.exe core runtime.
 *
 * JSON object + documented ctx + named JS slots = extension.
 */

export { defineExtensionType } from "./defineExtensionType";
export { compileExtension } from "./compileExtension";
export { validateExtension, collectExtensionErrors } from "./validateExtension";
export { createRuntime } from "./createRuntime";
export { runSlot } from "./runSlot";

export { Trace } from "./trace";
export { newFunctionEvaluator, resolveEvaluator, mapErrorLocation } from "./evaluator";
export { checkPermissions } from "./permissions";
export { getSlotSource } from "./slots";
export { deepFreeze, errorMessage } from "./util";

export {
  validateAgainstSchema,
  describeSchema,
  describeType,
  deepEqual,
} from "./schema";
export type { SchemaCheckResult } from "./schema";

export * from "./errors";
export * from "./types";
