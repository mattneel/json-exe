import type {
  CompileOptions,
  CompiledExtension,
  ExtensionTypeSpec,
  JsonExeRuntime,
  ValidationResult,
} from "./types";
import { compileExtension } from "./compileExtension";
import { validateExtension } from "./validateExtension";

/**
 * Create a runtime with default {@link CompileOptions} (evaluator, freeze, etc).
 * Per-call options passed to `compile` are merged over these defaults.
 */
export function createRuntime(defaults: CompileOptions = {}): JsonExeRuntime {
  return {
    compile(
      spec: ExtensionTypeSpec,
      json: unknown,
      options?: CompileOptions,
    ): Promise<CompiledExtension> {
      return compileExtension(spec, json, { ...defaults, ...options });
    },
    validate(spec: ExtensionTypeSpec, json: unknown): ValidationResult {
      return validateExtension(spec, json, defaults);
    },
  };
}
