/**
 * Pure helpers for the embedded-TypeScript-in-JSON-string bridge. Kept free of
 * Monaco and the DOM so they can be unit-tested in Node.
 */
import { parseTree, type Node } from "jsonc-parser";
import type { ExtensionTypeSpec } from "@json-exe/runtime";

export interface SlotStringRange {
  slot: string;
  /** Offset of the first character of the JSON string content (after the quote). */
  start: number;
  /** Offset just past the last character of the content (before the quote). */
  end: number;
}

/** Find every JSON string value whose dotted key path is a declared slot. */
export function collectSlotStrings(
  text: string,
  slots: ReadonlySet<string>,
): SlotStringRange[] {
  const root = parseTree(text);
  const out: SlotStringRange[] = [];
  if (!root || root.type !== "object") return out;

  const visit = (node: Node, path: string[]): void => {
    if (node.type !== "object" || !node.children) return;
    for (const prop of node.children) {
      if (prop.type !== "property" || !prop.children) continue;
      const keyNode = prop.children[0];
      const valNode = prop.children[1];
      if (!keyNode || !valNode || typeof keyNode.value !== "string") continue;
      const dotted = [...path, keyNode.value].join(".");
      if (valNode.type === "string" && slots.has(dotted)) {
        out.push({
          slot: dotted,
          start: valNode.offset + 1,
          end: valNode.offset + valNode.length - 1,
        });
      } else if (valNode.type === "object") {
        visit(valNode, [...path, keyNode.value]);
      }
    }
  };

  visit(root, []);
  return out;
}

/** Find the [start, end) offsets of a top-level property's value node. */
export function findValueRange(
  text: string,
  key: string,
): { start: number; end: number } | undefined {
  const root = parseTree(text);
  if (!root || root.type !== "object" || !root.children) return undefined;
  for (const prop of root.children) {
    if (prop.type !== "property" || !prop.children) continue;
    const keyNode = prop.children[0];
    const valNode = prop.children[1];
    if (keyNode?.value === key && valNode) {
      return { start: valNode.offset, end: valNode.offset + valNode.length };
    }
  }
  return undefined;
}

const BUILTIN_TYPES = new Set([
  "Record", "Array", "ReadonlyArray", "Partial", "Required", "Readonly",
  "Pick", "Omit", "Promise", "Date", "Map", "Set", "WeakMap", "WeakSet",
  "RegExp", "Object", "String", "Number", "Boolean", "Function", "Error",
  "Iterable", "AsyncIterable", "Exclude", "Extract", "NonNullable",
]);

/**
 * Synthesize ambient TypeScript declaring `ctx` from a spec's context map.
 * Capitalized identifiers in the type strings that aren't built-ins are aliased
 * to `any` so the synthesized module type-checks.
 */
export function synthesizeCtxDecls(spec: ExtensionTypeSpec): string {
  const entries = Object.entries(spec.context ?? {});
  const unknownTypes = new Set<string>();
  for (const [, typeText] of entries) {
    for (const m of typeText.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      const id = m[1]!;
      if (!BUILTIN_TYPES.has(id)) unknownTypes.add(id);
    }
  }
  const aliases = [...unknownTypes].map((t) => `type ${t} = any;`).join("\n");
  const fields = entries.length
    ? entries.map(([k, t]) => `  ${JSON.stringify(k)}: ${t};`).join("\n")
    : "  [key: string]: unknown;";
  return `${aliases}${aliases ? "\n" : ""}declare const ctx: {\n${fields}\n};\n`;
}

export interface SlotModule {
  content: string;
  /** Offset in `content` where the (decoded) slot source begins. */
  bodyOffset: number;
}

/** Build the hidden TS module that wraps a slot's decoded source. */
export function buildSlotModule(decls: string, decodedSource: string): SlotModule {
  const prefix = `${decls}export {};\nasync function __slot__(): Promise<unknown> {\n`;
  return {
    content: `${prefix}${decodedSource}\n}\n`,
    bodyOffset: prefix.length,
  };
}

export interface EscapeMap {
  /** decodedToRaw[d] = raw offset where decoded char `d` begins. Length n+1. */
  decodedToRaw: number[];
  decoded: string;
}

/** Build a bidirectional offset map between a raw JSON string body and its decoded value. */
export function buildEscapeMap(raw: string): EscapeMap {
  const decodedToRaw: number[] = [];
  let decoded = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === "\\" && i + 1 < raw.length) {
      const n = raw[i + 1]!;
      let val: string;
      let len = 2;
      switch (n) {
        case "n": val = "\n"; break;
        case "t": val = "\t"; break;
        case "r": val = "\r"; break;
        case "b": val = "\b"; break;
        case "f": val = "\f"; break;
        case '"': val = '"'; break;
        case "\\": val = "\\"; break;
        case "/": val = "/"; break;
        case "u": {
          const hex = raw.slice(i + 2, i + 6);
          val = String.fromCharCode(Number.parseInt(hex, 16) || 0);
          len = 6;
          break;
        }
        default: val = n; break;
      }
      decodedToRaw.push(i);
      decoded += val;
      i += len;
    } else {
      decodedToRaw.push(i);
      decoded += ch;
      i += 1;
    }
  }
  decodedToRaw.push(raw.length); // end sentinel
  return { decodedToRaw, decoded };
}

/** Map a decoded-string offset to a raw-string offset. */
export function decodedToRawOffset(map: EscapeMap, decodedOffset: number): number {
  const d = Math.max(0, Math.min(decodedOffset, map.decodedToRaw.length - 1));
  return map.decodedToRaw[d]!;
}

/** Map a raw-string offset to a decoded-string offset. */
export function rawToDecodedOffset(map: EscapeMap, rawOffset: number): number {
  const arr = map.decodedToRaw;
  // Largest index d with arr[d] <= rawOffset.
  let lo = 0;
  let hi = arr.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= rawOffset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
