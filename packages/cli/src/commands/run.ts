import {
  compileExtension,
  type CompileOptions,
  type RunOptions,
} from "@json-exe/runtime";
import { loadJsonFile, loadSpec } from "../load";
import { cross, dim, printJson, red } from "../output";
import { CliError, flagString, type ParsedArgs } from "../util";

export async function runCommand(args: ParsedArgs): Promise<number> {
  const file = args._[0];
  const slot = args._[1];
  const specPath = flagString(args.flags, "spec");
  if (!file || !slot) {
    throw new CliError(
      "usage: jsonexe run <extension.json> <slot> [--ctx <ctx.json>] --spec <spec>",
    );
  }
  if (!specPath) {
    throw new CliError("run requires --spec <spec file>");
  }

  const spec = await loadSpec(specPath);
  const json = await loadJsonFile(file);

  const ctxPath = flagString(args.flags, "ctx");
  const ctx = ctxPath ? await loadJsonFile(ctxPath) : {};

  const compileOptions: CompileOptions = {};
  if (args.flags["no-validate"]) compileOptions.validateReturns = false;
  if (args.flags.freeze) compileOptions.freezeContext = true;

  const extension = await compileExtension(spec, json, compileOptions);

  const wantTrace = args.flags.trace === true || args.flags.json === true;
  const runOptions: RunOptions = {};
  if (wantTrace) runOptions.trace = true;

  const result = await extension.exec(slot, ctx, runOptions);

  if (args.flags.json) {
    printJson(result);
    return result.ok ? 0 : 1;
  }

  if (!result.ok) {
    const error = result.error;
    console.error(
      `${cross()} ${red(error?.kind ?? "Error")}${
        error?.line ? dim(` (line ${error.line})`) : ""
      }: ${error?.message ?? "slot failed"}`,
    );
    return 1;
  }

  printJson(result.result);
  if (args.flags.trace && result.trace) {
    console.error(dim(`# ${slot} ok in ${result.trace.durationMs.toFixed(2)}ms`));
  }
  return 0;
}
