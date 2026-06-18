/**
 * Pure helpers for the embedded-TypeScript-in-JSON-string bridge. Kept free of
 * Monaco and the DOM so they can be unit-tested in Node.
 */
import { parseTree, type Node } from "jsonc-parser";
import type { ExtensionTypeSpec, Schema, SchemaObject } from "@json-exe/runtime";

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

// Primitives, keywords, and type operators that must NOT be aliased to `any`.
const TS_PRIMITIVES = new Set([
  "string", "number", "boolean", "unknown", "any", "void", "null",
  "undefined", "never", "object", "symbol", "bigint", "this", "true",
  "false", "readonly", "keyof", "typeof", "infer", "extends", "in", "is",
  "asserts", "as", "new", "const",
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
    // Alias any identifier (regardless of case) that isn't a built-in type or a
    // TS primitive/keyword, so custom host type names don't error. Aliasing the
    // occasional property name is harmless (an unused `type` declaration).
    for (const m of typeText.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const id = m[1]!;
      if (BUILTIN_TYPES.has(id) || TS_PRIMITIVES.has(id)) continue;
      unknownTypes.add(id);
    }
  }
  const aliases = [...unknownTypes].map((t) => `type ${t} = any;`).join("\n");
  const fields = entries.length
    ? entries.map(([k, t]) => `  ${JSON.stringify(k)}: ${t};`).join("\n")
    : "  [key: string]: unknown;";
  return `${aliases}${aliases ? "\n" : ""}declare const ctx: {\n${fields}\n};\n`;
}

/**
 * Build a lenient JSON Schema from a spec to power *key* completions in the
 * extension editor (slot names, $kind, static fields). Intentionally carries no
 * validation constraints (only descriptions + a $kind default) so it never
 * duplicates the runtime's structural diagnostics or suppresses JSON syntax
 * errors.
 */
export function specToJsonSchema(spec: ExtensionTypeSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    $schema: { type: "string", description: "Schema URL." },
    $kind: { description: `Extension kind. Expected: ${spec.kind}`, default: spec.kind },
    $id: { type: "string" },
    $version: { type: "string" },
    $permissions: { type: "object", description: "Declared permission manifest." },
    $tests: { type: "array", description: "Embedded test cases." },
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
  };
  for (const [name, slotSpec] of Object.entries(spec.slots)) {
    properties[name] = {
      description: slotSpec.description
        ? `slot — ${slotSpec.description}`
        : `slot "${name}" (JavaScript source string)`,
    };
  }
  for (const [field, fieldSpec] of Object.entries(spec.staticFields ?? {})) {
    properties[field] = {
      description: fieldSpec.description ?? `static field "${field}"`,
    };
  }
  return { type: "object", properties, additionalProperties: true };
}

function tsForTypeName(name: string, s: SchemaObject): string {
  switch (name) {
    case "string": return "string";
    case "number":
    case "integer": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "array": return s.items ? `Array<${schemaToTsType(s.items)}>` : "unknown[]";
    case "object": return "Record<string, unknown>";
    default: return "unknown"; // "any"/"unknown"/documentation-style names
  }
}

/**
 * Translate a slot `returns` schema into a TypeScript type, so the embedded
 * service can check that a slot's body returns the declared type. Enums become
 * string-literal unions (giving both rejection and value autocomplete).
 */
export function schemaToTsType(schema: Schema | undefined): string {
  if (schema === undefined) return "unknown";
  if (typeof schema === "string") return tsForTypeName(schema, {});
  const s = schema;
  let base: string;
  if (s.const !== undefined) {
    base = JSON.stringify(s.const);
  } else if (s.enum) {
    base = s.enum.length ? s.enum.map((v) => JSON.stringify(v)).join(" | ") : "never";
  } else if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    base = types.map((t) => tsForTypeName(t, s)).join(" | ");
  } else {
    base = "unknown";
  }
  return s.nullable ? `${base} | null` : base;
}

export interface SlotModule {
  content: string;
  /** Offset in `content` where the (decoded) slot source begins. */
  bodyOffset: number;
}

/**
 * Build the hidden TS module that wraps a slot's decoded source. The wrapper's
 * return type comes from the slot's `returns` schema so the body is checked
 * against the declared contract.
 */
export function buildSlotModule(
  decls: string,
  decodedSource: string,
  returnType = "unknown",
): SlotModule {
  const prefix = `${decls}export {};\nasync function __slot__(): Promise<${returnType}> {\n`;
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
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            val = String.fromCharCode(Number.parseInt(hex, 16));
            len = 6;
          } else {
            val = "u"; // malformed \u escape — treat as a literal 'u'
            len = 2;
          }
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
