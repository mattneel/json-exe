/**
 * JSON.exe Monaco language features. Pass in the host's `monaco` namespace so
 * there's a single Monaco instance (it's a peer dependency).
 */
import {
  validateExtension,
  type ExtensionTypeSpec,
  type JsonExeErrorObject,
} from "@json-exe/runtime";
import type * as M from "monaco-editor";
import {
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
  type EscapeMap,
} from "./embed";

type MonacoApi = typeof import("monaco-editor");

const OWNER = "jsonexe";

let instanceCounter = 0;

/** Shared registry so multiple editor instances don't clobber JSON schemas. */
const schemaRegistry = new Map<string, object>();
function applySchemas(monaco: MonacoApi): void {
  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    schemas: [...schemaRegistry.entries()].map(([fileUri, schema]) => ({
      uri: `${fileUri}#json-exe-schema`,
      fileMatch: [fileUri],
      schema,
    })),
  });
}

type GetSpec = () => ExtensionTypeSpec | undefined;

export interface InstallOptions {
  /** The extension JSON model to attach language features to. */
  model: M.editor.ITextModel;
  /** Returns the current (live) extension type spec, or undefined. */
  getSpec: GetSpec;
}

export interface JsonExeLanguage {
  /** Recompute diagnostics now (call when the spec changes). */
  refresh(): void;
  dispose(): void;
}

interface SlotLocation {
  slot: string;
  rangeStart: number;
  hidden: M.editor.ITextModel;
  hiddenOffset: number;
  bodyOffset: number;
  map: EscapeMap;
}

interface TsMessage {
  messageText: string;
  next?: TsMessage[];
}
interface TsDiagnostic {
  start?: number;
  length?: number;
  category: number;
  messageText: string | TsMessage;
}

function flattenMessage(messageText: string | TsMessage): string {
  if (typeof messageText === "string") return messageText;
  let out = messageText.messageText;
  if (messageText.next) for (const n of messageText.next) out += " " + flattenMessage(n);
  return out;
}

function partsToString(parts: { text: string }[] | undefined): string {
  return (parts ?? []).map((p) => p.text).join("");
}

export function installJsonExeLanguage(
  monaco: MonacoApi,
  options: InstallOptions,
): JsonExeLanguage {
  const extModel = options.model;
  const { getSpec } = options;
  const ns = ++instanceCounter;
  const fileUri = extModel.uri.toString();
  const hidden = new Map<string, M.editor.ITextModel>();
  let runGeneration = 0;

  const mapKind = (kind: string): M.languages.CompletionItemKind => {
    const K = monaco.languages.CompletionItemKind;
    switch (kind) {
      case "method": return K.Method;
      case "function": return K.Function;
      case "property":
      case "getter":
      case "setter": return K.Property;
      case "var":
      case "let":
      case "const":
      case "parameter": return K.Variable;
      case "keyword": return K.Keyword;
      case "class": return K.Class;
      case "interface": return K.Interface;
      case "module": return K.Module;
      case "type": return K.TypeParameter;
      default: return K.Field;
    }
  };

  function ensureHidden(slot: string): M.editor.ITextModel {
    let m = hidden.get(slot);
    if (!m) {
      const uri = monaco.Uri.parse(
        `inmemory://json-exe/${ns}/__slots__/${encodeURIComponent(slot)}.ts`,
      );
      m = monaco.editor.getModel(uri) ?? monaco.editor.createModel("", "typescript", uri);
      hidden.set(slot, m);
    }
    return m;
  }

  function pruneHidden(active: Set<string>): void {
    for (const [slot, m] of hidden) {
      if (!active.has(slot)) {
        m.dispose();
        hidden.delete(slot);
      }
    }
  }

  /** Build (or update) the hidden TS model for the slot under `offset`. */
  function locate(offset: number, spec: ExtensionTypeSpec): SlotLocation | null {
    const text = extModel.getValue();
    const slotSet = new Set(Object.keys(spec.slots));
    const hit = collectSlotStrings(text, slotSet).find(
      (r) => offset >= r.start && offset <= r.end,
    );
    if (!hit) return null;

    const raw = text.slice(hit.start, hit.end);
    const map = buildEscapeMap(raw);
    const returnType = schemaToTsType(spec.slots[hit.slot]?.returns);
    const mod = buildSlotModule(
      synthesizeCtxDecls(spec),
      map.decoded.replace(/\r/g, "\n"),
      returnType,
    );
    const model = ensureHidden(hit.slot);
    if (model.getValue() !== mod.content) model.setValue(mod.content);

    return {
      slot: hit.slot,
      rangeStart: hit.start,
      hidden: model,
      hiddenOffset: mod.bodyOffset + rawToDecodedOffset(map, offset - hit.start),
      bodyOffset: mod.bodyOffset,
      map,
    };
  }

  async function tsClient(uri: M.Uri): Promise<any> {
    const getWorker = await monaco.typescript.getTypeScriptWorker();
    return getWorker(uri);
  }

  const isOurModel = (m: M.editor.ITextModel) => m.uri.toString() === fileUri;

  /* ---- completions (ctx.* inside slot strings, with resolvable docs) ---- */
  const completion = monaco.languages.registerCompletionItemProvider("json", {
    triggerCharacters: [".", '"', "'", " "],
    async provideCompletionItems(m, position) {
      if (!isOurModel(m)) return null;
      const spec = getSpec();
      if (!spec) return null;
      const loc = locate(m.getOffsetAt(position), spec);
      if (!loc) return null;
      const client = await tsClient(loc.hidden.uri);
      const uri = loc.hidden.uri.toString();
      const info = await client.getCompletionsAtPosition(uri, loc.hiddenOffset);
      if (!info) return null;
      const word = m.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      return {
        suggestions: (info.entries as { name: string; kind: string; sortText?: string }[]).map(
          (e) => ({
            label: e.name,
            kind: mapKind(e.kind),
            insertText: e.name,
            range,
            sortText: e.sortText,
            _jsonexe: { uri, offset: loc.hiddenOffset, name: e.name },
          }),
        ),
      };
    },
    async resolveCompletionItem(item) {
      const data = (item as { _jsonexe?: { uri: string; offset: number; name: string } })._jsonexe;
      if (!data) return item;
      try {
        const client = await tsClient(monaco.Uri.parse(data.uri));
        const details = await client.getCompletionEntryDetails(
          data.uri,
          data.offset,
          data.name,
        );
        if (details) {
          item.detail = partsToString(details.displayParts);
          const doc = partsToString(details.documentation);
          if (doc) item.documentation = { value: doc };
        }
      } catch {
        /* best-effort */
      }
      return item;
    },
  });

  /* ---- hover (slot-key signature, or ctx quick-info inside strings) ---- */
  const hover = monaco.languages.registerHoverProvider("json", {
    async provideHover(m, position) {
      if (!isOurModel(m)) return null;
      const spec = getSpec();
      if (!spec) return null;
      const offset = m.getOffsetAt(position);

      // Hovering a slot's key → show its contract signature.
      const keySlot = slotKeyAt(m.getValue(), new Set(Object.keys(spec.slots)), offset);
      if (keySlot && spec.slots[keySlot]) {
        return { contents: [{ value: formatSlotSignature(keySlot, spec.slots[keySlot]) }] };
      }

      const loc = locate(offset, spec);
      if (!loc) return null;
      const client = await tsClient(loc.hidden.uri);
      const qi = await client.getQuickInfoAtPosition(loc.hidden.uri.toString(), loc.hiddenOffset);
      if (!qi) return null;
      const signature = partsToString(qi.displayParts);
      const docs = partsToString(qi.documentation);
      const contents: M.IMarkdownString[] = [{ value: "```typescript\n" + signature + "\n```" }];
      if (docs) contents.push({ value: docs });
      const decodedStart = qi.textSpan.start - loc.bodyOffset;
      if (decodedStart < 0) return { contents };
      const decodedEnd = decodedStart + qi.textSpan.length;
      const startPos = m.getPositionAt(loc.rangeStart + decodedToRawOffset(loc.map, decodedStart));
      const endPos = m.getPositionAt(loc.rangeStart + decodedToRawOffset(loc.map, decodedEnd));
      return { range: monaco.Range.fromPositions(startPos, endPos), contents };
    },
  });

  /* ---- signature help (calling ctx helpers inside slot strings) ---- */
  const signatureHelp = monaco.languages.registerSignatureHelpProvider("json", {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [")"],
    async provideSignatureHelp(m, position) {
      if (!isOurModel(m)) return null;
      const spec = getSpec();
      if (!spec) return null;
      const loc = locate(m.getOffsetAt(position), spec);
      if (!loc) return null;
      const client = await tsClient(loc.hidden.uri);
      const help = await client.getSignatureHelpItems(loc.hidden.uri.toString(), loc.hiddenOffset, {});
      if (!help) return null;
      const signatures = (help.items as any[]).map((it) => {
        const parameters = (it.parameters as any[]).map((p) => ({
          label: partsToString(p.displayParts),
          documentation: partsToString(p.documentation),
        }));
        const label =
          partsToString(it.prefixDisplayParts) +
          parameters.map((p) => p.label).join(partsToString(it.separatorDisplayParts)) +
          partsToString(it.suffixDisplayParts);
        return { label, documentation: partsToString(it.documentation), parameters };
      });
      return {
        value: {
          signatures,
          activeSignature: help.selectedItemIndex ?? 0,
          activeParameter: help.argumentIndex ?? 0,
        },
        dispose() {},
      };
    },
  });

  /* ---- diagnostics ---- */
  function structuralMarker(text: string, err: JsonExeErrorObject): M.editor.IMarkerData {
    let range: { start: number; end: number } | undefined;
    if (err.slot) {
      const r = collectSlotStrings(text, new Set([err.slot]))[0];
      if (r) range = { start: r.start - 1, end: r.end + 1 };
    }
    if (!range && err.field) range = findValueRange(text, err.field);
    if (!range && err.kind === "KindMismatchError") range = findValueRange(text, "$kind");
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.min(1, text.length);
    const sp = extModel.getPositionAt(start);
    const ep = extModel.getPositionAt(end);
    return {
      severity: monaco.MarkerSeverity.Error,
      message: `${err.kind}: ${err.message}`,
      startLineNumber: sp.lineNumber,
      startColumn: sp.column,
      endLineNumber: ep.lineNumber,
      endColumn: ep.column,
      source: OWNER,
    };
  }

  async function runDiagnostics(): Promise<void> {
    const gen = ++runGeneration;
    const version = extModel.getVersionId();
    const stale = () => gen !== runGeneration || extModel.getVersionId() !== version;

    const spec = getSpec();
    if (!spec) {
      monaco.editor.setModelMarkers(extModel, OWNER, []);
      pruneHidden(new Set());
      return;
    }
    const text = extModel.getValue();
    const markers: M.editor.IMarkerData[] = [];

    schemaRegistry.set(fileUri, specToJsonSchema(spec));
    applySchemas(monaco);

    let parsed: unknown;
    let parseOk = true;
    try {
      parsed = text.trim() ? JSON.parse(text) : {};
    } catch {
      parseOk = false;
    }
    if (parseOk) {
      for (const err of validateExtension(spec, parsed).errors) {
        markers.push(structuralMarker(text, err));
      }
    }

    const slotSet = new Set(Object.keys(spec.slots));
    const ranges = collectSlotStrings(text, slotSet);
    pruneHidden(new Set(ranges.map((r) => r.slot)));
    const decls = synthesizeCtxDecls(spec);

    for (const r of ranges) {
      const raw = text.slice(r.start, r.end);
      const map = buildEscapeMap(raw);
      const returnType = schemaToTsType(spec.slots[r.slot]?.returns);
      const mod = buildSlotModule(decls, map.decoded.replace(/\r/g, "\n"), returnType);
      const model = ensureHidden(r.slot);
      if (model.getValue() !== mod.content) model.setValue(mod.content);
      const client = await tsClient(model.uri);
      const uri = model.uri.toString();
      const diags: TsDiagnostic[] = [
        ...(await client.getSyntacticDiagnostics(uri)),
        ...(await client.getSemanticDiagnostics(uri)),
      ];
      if (stale()) return;
      for (const d of diags) {
        if (d.start == null || d.length == null) continue;
        const decodedStart = d.start - mod.bodyOffset;
        if (decodedStart < 0 || decodedStart > map.decoded.length) continue;
        const decodedEnd = Math.min(decodedStart + d.length, map.decoded.length);
        const sp = extModel.getPositionAt(r.start + decodedToRawOffset(map, decodedStart));
        const ep = extModel.getPositionAt(r.start + decodedToRawOffset(map, decodedEnd));
        markers.push({
          severity:
            d.category === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: flattenMessage(d.messageText),
          startLineNumber: sp.lineNumber,
          startColumn: sp.column,
          endLineNumber: ep.lineNumber,
          endColumn: ep.column,
          source: "ts(ctx)",
        });
      }
    }

    if (stale()) return;
    monaco.editor.setModelMarkers(extModel, OWNER, markers);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function refresh(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runDiagnostics(), 300);
  }

  const sub = extModel.onDidChangeContent(() => refresh());
  refresh();

  return {
    refresh,
    dispose() {
      if (timer) clearTimeout(timer);
      sub.dispose();
      completion.dispose();
      hover.dispose();
      signatureHelp.dispose();
      for (const m of hidden.values()) m.dispose();
      hidden.clear();
      schemaRegistry.delete(fileUri);
      applySchemas(monaco);
      monaco.editor.setModelMarkers(extModel, OWNER, []);
    },
  };
}
