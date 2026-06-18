import {
  compileExtension,
  JsonExeError,
  type Evaluator,
  type ExtensionTypeSpec,
  type JsonExeErrorObject,
  type SlotResult,
} from "@json-exe/runtime";
import { testExtension, type TestReport } from "@json-exe/testing";

export interface JsonParseResult<T> {
  value?: T;
  error?: string;
}

export function parseJson<T = unknown>(
  text: string,
  label: string,
): JsonParseResult<T> {
  const trimmed = text.trim();
  if (!trimmed) return { value: {} as T };
  try {
    return { value: JSON.parse(trimmed) as T };
  } catch (err) {
    return { error: `${label} is not valid JSON: ${(err as Error).message}` };
  }
}

export function toErrorObject(err: unknown): JsonExeErrorObject {
  if (err instanceof JsonExeError) return err.toJSON();
  return { kind: "Error", message: (err as Error)?.message ?? String(err) };
}

/** Compile an extension and run a single slot against a ctx, with a trace. */
export async function runSlot(
  spec: ExtensionTypeSpec,
  extension: unknown,
  slot: string,
  ctx: unknown,
  evaluator?: Evaluator,
): Promise<SlotResult> {
  const compiled = await compileExtension(
    spec,
    extension,
    evaluator ? { evaluator } : {},
  );
  return compiled.exec(slot, ctx, { trace: true });
}

/** Run the extension's embedded $tests. */
export async function runTests(
  spec: ExtensionTypeSpec,
  extension: unknown,
  evaluator?: Evaluator,
): Promise<TestReport> {
  return testExtension(spec, extension, evaluator ? { evaluator } : {});
}
