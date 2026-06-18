import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionTypeSpec } from "@json-exe/runtime";
import { CliError } from "./util";

/** Read and parse a JSON file, with friendly errors. */
export async function loadJsonFile(path: string): Promise<unknown> {
  const abs = resolve(path);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    throw new CliError(`Cannot read file: ${path}`, 1);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CliError(`Invalid JSON in ${path}: ${(err as Error).message}`, 1);
  }
}

function isSpecLike(value: unknown): value is ExtensionTypeSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { slots?: unknown }).slots === "object" &&
    (value as { slots?: unknown }).slots !== null
  );
}

function findSpecExport(mod: Record<string, unknown>): unknown {
  if (isSpecLike(mod.default)) return mod.default;
  if (isSpecLike(mod.spec)) return mod.spec;
  for (const value of Object.values(mod)) {
    if (isSpecLike(value)) return value;
  }
  return undefined;
}

/**
 * Load an extension type spec from a `.json` file or a JS/TS module
 * (`default` export, a `spec` export, or the first spec-shaped export).
 */
export async function loadSpec(path: string): Promise<ExtensionTypeSpec> {
  const abs = resolve(path);
  const ext = extname(abs).toLowerCase();

  if (ext === ".json") {
    const value = await loadJsonFile(abs);
    if (!isSpecLike(value)) {
      throw new CliError(
        `File ${path} is not a valid extension type spec (need { kind, slots }).`,
      );
    }
    return value;
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  } catch (err) {
    const hint =
      ext === ".ts"
        ? "\n(Hint: run jsonexe via `tsx` to load .ts specs, or pass a .json / .js spec.)"
        : "";
    throw new CliError(
      `Cannot import spec module ${path}: ${(err as Error).message}${hint}`,
    );
  }

  const candidate = findSpecExport(mod);
  if (!isSpecLike(candidate)) {
    throw new CliError(
      `Module ${path} does not export an extension type spec (need { kind, slots }).`,
    );
  }
  return candidate;
}
