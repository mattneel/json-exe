import type { ExtensionTypeSpec } from "./types";

/**
 * Define (and lightly validate) an extension type spec. Returns the spec
 * unchanged so callers keep their precise literal type for inference.
 */
export function defineExtensionType<const S extends ExtensionTypeSpec>(
  spec: S,
): S {
  if (!spec || typeof spec.kind !== "string" || spec.kind.length === 0) {
    throw new Error(
      "defineExtensionType: `kind` is required and must be a non-empty string.",
    );
  }
  if (!spec.slots || typeof spec.slots !== "object") {
    throw new Error(
      `defineExtensionType: extension type "${spec.kind}" must declare a \`slots\` object.`,
    );
  }
  return spec;
}
