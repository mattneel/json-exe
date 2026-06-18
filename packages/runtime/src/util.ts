/**
 * Recursively freeze an object graph in place. Cycle-safe.
 *
 * Note: this mutates the passed object (and its reachable children) by calling
 * `Object.freeze`. It is the opt-in `freezeContext` behaviour — the host's own
 * objects passed in `ctx` become immutable.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null) return value;
  const t = typeof value;
  if (t !== "object" && t !== "function") return value;

  const obj = value as unknown as object;
  if (seen.has(obj)) return value;
  seen.add(obj);

  for (const key of Object.getOwnPropertyNames(obj)) {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    // Skip accessor properties — invoking a getter here could have side effects.
    if (!descriptor || "get" in descriptor) continue;
    deepFreeze(descriptor.value, seen);
  }

  Object.freeze(obj);
  return value;
}

/**
 * Generate a UUID-ish id for trace correlation. Prefers the platform
 * `crypto.randomUUID` (Node 19+, modern browsers, workers); falls back to a
 * non-cryptographic generator so the runtime stays portable and dependency-free
 * across Node, browsers, Deno, and edge runtimes.
 */
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Coerce an unknown thrown value into a readable message string. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return String(err);
  } catch {
    return "Unknown error";
  }
}
