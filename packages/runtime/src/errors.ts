/**
 * Structured error types for JSON.exe.
 *
 * Every runtime failure is an instance of {@link JsonExeError} carrying a stable
 * `kind` string plus contextual fields, and serializes to a plain
 * {@link JsonExeErrorObject} via `toJSON()` for traces, API responses, and
 * repair prompts. Errors never embed `ctx` values, so secrets do not leak.
 */
import type { JsonExeErrorObject } from "./types";

export interface JsonExeErrorInit {
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
  errors?: JsonExeErrorObject[];
  /** Extra human-readable detail appended to the default message. */
  reason?: string;
  cause?: unknown;
}

/** Mutable execution context applied to an error after the fact. */
export interface ErrorContext {
  extensionId?: string;
  phase?: string;
  traceId?: string;
}

export abstract class JsonExeError extends Error {
  abstract readonly kind: string;

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
  errors?: JsonExeErrorObject[];

  constructor(message: string, init: JsonExeErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    if (init.slot !== undefined) this.slot = init.slot;
    if (init.field !== undefined) this.field = init.field;
    if (init.extensionId !== undefined) this.extensionId = init.extensionId;
    if (init.phase !== undefined) this.phase = init.phase;
    if (init.traceId !== undefined) this.traceId = init.traceId;
    if (init.expected !== undefined) this.expected = init.expected;
    if (init.received !== undefined) this.received = init.received;
    if (init.line !== undefined) this.line = init.line;
    if (init.column !== undefined) this.column = init.column;
    if (init.permission !== undefined) this.permission = init.permission;
    if (init.timeoutMs !== undefined) this.timeoutMs = init.timeoutMs;
    if (init.errors !== undefined) this.errors = init.errors;
  }

  /** Attach (or override) the extension id when it becomes known. */
  withExtensionId(extensionId: string | undefined): this {
    if (extensionId !== undefined && this.extensionId === undefined) {
      this.extensionId = extensionId;
    }
    return this;
  }

  /** Fill in execution context (extension id, phase, trace id) if not set. */
  withContext(context: ErrorContext): this {
    if (context.extensionId !== undefined && this.extensionId === undefined) {
      this.extensionId = context.extensionId;
    }
    if (context.phase !== undefined && this.phase === undefined) {
      this.phase = context.phase;
    }
    if (context.traceId !== undefined && this.traceId === undefined) {
      this.traceId = context.traceId;
    }
    return this;
  }

  toJSON(): JsonExeErrorObject {
    const o: JsonExeErrorObject = { kind: this.kind, message: this.message };
    if (this.slot !== undefined) o.slot = this.slot;
    if (this.field !== undefined) o.field = this.field;
    if (this.extensionId !== undefined) o.extensionId = this.extensionId;
    if (this.phase !== undefined) o.phase = this.phase;
    if (this.traceId !== undefined) o.traceId = this.traceId;
    if (this.expected !== undefined) o.expected = this.expected;
    if (this.received !== undefined) o.received = this.received;
    if (this.line !== undefined) o.line = this.line;
    if (this.column !== undefined) o.column = this.column;
    if (this.permission !== undefined) o.permission = this.permission;
    if (this.timeoutMs !== undefined) o.timeoutMs = this.timeoutMs;
    if (this.errors !== undefined) o.errors = this.errors;
    return o;
  }

  /** Convenience: `{ ok: false, error: this.toJSON() }`. */
  toResult(): { ok: false; error: JsonExeErrorObject } {
    return { ok: false, error: this.toJSON() };
  }
}

export class ParseError extends JsonExeError {
  readonly kind = "ParseError";
}

export class KindMismatchError extends JsonExeError {
  readonly kind = "KindMismatchError";
  constructor(expected: string, received: string, init: JsonExeErrorInit = {}) {
    super(
      `Extension $kind "${received}" does not match expected kind "${expected}".`,
      { ...init, expected, received },
    );
  }
}

export class StaticFieldValidationError extends JsonExeError {
  readonly kind = "StaticFieldValidationError";
  constructor(
    field: string,
    expected: string,
    received: string,
    message?: string,
    init: JsonExeErrorInit = {},
  ) {
    super(message ?? `Static field "${field}" failed validation.`, {
      ...init,
      field,
      expected,
      received,
    });
  }
}

export class MissingRequiredSlotError extends JsonExeError {
  readonly kind = "MissingRequiredSlotError";
  constructor(slot: string, init: JsonExeErrorInit = {}) {
    super(`Required slot "${slot}" is missing.`, { ...init, slot });
  }
}

export class UnknownSlotError extends JsonExeError {
  readonly kind = "UnknownSlotError";
  constructor(slot: string, init: JsonExeErrorInit = {}) {
    super(`Unknown field "${slot}" is not a declared slot or static field.`, {
      ...init,
      slot,
    });
  }
}

export class SlotNotFoundError extends JsonExeError {
  readonly kind = "SlotNotFoundError";
  constructor(slot: string, init: JsonExeErrorInit = {}) {
    super(`Slot "${slot}" is not compiled on this extension.`, { ...init, slot });
  }
}

export class SlotCompileError extends JsonExeError {
  readonly kind = "SlotCompileError";
  constructor(slot: string, message: string, init: JsonExeErrorInit = {}) {
    super(`Slot "${slot}" failed to compile: ${message}`, { ...init, slot });
  }
}

export class SlotRuntimeError extends JsonExeError {
  readonly kind = "SlotRuntimeError";
  constructor(slot: string, message: string, init: JsonExeErrorInit = {}) {
    super(message, { ...init, slot });
  }
}

export class ReturnValidationError extends JsonExeError {
  readonly kind = "ReturnValidationError";
  constructor(
    slot: string,
    expected: string,
    received: string,
    init: JsonExeErrorInit = {},
  ) {
    const base = `Slot "${slot}" returned ${received} but expected ${expected}.`;
    super(init.reason ? `${base} ${init.reason}` : base, {
      ...init,
      slot,
      expected,
      received,
    });
  }
}

export class TimeoutError extends JsonExeError {
  readonly kind = "TimeoutError";
  constructor(slot: string, timeoutMs: number, init: JsonExeErrorInit = {}) {
    super(`Slot "${slot}" timed out after ${timeoutMs}ms.`, {
      ...init,
      slot,
      timeoutMs,
    });
  }
}

export class PermissionError extends JsonExeError {
  readonly kind = "PermissionError";
  constructor(message: string, init: JsonExeErrorInit = {}) {
    super(message, init);
  }
}

export class ValidationError extends JsonExeError {
  readonly kind = "ValidationError";
  constructor(errors: JsonExeErrorObject[], init: JsonExeErrorInit = {}) {
    super(
      `Extension failed validation with ${errors.length} error(s).`,
      { ...init, errors },
    );
  }
}

/** Coerce any thrown value into a {@link JsonExeError}, applying context. */
export function toJsonExeError(
  err: unknown,
  slot: string,
  context: ErrorContext = {},
): JsonExeError {
  if (err instanceof JsonExeError) return err.withContext(context);
  const message = err instanceof Error ? err.message : String(err);
  return new SlotRuntimeError(slot, message, {
    extensionId: context.extensionId,
    phase: context.phase,
    traceId: context.traceId,
    cause: err,
  });
}
