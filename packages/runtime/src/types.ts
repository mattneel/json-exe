/**
 * Core type definitions for JSON.exe.
 *
 * These types describe the contract between a host application (which defines
 * extension types) and the runtime (which compiles and executes the JSON
 * extensions written against those types).
 */

/* -------------------------------------------------------------------------- */
/* Schema (a tiny JSON-Schema subset used for return / static-field checking)  */
/* -------------------------------------------------------------------------- */

export type SchemaTypeName =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null"
  | "unknown"
  | "any";

export interface SchemaObject {
  /** One type or a union of accepted types. */
  type?: SchemaTypeName | readonly SchemaTypeName[];
  /** Value must deep-equal one of these. */
  enum?: readonly unknown[];
  /** Value must deep-equal this constant. */
  const?: unknown;
  /** Permit `null` in addition to `type`. */
  nullable?: boolean;

  /* object */
  required?: readonly string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;

  /* array */
  items?: Schema;

  /* number / integer */
  minimum?: number;
  maximum?: number;

  /* string */
  pattern?: string;
  minLength?: number;
  maxLength?: number;

  description?: string;
}

/**
 * A schema is either a type-name shorthand (e.g. `"boolean"`) or a schema
 * object. Unknown type names (and `"unknown"` / `"any"`) impose no constraint,
 * which lets hosts reuse documentation-style type names without false failures.
 */
export type Schema = SchemaTypeName | (string & {}) | SchemaObject;

/* -------------------------------------------------------------------------- */
/* Extension type spec                                                         */
/* -------------------------------------------------------------------------- */

/** Documentation-only TypeScript type annotations for `ctx` fields. */
export type ContextSpec = Record<string, string>;

export type SlotPhase = "init" | "match" | "run" | "render" | "cleanup";

export interface SlotSpec {
  description?: string;
  required?: boolean;
  /** When true the slot body may use `await` and is run as an async function. */
  async?: boolean;
  phase?: SlotPhase;
  /** Schema the slot's return value is validated against. */
  returns?: Schema;
  /** Documentation for the shape of any params folded into `ctx`. */
  params?: Schema;
  /** `ctx` paths the slot is expected to read (documentation / future static analysis). */
  reads?: string[];
  /** `ctx` paths / state keys the slot is expected to write. */
  writes?: string[];
  /** Capability identifiers the slot needs (matched against the permission manifest). */
  permissions?: string[];
  /** Per-slot wall-clock timeout in milliseconds (best-effort for async slots). */
  timeoutMs?: number;
  maxCalls?: number;
  examples?: string[];
}

export interface StaticFieldSpec {
  required?: boolean;
  schema: Schema;
  description?: string;
}

export interface PermissionSpec {
  tools?: string[];
  network?: boolean;
  memory?: "none" | "read" | "write";
  [capability: string]: unknown;
}

export interface LifecycleSpec {
  /** Recommended slot evaluation order (documentation / helper use). */
  order?: string[];
  [key: string]: unknown;
}

export interface ExtensionTest {
  name: string;
  slot: string;
  ctx?: unknown;
  /** Expected (deep-equal) return value. */
  expect?: unknown;
  /**
   * When set, the test passes if the slot throws an error of this `kind`
   * (string), or any error (`true`).
   */
  throws?: string | boolean;
}

export interface ExtensionTypeSpec {
  kind: string;
  version?: string;
  description?: string;
  staticFields?: Record<string, StaticFieldSpec>;
  context?: ContextSpec;
  slots: Record<string, SlotSpec>;
  permissions?: PermissionSpec;
  lifecycle?: LifecycleSpec;
  tests?: ExtensionTest[];
  /**
   * Policy for slot-shaped fields present in the JSON but not declared in
   * `slots`. Defaults to `"ignore"`.
   */
  unknownSlots?: "ignore" | "error";
}

/* -------------------------------------------------------------------------- */
/* Extension JSON object                                                       */
/* -------------------------------------------------------------------------- */

export interface ExtensionJson {
  $schema?: string;
  $kind?: string;
  $id?: string;
  $version?: string;
  $meta?: Record<string, unknown>;
  $permissions?: PermissionSpec;
  $tests?: ExtensionTest[];
  $examples?: unknown[];
  id?: string;
  name?: string;
  description?: string;
  [field: string]: unknown;
}

/** Reserved top-level field names (see SPEC §5.1). */
export const RESERVED_FIELDS = [
  "$schema",
  "$kind",
  "$id",
  "$version",
  "$meta",
  "$permissions",
  "$tests",
  "$examples",
] as const;

/** Standard metadata fields that are always allowed (never treated as slots). */
export const STANDARD_METADATA_FIELDS = [
  "id",
  "name",
  "title",
  "description",
  "author",
  "license",
  "tags",
  "icon",
] as const;

/* -------------------------------------------------------------------------- */
/* Errors / traces                                                             */
/* -------------------------------------------------------------------------- */

export interface JsonExeErrorObject {
  kind: string;
  message: string;
  slot?: string;
  field?: string;
  extensionId?: string;
  phase?: string;
  traceId?: string;
  expected?: string;
  received?: string;
  line?: number;
  column?: number;
  permission?: string;
  timeoutMs?: number;
  /** Aggregate errors (e.g. validation results). */
  errors?: JsonExeErrorObject[];
}

export interface ReturnValidation {
  ok: boolean;
  expected?: string;
  received?: string;
  message?: string;
}

export interface TraceRecord {
  slot: string;
  extensionId?: string;
  phase?: string;
  traceId?: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  result?: unknown;
  error?: JsonExeErrorObject;
  validation?: ReturnValidation;
}

export interface TraceSink {
  record(record: TraceRecord): void;
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

export interface SlotResult<T = unknown> {
  ok: boolean;
  slot: string;
  result?: T;
  error?: JsonExeErrorObject;
  trace?: TraceRecord;
}

export interface CompileInput {
  slot: string;
  source: string;
  async: boolean;
  timeoutMs?: number;
}

export type CompiledFn = (ctx: unknown) => unknown | Promise<unknown>;

export interface Evaluator {
  readonly name: string;
  compile(input: CompileInput): CompiledFn | Promise<CompiledFn>;
}

export interface CompileOptions {
  /** Evaluator instance, or the built-in id `"unsafe-new-function"`. */
  evaluator?: Evaluator | "unsafe-new-function";
  /** Deep-freeze `ctx` (in place) before each run. */
  freezeContext?: boolean;
  /** Default per-slot timeout (ms) used when a slot spec doesn't set one. */
  defaultTimeoutMs?: number;
  /** Override the spec's unknown-slot policy. */
  unknownSlots?: "ignore" | "error";
  /** Permissions the host grants; declared `$permissions` are checked against these. */
  grantedPermissions?: PermissionSpec;
  /**
   * Enforce the declared-vs-granted permission check even when
   * `grantedPermissions` is omitted (treated as an empty grant — deny all
   * declared permissions). When omitted, the check runs only if
   * `grantedPermissions` is provided (trusting default for dev/local use).
   */
  enforcePermissions?: boolean;
  /** Validate slot return values against their declared schema (default true). */
  validateReturns?: boolean;
}

export interface RunOptions {
  /** Collect a trace: `true` for one attached to the result, or your own sink. */
  trace?: boolean | TraceSink;
  /** Override the slot's timeout for this run. */
  timeoutMs?: number;
}

export interface CompiledSlotInfo {
  name: string;
  required: boolean;
  compiled: boolean;
  async: boolean;
  phase?: SlotPhase;
  description?: string;
}

export interface CompiledExtension {
  kind: string;
  id?: string;
  spec: ExtensionTypeSpec;
  json: ExtensionJson;
  has(slot: string): boolean;
  slots(): CompiledSlotInfo[];
  /** Run a slot, returning the validated result or throwing a {@link JsonExeError}. */
  run<T = unknown>(slot: string, ctx?: unknown, options?: RunOptions): Promise<T>;
  /** Run a slot without throwing — returns a {@link SlotResult} envelope incl. trace. */
  exec<T = unknown>(
    slot: string,
    ctx?: unknown,
    options?: RunOptions,
  ): Promise<SlotResult<T>>;
}

export interface ValidationResult {
  ok: boolean;
  errors: JsonExeErrorObject[];
}

export interface JsonExeRuntime {
  compile(
    spec: ExtensionTypeSpec,
    json: unknown,
    options?: CompileOptions,
  ): Promise<CompiledExtension>;
  validate(spec: ExtensionTypeSpec, json: unknown): ValidationResult;
}
