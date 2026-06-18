import { defineExtensionType, type ExtensionTypeSpec } from "@json-exe/runtime";
import { monaco } from "../monaco/setup";

export interface SpecEvalResult {
  spec?: ExtensionTypeSpec;
  error?: string;
}

/**
 * Turn the emitted JS of the spec module into something we can evaluate:
 * strip imports/exports and turn `export default X` into `return X`. The only
 * free identifier the spec body may reference is `defineExtensionType`, which we
 * pass in.
 */
function toEvaluable(js: string): string {
  return js
    .replace(/^\s*import\s[^\n]*$/gm, "")
    .replace(/^\s*export\s+default\s+/m, "return ")
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, "");
}

/** Transpile + evaluate a spec TypeScript model into an ExtensionTypeSpec. */
export async function evalSpecModel(
  model: monaco.editor.ITextModel,
): Promise<SpecEvalResult> {
  let js: string;
  try {
    const getWorker = await monaco.typescript.getTypeScriptWorker();
    const client = await getWorker(model.uri);
    const output = await client.getEmitOutput(model.uri.toString());
    js = output.outputFiles[0]?.text ?? "";
    if (!js) return { error: "Spec produced no output (is it empty?)." };
  } catch (err) {
    return { error: `Failed to transpile spec: ${(err as Error).message}` };
  }

  const body = toEvaluable(js);
  if (!/\breturn\b/.test(body)) {
    return {
      error:
        "Spec must `export default defineExtensionType({ ... })` (or export a spec object).",
    };
  }

  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function("defineExtensionType", body) as (
      d: typeof defineExtensionType,
    ) => unknown;
    const spec = factory(defineExtensionType);
    if (
      !spec ||
      typeof spec !== "object" ||
      typeof (spec as ExtensionTypeSpec).kind !== "string" ||
      typeof (spec as ExtensionTypeSpec).slots !== "object"
    ) {
      return { error: "Spec is not a valid extension type ({ kind, slots })." };
    }
    return { spec: spec as ExtensionTypeSpec };
  } catch (err) {
    return { error: `Failed to evaluate spec: ${(err as Error).message}` };
  }
}
