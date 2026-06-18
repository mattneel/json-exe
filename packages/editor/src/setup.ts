import type * as M from "monaco-editor";

type MonacoApi = typeof import("monaco-editor");

/**
 * Configure Monaco's TypeScript service for JSON.exe's embedded `ctx` analysis
 * (and for spec authoring). Idempotent — safe to call multiple times. Call once
 * before {@link installJsonExeLanguage} / {@link createExtensionEditor}.
 */
export function setupJsonExeMonaco(monaco: MonacoApi): void {
  const ts = monaco.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    // CommonJS so spec modules can be transpiled and executed (see evalSpecModel).
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    strict: true,
    noEmit: false,
    esModuleInterop: true,
    skipLibCheck: true,
    lib: ["es2020", "dom"],
  });
}

/**
 * Register the `@json-exe/runtime` type declarations so spec-authoring editors
 * (TypeScript) get IntelliSense on `defineExtensionType`. Pass the runtime's
 * bundled `index.d.ts` text. Optional — only needed for the spec editor, not for
 * the extension editor.
 *
 * Note: spec models should use the `file://` URI scheme so Monaco's Node module
 * resolution reaches `file:///node_modules/@json-exe/runtime`.
 */
export function addRuntimeTypes(monaco: MonacoApi, runtimeDts: string): void {
  const ts = monaco.typescript;
  ts.typescriptDefaults.addExtraLib(
    runtimeDts,
    "file:///node_modules/@json-exe/runtime/index.d.ts",
  );
  ts.typescriptDefaults.addExtraLib(
    JSON.stringify({ name: "@json-exe/runtime", types: "index.d.ts" }),
    "file:///node_modules/@json-exe/runtime/package.json",
  );
}

/** Re-exported only so consumers can annotate against the model type if needed. */
export type EditorModel = M.editor.ITextModel;
