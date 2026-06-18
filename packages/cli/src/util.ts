export class CliError extends Error {
  constructor(
    message: string,
    /** Process exit code (2 = usage error, 1 = failure). */
    readonly code = 2,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface ParsedArgs {
  _: string[];
  flags: Record<string, string | boolean>;
}

/** Flags that never take a value (so they don't swallow a following positional). */
const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "json",
  "trace",
  "freeze",
  "no-validate",
]);

/**
 * Minimal argv parser. Supports `--key value`, `--key=value`, boolean `--flag`,
 * and `-h` / `-v` short flags. Known boolean flags never consume the next
 * token. Everything else is a positional argument.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h") {
      flags.help = true;
    } else if (arg === "-v") {
      flags.version = true;
    } else if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (BOOLEAN_FLAGS.has(body)) {
        flags[body] = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else {
      _.push(arg);
    }
  }

  return { _, flags };
}

export function flagString(
  flags: ParsedArgs["flags"],
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}
