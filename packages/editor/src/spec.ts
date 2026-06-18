import * as runtime from "@json-exe/runtime";
import type { ExtensionTypeSpec } from "@json-exe/runtime";
import type * as M from "monaco-editor";

type MonacoApi = typeof import("monaco-editor");

export interface SpecEvalResult {
  spec?: ExtensionTypeSpec;
  error?: string;
  /** True when the failure is likely transient (TS worker not ready yet). */
  transient?: boolean;
}

/** A fake `require` for the spec sandbox — only the runtime is importable. */
function specRequire(id: string): unknown {
  if (id === "@json-exe/runtime") return runtime;
  throw new Error(
    `Cannot import "${id}" — only "@json-exe/runtime" is available in the spec sandbox.`,
  );
}

function isSpec(value: unknown): value is ExtensionTypeSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ExtensionTypeSpec).kind === "string" &&
    typeof (value as ExtensionTypeSpec).slots === "object" &&
    (value as ExtensionTypeSpec).slots !== null
  );
}

/**
 * Transpile the spec TypeScript model (CommonJS, via Monaco's worker) and
 * execute it with a sandboxed `require`, returning the exported spec object.
 * Robust to multi-line imports, named exports, comments, and `as const`.
 */
export async function evalSpecModel(
  monaco: MonacoApi,
  model: M.editor.ITextModel,
): Promise<SpecEvalResult> {
  let js: string;
  try {
    const getWorker = await monaco.typescript.getTypeScriptWorker();
    const client = await getWorker(model.uri);
    const output = await client.getEmitOutput(model.uri.toString());
    js = output.outputFiles[0]?.text ?? "";
    // Empty output on a non-empty model usually means the worker isn't ready.
    if (!js.trim()) return { error: "Evaluating spec…", transient: true };
  } catch (err) {
    return {
      error: `Failed to transpile spec: ${(err as Error)?.message ?? String(err)}`,
      transient: true,
    };
  }

  try {
    const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
    // eslint-disable-next-line no-new-func
    const factory = new Function("require", "exports", "module", js) as (
      require: (id: string) => unknown,
      exports: unknown,
      module: { exports: Record<string, unknown> },
    ) => void;
    factory(specRequire, moduleObj.exports, moduleObj);

    const exported = moduleObj.exports;
    const candidate = exported.default ?? exported.spec ?? exported;
    if (!isSpec(candidate)) {
      return {
        error:
          "Spec must `export default defineExtensionType({ kind, slots })` (or export a `spec`).",
      };
    }
    return { spec: candidate };
  } catch (err) {
    return { error: `Failed to evaluate spec: ${(err as Error).message}` };
  }
}
