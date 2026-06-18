import {
  validateExtension,
  type ExtensionTypeSpec,
  type JsonExeErrorObject,
} from "@json-exe/runtime";
import { monaco } from "./setup";
import {
  buildEscapeMap,
  buildSlotModule,
  collectSlotStrings,
  decodedToRawOffset,
  findValueRange,
  rawToDecodedOffset,
  synthesizeCtxDecls,
  type EscapeMap,
} from "../lib/embed";

const OWNER = "jsonexe";

type GetSpec = () => ExtensionTypeSpec | undefined;

interface SlotLocation {
  slot: string;
  rangeStart: number;
  rangeEnd: number;
  hidden: monaco.editor.ITextModel;
  hiddenOffset: number;
  bodyOffset: number;
  map: EscapeMap;
}

interface TsDiagnostic {
  start?: number;
  length?: number;
  category: number;
  messageText: string | { messageText: string; next?: unknown[] };
}

function flattenMessage(
  messageText: string | { messageText: string; next?: unknown[] },
): string {
  if (typeof messageText === "string") return messageText;
  let out = messageText.messageText;
  const next = messageText.next as TsDiagnostic["messageText"][] | undefined;
  if (next) for (const n of next) out += " " + flattenMessage(n);
  return out;
}

function partsToString(parts: { text: string }[] | undefined): string {
  return (parts ?? []).map((p) => p.text).join("");
}

function mapKind(kind: string): monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "method": return K.Method;
    case "function": return K.Function;
    case "property": return K.Property;
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
}

export interface JsonExeLanguage {
  refresh(): void;
  dispose(): void;
}

/**
 * Install JSON.exe language-server ergonomics on the extension model:
 * embedded-TypeScript completions, hover, and diagnostics inside slot strings
 * (typed from the live spec's `context`), plus structural validation markers.
 */
export function installJsonExeLanguage(
  extModel: monaco.editor.ITextModel,
  getSpec: GetSpec,
): JsonExeLanguage {
  const hidden = new Map<string, monaco.editor.ITextModel>();

  function ensureHidden(slot: string): monaco.editor.ITextModel {
    let m = hidden.get(slot);
    if (!m) {
      const uri = monaco.Uri.parse(
        `inmemory://playground/__slots__/${encodeURIComponent(slot)}.ts`,
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
    const ranges = collectSlotStrings(text, slotSet);
    const hit = ranges.find((r) => offset >= r.start && offset <= r.end);
    if (!hit) return null;

    const raw = text.slice(hit.start, hit.end);
    const map = buildEscapeMap(raw);
    const mod = buildSlotModule(synthesizeCtxDecls(spec), map.decoded);
    const model = ensureHidden(hit.slot);
    if (model.getValue() !== mod.content) model.setValue(mod.content);

    const decodedOffset = rawToDecodedOffset(map, offset - hit.start);
    return {
      slot: hit.slot,
      rangeStart: hit.start,
      rangeEnd: hit.end,
      hidden: model,
      hiddenOffset: mod.bodyOffset + decodedOffset,
      bodyOffset: mod.bodyOffset,
      map,
    };
  }

  async function tsWorker(uri: monaco.Uri): Promise<any> {
    const getWorker = await monaco.typescript.getTypeScriptWorker();
    return getWorker(uri);
  }

  const completion = monaco.languages.registerCompletionItemProvider("json", {
    triggerCharacters: [".", '"', "'", " "],
    async provideCompletionItems(m, position) {
      if (m.uri.toString() !== extModel.uri.toString()) return null;
      const spec = getSpec();
      if (!spec) return null;
      const loc = locate(m.getOffsetAt(position), spec);
      if (!loc) return null;
      const client = await tsWorker(loc.hidden.uri);
      const info = await client.getCompletionsAtPosition(
        loc.hidden.uri.toString(),
        loc.hiddenOffset,
      );
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
          }),
        ),
      };
    },
  });

  const hover = monaco.languages.registerHoverProvider("json", {
    async provideHover(m, position) {
      if (m.uri.toString() !== extModel.uri.toString()) return null;
      const spec = getSpec();
      if (!spec) return null;
      const loc = locate(m.getOffsetAt(position), spec);
      if (!loc) return null;
      const client = await tsWorker(loc.hidden.uri);
      const qi = await client.getQuickInfoAtPosition(
        loc.hidden.uri.toString(),
        loc.hiddenOffset,
      );
      if (!qi) return null;
      const signature = partsToString(qi.displayParts);
      const docs = partsToString(qi.documentation);
      const decodedStart = qi.textSpan.start - loc.bodyOffset;
      const decodedEnd = decodedStart + qi.textSpan.length;
      const contents: monaco.IMarkdownString[] = [
        { value: "```typescript\n" + signature + "\n```" },
      ];
      if (docs) contents.push({ value: docs });
      if (decodedStart < 0) return { contents };
      const startPos = m.getPositionAt(loc.rangeStart + decodedToRawOffset(loc.map, decodedStart));
      const endPos = m.getPositionAt(loc.rangeStart + decodedToRawOffset(loc.map, decodedEnd));
      return { range: monaco.Range.fromPositions(startPos, endPos), contents };
    },
  });

  function structuralMarker(
    text: string,
    err: JsonExeErrorObject,
  ): monaco.editor.IMarkerData {
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
    const spec = getSpec();
    if (!spec) {
      monaco.editor.setModelMarkers(extModel, OWNER, []);
      pruneHidden(new Set());
      return;
    }
    const text = extModel.getValue();
    const markers: monaco.editor.IMarkerData[] = [];

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
      const mod = buildSlotModule(decls, map.decoded);
      const model = ensureHidden(r.slot);
      if (model.getValue() !== mod.content) model.setValue(mod.content);
      const client = await tsWorker(model.uri);
      const uri = model.uri.toString();
      const diags: TsDiagnostic[] = [
        ...(await client.getSyntacticDiagnostics(uri)),
        ...(await client.getSemanticDiagnostics(uri)),
      ];
      for (const d of diags) {
        if (d.start == null || d.length == null) continue;
        const decodedStart = d.start - mod.bodyOffset;
        if (decodedStart < 0 || decodedStart > map.decoded.length) continue;
        const decodedEnd = Math.min(decodedStart + d.length, map.decoded.length);
        const sp = extModel.getPositionAt(r.start + decodedToRawOffset(map, decodedStart));
        const ep = extModel.getPositionAt(r.start + decodedToRawOffset(map, decodedEnd));
        markers.push({
          severity: d.category === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: flattenMessage(d.messageText),
          startLineNumber: sp.lineNumber,
          startColumn: sp.column,
          endLineNumber: ep.lineNumber,
          endColumn: ep.column,
          source: "ts(ctx)",
        });
      }
    }

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
      for (const m of hidden.values()) m.dispose();
      hidden.clear();
      monaco.editor.setModelMarkers(extModel, OWNER, []);
    },
  };
}
