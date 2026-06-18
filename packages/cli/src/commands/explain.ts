import {
  getSlotSource,
  RESERVED_FIELDS,
  STANDARD_METADATA_FIELDS,
  type ExtensionJson,
  type ExtensionTypeSpec,
  type Schema,
} from "@json-exe/runtime";
import { loadJsonFile, loadSpec } from "../load";
import { bold, cyan, dim, printJson, tick } from "../output";
import { CliError, flagString, type ParsedArgs } from "../util";

function describeReturns(returns: Schema | undefined): string {
  if (returns === undefined) return "unknown";
  if (typeof returns === "string") return returns;
  if (returns.enum) return JSON.stringify(returns.enum);
  if (returns.type !== undefined) {
    const types = Array.isArray(returns.type) ? returns.type : [returns.type];
    return types.join("|");
  }
  return "unknown";
}

export async function explainCommand(args: ParsedArgs): Promise<number> {
  const file = args._[0];
  if (!file) {
    throw new CliError("usage: jsonexe explain <extension.json> [--spec <spec>]");
  }

  const raw = await loadJsonFile(file);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError(`${file} is not an extension object (expected a JSON object).`, 1);
  }
  const ext = raw as ExtensionJson;
  const specPath = flagString(args.flags, "spec");
  const spec: ExtensionTypeSpec | undefined = specPath
    ? await loadSpec(specPath)
    : undefined;

  if (args.flags.json) {
    printJson({
      kind: ext.$kind,
      id: ext.$id ?? ext.id,
      name: ext.name,
      description: ext.description,
      slots: spec
        ? Object.keys(spec.slots).map((name) => ({
            name,
            implemented: typeof getSlotSource(ext, name) === "string",
          }))
        : undefined,
    });
    return 0;
  }

  console.log(bold(String(ext.name ?? ext.$id ?? ext.id ?? "(unnamed extension)")));
  console.log(`  kind:        ${cyan(String(ext.$kind ?? "(none)"))}`);
  if (ext.$id ?? ext.id) console.log(`  id:          ${String(ext.$id ?? ext.id)}`);
  if (ext.$version) console.log(`  version:     ${String(ext.$version)}`);
  if (ext.description) console.log(`  description: ${ext.description}`);

  if (spec) {
    if (spec.context && Object.keys(spec.context).length > 0) {
      console.log(bold("\nContext (ctx):"));
      for (const [key, type] of Object.entries(spec.context)) {
        console.log(`  ${key}: ${dim(type)}`);
      }
    }

    console.log(bold("\nSlots:"));
    for (const [name, slotSpec] of Object.entries(spec.slots)) {
      const implemented = typeof getSlotSource(ext, name) === "string";
      const flags = [
        slotSpec.required ? "required" : "optional",
        slotSpec.async ? "async" : "sync",
      ].join(", ");
      console.log(
        `  ${implemented ? tick() : dim("·")} ${bold(name)}(ctx) -> ${describeReturns(slotSpec.returns)} ${dim(`[${flags}]`)}`,
      );
      if (slotSpec.description) console.log(`      ${dim(slotSpec.description)}`);
    }

    if (spec.staticFields && Object.keys(spec.staticFields).length > 0) {
      console.log(bold("\nStatic fields:"));
      for (const [name, fieldSpec] of Object.entries(spec.staticFields)) {
        console.log(
          `  ${name} ${dim(`[${fieldSpec.required ? "required" : "optional"}]`)}`,
        );
      }
    }
  } else {
    // No spec: list non-reserved string fields as candidate slots.
    const reserved = new Set<string>([
      ...RESERVED_FIELDS,
      ...STANDARD_METADATA_FIELDS,
    ]);
    const candidates = Object.keys(ext).filter(
      (k) => !reserved.has(k) && typeof ext[k] === "string",
    );
    console.log(bold("\nSlots (no spec — inferred from string fields):"));
    for (const name of candidates) console.log(`  ${bold(name)}`);
    console.log(dim("\nPass --spec <spec> for full slot documentation."));
  }

  if (ext.$permissions) {
    console.log(bold("\nDeclared permissions:"));
    console.log(`  ${JSON.stringify(ext.$permissions)}`);
  }
  if (Array.isArray(ext.$tests)) {
    console.log(dim(`\n${ext.$tests.length} embedded test(s).`));
  }

  return 0;
}
