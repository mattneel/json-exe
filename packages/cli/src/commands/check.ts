import {
  compileExtension,
  JsonExeError,
  type CompileOptions,
} from "@json-exe/runtime";
import { loadJsonFile, loadSpec } from "../load";
import { cross, dim, printJson, red, tick } from "../output";
import { CliError, flagString, type ParsedArgs } from "../util";

export async function checkCommand(args: ParsedArgs): Promise<number> {
  const file = args._[0];
  const specPath = flagString(args.flags, "spec");
  if (!file) {
    throw new CliError("usage: jsonexe check <extension.json> --spec <spec>");
  }
  if (!specPath) {
    throw new CliError("check requires --spec <spec file>");
  }

  const spec = await loadSpec(specPath);
  const json = await loadJsonFile(file);

  const options: CompileOptions = {};
  const unknownSlots = flagString(args.flags, "unknown-slots");
  if (unknownSlots === "error" || unknownSlots === "ignore") {
    options.unknownSlots = unknownSlots;
  } else if (unknownSlots !== undefined) {
    throw new CliError(
      `--unknown-slots must be "ignore" or "error" (got "${unknownSlots}")`,
    );
  }

  try {
    const extension = await compileExtension(spec, json, options);
    const compiled = extension.slots().filter((s) => s.compiled).length;
    if (args.flags.json) {
      printJson({ ok: true, kind: extension.kind, compiledSlots: compiled });
      return 0;
    }
    console.log(
      `${tick()} ${file} compiles ${dim(`(${compiled} slot(s) compiled)`)}`,
    );
    return 0;
  } catch (err) {
    const error =
      err instanceof JsonExeError
        ? err.toJSON()
        : { kind: "Error", message: String(err) };
    if (args.flags.json) {
      printJson({ ok: false, error });
      return 1;
    }
    const where = error.slot ?? error.field;
    console.error(
      `${cross()} ${red(error.kind)}${where ? dim(` [${where}]`) : ""}: ${error.message}`,
    );
    return 1;
  }
}
