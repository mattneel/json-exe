/**
 * A tiny, dependency-free JSON-Schema subset validator.
 *
 * Supports the constructs used by JSON.exe specs: `type` (single or union),
 * `enum`, `const`, `nullable`, object `required` / `properties` /
 * `additionalProperties`, array `items`, plus basic string/number constraints.
 *
 * Unknown type names (and `"unknown"` / `"any"`) impose no constraint, so hosts
 * can reuse documentation-style type names in `returns` without false failures.
 */
import type { Schema, SchemaObject, SchemaTypeName } from "./types";

export interface SchemaCheckResult {
  ok: boolean;
  /** Human-readable description of what was expected. */
  expected: string;
  /** Human-readable description of what was received. */
  received: string;
  /** Path within the value where validation failed (for nested checks). */
  path?: string;
  message?: string;
}

const KNOWN_TYPES = new Set<SchemaTypeName>([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
  "unknown",
  "any",
]);

/** Describe the runtime type of a value (with null/array/integer refinements). */
export function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "number" && Number.isNaN(value)) return "NaN";
  return t;
}

/** Describe a schema in a short, human-readable way. */
export function describeSchema(schema: Schema): string {
  if (typeof schema === "string") return schema;
  const s = schema;
  if (s.enum) return `one of ${JSON.stringify(s.enum)}`;
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    return types.join("|");
  }
  return "unknown";
}

/** Structural deep equality for JSON-ish values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;

  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSchema(schema: Schema): SchemaObject {
  if (typeof schema === "string") {
    if (schema === "unknown" || schema === "any") return {};
    return { type: schema as SchemaTypeName };
  }
  return schema;
}

function matchesType(type: SchemaTypeName, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    case "unknown":
    case "any":
      return true;
    default:
      // Unrecognized (documentation-style) type name → impose no constraint.
      return !KNOWN_TYPES.has(type) ? true : false;
  }
}

/**
 * Validate `value` against `schema`. Always returns a result object describing
 * the outcome (it never throws for an invalid value).
 */
export function validateAgainstSchema(
  schema: Schema,
  value: unknown,
  path = "$",
): SchemaCheckResult {
  const expected = describeSchema(schema);
  const received = describeType(value);
  const fail = (message: string, failPath = path): SchemaCheckResult => ({
    ok: false,
    expected,
    received,
    path: failPath,
    message,
  });
  const pass = (): SchemaCheckResult => ({ ok: true, expected, received });

  const s = normalizeSchema(schema);

  // const / enum are evaluated first so they handle null correctly (via
  // deepEqual) and so a null value can neither bypass nor be wrongly rejected
  // by them.
  if (s.const !== undefined) {
    return deepEqual(value, s.const)
      ? pass()
      : fail(`Expected constant ${JSON.stringify(s.const)}.`);
  }
  if (s.enum !== undefined) {
    return s.enum.some((candidate) => deepEqual(candidate, value))
      ? pass()
      : fail(`Expected one of ${JSON.stringify(s.enum)}.`);
  }

  const hasObjectConstraints =
    s.required !== undefined ||
    s.properties !== undefined ||
    s.additionalProperties !== undefined;
  const hasContainerConstraints = hasObjectConstraints || s.items !== undefined;

  // null handling (const/enum already returned above).
  if (value === null) {
    const typeAllowsNull =
      s.nullable === true ||
      s.type === "null" ||
      (Array.isArray(s.type) && s.type.includes("null"));
    if (typeAllowsNull) return pass();
    if (s.type !== undefined) {
      return fail(`Expected ${expected}, received null.`);
    }
    // No type declared: null is allowed unless object/array constraints are
    // present (null satisfies none of them).
    if (hasContainerConstraints) {
      return fail("Expected an object or array, received null.");
    }
    return pass();
  }

  // type
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => matchesType(t, value))) {
      return fail(`Expected type ${types.join("|")}, received ${received}.`);
    }
  }

  // object constraints
  if (isPlainObject(value)) {
    if (s.required) {
      for (const key of s.required) {
        if (
          !Object.prototype.hasOwnProperty.call(value, key) ||
          value[key] === undefined
        ) {
          return fail(`Missing required property "${key}".`, `${path}.${key}`);
        }
      }
    }
    if (s.properties) {
      for (const [key, sub] of Object.entries(s.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const r = validateAgainstSchema(sub, value[key], `${path}.${key}`);
          if (!r.ok) return r;
        }
      }
    }
    if (s.additionalProperties === false) {
      const allowed = new Set(Object.keys(s.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          return fail(`Unexpected property "${key}".`, `${path}.${key}`);
        }
      }
    }
  }

  // array constraints
  if (Array.isArray(value) && s.items) {
    for (let i = 0; i < value.length; i++) {
      const r = validateAgainstSchema(s.items, value[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
  }

  // string constraints
  if (typeof value === "string") {
    if (s.minLength !== undefined && value.length < s.minLength) {
      return fail(`String shorter than minLength ${s.minLength}.`);
    }
    if (s.maxLength !== undefined && value.length > s.maxLength) {
      return fail(`String longer than maxLength ${s.maxLength}.`);
    }
    if (s.pattern !== undefined && !new RegExp(s.pattern).test(value)) {
      return fail(`String does not match pattern /${s.pattern}/.`);
    }
  }

  // number constraints
  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) {
      return fail(`Number below minimum ${s.minimum}.`);
    }
    if (s.maximum !== undefined && value > s.maximum) {
      return fail(`Number above maximum ${s.maximum}.`);
    }
  }

  return pass();
}
