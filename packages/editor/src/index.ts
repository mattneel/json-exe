/**
 * @json-exe/editor — embeddable Monaco language features + editor component for
 * JSON.exe. Bring your own `monaco-editor` instance (peer dependency).
 */
export { installJsonExeLanguage } from "./language";
export type { JsonExeLanguage, InstallOptions } from "./language";

export { evalSpecModel } from "./spec";
export type { SpecEvalResult } from "./spec";

export { setupJsonExeMonaco, addRuntimeTypes } from "./setup";
export type { EditorModel } from "./setup";

export { createExtensionEditor } from "./editor";
export type {
  ExtensionEditorOptions,
  ExtensionEditorHandle,
} from "./editor";

export {
  buildEscapeMap,
  buildSlotModule,
  collectSlotStrings,
  decodedToRawOffset,
  findValueRange,
  formatSlotSignature,
  rawToDecodedOffset,
  schemaToTsType,
  slotKeyAt,
  specToJsonSchema,
  synthesizeCtxDecls,
} from "./embed";
export type { EscapeMap, SlotModule, SlotStringRange } from "./embed";
