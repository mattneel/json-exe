import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
// Runtime type declarations (bundled .d.ts) loaded as text so Monaco's TS
// service can resolve `@json-exe/runtime`. Requires `pnpm build` of the runtime.
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

// In monaco 0.55+ the TypeScript API lives at the top-level `monaco.typescript`
// namespace (`monaco.languages.typescript` is a deprecated stub).
const ts = monaco.typescript;

ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  allowNonTsExtensions: true,
  strict: true,
  noEmit: false,
  esModuleInterop: true,
  skipLibCheck: true,
  lib: ["es2020", "dom"],
});

// Resolve `@json-exe/runtime` to the bundled declarations.
ts.typescriptDefaults.addExtraLib(
  runtimeDts,
  "file:///node_modules/@json-exe/runtime/index.d.ts",
);
ts.typescriptDefaults.addExtraLib(
  JSON.stringify({ name: "@json-exe/runtime", types: "index.d.ts" }),
  "file:///node_modules/@json-exe/runtime/package.json",
);

monaco.editor.defineTheme("jsonexe-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0d1117",
  },
});

export { monaco, runtimeDts };
