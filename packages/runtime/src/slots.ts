import type { ExtensionJson } from "./types";

/**
 * Resolve the source for a slot name, supporting both flat dotted keys
 * (`"state.init"`) and nested objects (`{ state: { init: "..." } }`).
 * Flat keys take precedence. The canonical slot name is always the dotted path.
 */
export function getSlotSource(ext: ExtensionJson, name: string): unknown {
  const record = ext as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, name)) {
    return record[name];
  }
  if (name.includes(".")) {
    const parts = name.split(".");
    let cur: unknown = record;
    for (const part of parts) {
      if (
        cur === null ||
        typeof cur !== "object" ||
        !Object.prototype.hasOwnProperty.call(cur, part)
      ) {
        return undefined;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }
  return undefined;
}
