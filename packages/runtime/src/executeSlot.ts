/**
 * The execution core: run one compiled slot function against a `ctx`, enforce
 * an optional timeout, validate the return value, and produce a trace record.
 *
 * This module never throws — it always resolves to an {@link InternalResult}
 * carrying both the public {@link SlotResult} and (on failure) the original
 * {@link JsonExeError} instance so callers can choose to throw or not.
 */
import { randomUUID } from "node:crypto";
import type {
  CompiledFn,
  Schema,
  SlotResult,
  TraceRecord,
  TraceSink,
} from "./types";
import {
  JsonExeError,
  ReturnValidationError,
  SlotNotFoundError,
  TimeoutError,
  toJsonExeError,
} from "./errors";
import { validateAgainstSchema } from "./schema";
import { deepFreeze } from "./util";

export interface InternalResult {
  public: SlotResult;
  errorInstance?: JsonExeError;
}

export interface ExecuteParams {
  slot: string;
  fn: CompiledFn | undefined;
  ctx: unknown;
  returns?: Schema;
  validateReturns: boolean;
  timeoutMs?: number;
  freezeContext: boolean;
  extensionId?: string;
  phase?: string;
  trace?: TraceSink;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  slot: string,
  extensionId?: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(slot, ms, { extensionId }));
    }, ms);
    if (typeof timer.unref === "function") timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function executeSlot(p: ExecuteParams): Promise<InternalResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const traceId = randomUUID();

  const record: TraceRecord = {
    slot: p.slot,
    startedAt,
    durationMs: 0,
    ok: false,
    traceId,
  };
  if (p.extensionId !== undefined) record.extensionId = p.extensionId;
  if (p.phase !== undefined) record.phase = p.phase;

  let errorInstance: JsonExeError | undefined;
  let publicResult: SlotResult;

  try {
    if (!p.fn) {
      throw new SlotNotFoundError(p.slot, { extensionId: p.extensionId });
    }

    const ctx = p.freezeContext ? deepFreeze(p.ctx) : p.ctx;

    // Always cross an async boundary so sync and async slots are handled
    // uniformly (and a sync `throw` becomes a rejected promise we can race).
    let execution = Promise.resolve().then(() => p.fn!(ctx));
    if (p.timeoutMs !== undefined && p.timeoutMs > 0) {
      execution = withTimeout(execution, p.timeoutMs, p.slot, p.extensionId);
    }
    const value = await execution;

    if (p.validateReturns && p.returns !== undefined) {
      const check = validateAgainstSchema(p.returns, value);
      if (!check.ok) {
        record.validation = {
          ok: false,
          expected: check.expected,
          received: check.received,
          message: check.message,
        };
        throw new ReturnValidationError(p.slot, check.expected, check.received, {
          extensionId: p.extensionId,
          reason: check.message,
        });
      }
      record.validation = { ok: true };
    }

    record.ok = true;
    record.result = value;
    publicResult = { ok: true, slot: p.slot, result: value };
  } catch (err) {
    errorInstance = toJsonExeError(err, p.slot, {
      extensionId: p.extensionId,
      phase: p.phase,
      traceId,
    });
    record.ok = false;
    record.error = errorInstance.toJSON();
    publicResult = { ok: false, slot: p.slot, error: errorInstance.toJSON() };
  } finally {
    record.durationMs = performance.now() - start;
    if (p.trace) p.trace.record(record);
  }

  publicResult.trace = record;
  return { public: publicResult, errorInstance };
}
