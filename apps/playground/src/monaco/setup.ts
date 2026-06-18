import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { setupJsonExeMonaco, addRuntimeTypes } from "@json-exe/editor";
// Runtime type declarations (bundled .d.ts) loaded as text so the spec editor
// resolves `@json-exe/runtime`. Requires `pnpm build` of the runtime.
import runtimeDts from "../../../../packages/runtime/dist/index.d.ts?raw";

const globalScope = globalThis as typeof globalThis & {
  MonacoEnvironment?: monaco.Environment;
};

globalScope.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

// Configure Monaco's TS service for JSON.exe and load the runtime types for the
// spec editor (both provided by @json-exe/editor).
setupJsonExeMonaco(monaco);
addRuntimeTypes(monaco, runtimeDts);

monaco.editor.defineTheme("jsonexe-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0d1117",
  },
});

export { monaco, runtimeDts };
