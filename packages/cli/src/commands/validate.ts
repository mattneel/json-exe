import { validateExtension, type CompileOptions } from "@json-exe/runtime";
import { loadJsonFile, loadSpec } from "../load";
import { cross, dim, printJson, red, tick } from "../output";
import { CliError, flagString, type ParsedArgs } from "../util";

export async function validateCommand(args: ParsedArgs): Promise<number> {
  const file = args._[0];
  const specPath = flagString(args.flags, "spec");
  if (!file) {
    throw new CliError("usage: jsonexe validate <extension.json> --spec <spec>");
  }
  if (!specPath) {
    throw new CliError("validate requires --spec <spec file>");
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

  const result = validateExtension(spec, json, options);

  if (args.flags.json) {
    printJson(result);
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    console.log(`${tick()} ${file} is a valid ${spec.kind} extension`);
    return 0;
  }

  console.log(`${cross()} ${file} is not valid (${result.errors.length} error(s)):`);
  for (const error of result.errors) {
    const where = error.slot ?? error.field;
    console.log(
      `  ${red(error.kind)}${where ? dim(` [${where}]`) : ""}: ${error.message}`,
    );
  }
  return 1;
}
