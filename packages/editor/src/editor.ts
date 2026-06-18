import {
  compileExtension,
  type ExtensionTypeSpec,
  type SlotResult,
} from "@json-exe/runtime";
import { testExtension, type TestReport } from "@json-exe/testing";
import type * as M from "monaco-editor";
import { installJsonExeLanguage, type JsonExeLanguage } from "./language";
import { setupJsonExeMonaco } from "./setup";

type MonacoApi = typeof import("monaco-editor");

export interface ExtensionEditorOptions {
  /** The extension type spec — a value, or a getter for a live/changing spec. */
  spec: ExtensionTypeSpec | (() => ExtensionTypeSpec | undefined);
  /** Initial extension JSON. Defaults to `{}`. */
  value?: string;
  /** Override the model URI (must be unique per editor). */
  modelUri?: string;
  /** Extra Monaco editor construction options. */
  editorOptions?: M.editor.IStandaloneEditorConstructionOptions;
}

export interface ExtensionEditorHandle {
  editor: M.editor.IStandaloneCodeEditor;
  model: M.editor.ITextModel;
  language: JsonExeLanguage;
  getValue(): string;
  setValue(value: string): void;
  /** Parse the current JSON (throws on invalid JSON). */
  getExtension(): unknown;
  /** Replace the spec (effective when constructed with a static spec) and refresh. */
  setSpec(spec: ExtensionTypeSpec): void;
  /** Compile + run a slot against `ctx`, returning a {@link SlotResult} with trace. */
  run<T = unknown>(slot: string, ctx?: unknown): Promise<SlotResult<T>>;
  /** Run the extension's embedded `$tests`. */
  test(): Promise<TestReport>;
  onChange(cb: (value: string) => void): M.IDisposable;
  dispose(): void;
}

let uriCounter = 0;

/**
 * One call to drop a fully-wired JSON.exe extension editor into a container:
 * JSON editing with embedded typed-`ctx` IntelliSense, diagnostics, and run/test
 * helpers. Bring your own Monaco instance.
 */
export function createExtensionEditor(
  monaco: MonacoApi,
  container: HTMLElement,
  options: ExtensionEditorOptions,
): ExtensionEditorHandle {
  setupJsonExeMonaco(monaco);

  let currentSpec: ExtensionTypeSpec | undefined =
    typeof options.spec === "function" ? options.spec() : options.spec;
  const getSpec: () => ExtensionTypeSpec | undefined =
    typeof options.spec === "function" ? options.spec : () => currentSpec;

  const uri = monaco.Uri.parse(
    options.modelUri ?? `inmemory://json-exe/extension-${++uriCounter}.json`,
  );
  const model =
    monaco.editor.getModel(uri) ??
    monaco.editor.createModel(options.value ?? "{}", "json", uri);
  if (options.value !== undefined && model.getValue() !== options.value) {
    model.setValue(options.value);
  }

  const editor = monaco.editor.create(container, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    ...options.editorOptions,
  });

  const language = installJsonExeLanguage(monaco, { model, getSpec });

  const parse = (): unknown => {
    const text = model.getValue().trim();
    return text ? JSON.parse(text) : {};
  };
  const requireSpec = (): ExtensionTypeSpec => {
    const spec = getSpec();
    if (!spec) throw new Error("createExtensionEditor: no spec available.");
    return spec;
  };

  return {
    editor,
    model,
    language,
    getValue: () => model.getValue(),
    setValue: (value) => model.setValue(value),
    getExtension: parse,
    setSpec(spec) {
      currentSpec = spec;
      language.refresh();
    },
    async run<T = unknown>(slot: string, ctx?: unknown): Promise<SlotResult<T>> {
      const ext = await compileExtension(requireSpec(), parse());
      return ext.exec<T>(slot, ctx, { trace: true });
    },
    test() {
      return testExtension(requireSpec(), parse());
    },
    onChange(cb) {
      return model.onDidChangeContent(() => cb(model.getValue()));
    },
    dispose() {
      language.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
