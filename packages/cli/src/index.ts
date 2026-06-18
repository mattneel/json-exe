import { bold, dim, red } from "./output";
import { CliError, parseArgs, type ParsedArgs } from "./util";
import { validateCommand } from "./commands/validate";
import { runCommand } from "./commands/run";
import { testCommand } from "./commands/test";
import { checkCommand } from "./commands/check";
import { explainCommand } from "./commands/explain";

const VERSION = "0.1.0";

const HELP = `${bold("jsonexe")} — JSON.exe command-line tool (v${VERSION})

${bold("Usage:")}
  jsonexe <command> [options]

${bold("Commands:")}
  validate <ext.json> --spec <spec>            Validate an extension's shape
  check    <ext.json> --spec <spec>            Validate + compile all slots
  run      <ext.json> <slot> --spec <spec>     Compile and run one slot
  test     <ext.json> --spec <spec>            Run the extension's $tests
  explain  <ext.json> [--spec <spec>]          Describe an extension

${bold("Options:")}
  --spec <file>          Extension type spec (.json, .js, or .ts via tsx)
  --ctx <file>           JSON file providing ctx for 'run'
  --trace                Print timing for 'run'
  --json                 Machine-readable JSON output
  --unknown-slots <p>    'ignore' | 'error' (validate/check)
  --no-validate          Skip return validation (run)
  --freeze               Freeze ctx before running (run)
  -h, --help             Show this help
  -v, --version          Show version

${bold("Examples:")}
  jsonexe validate required-email.json --spec form-validator.spec.json
  jsonexe run required-email.json validate --ctx ctx.json --spec form-validator.spec.json
  jsonexe test email-validator.json --spec form-validator.spec.json
`;

type Command = (args: ParsedArgs) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  validate: validateCommand,
  check: checkCommand,
  run: runCommand,
  test: testCommand,
  explain: explainCommand,
};

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed._[0];

  if (parsed.flags.version) {
    console.log(VERSION);
    return 0;
  }
  if (!command || command === "help" || parsed.flags.help) {
    console.log(HELP);
    return 0;
  }
  if (command === "version") {
    console.log(VERSION);
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(red(`Unknown command: ${command}`));
    console.error(dim("Run `jsonexe --help` for usage."));
    return 2;
  }

  return handler({ _: parsed._.slice(1), flags: parsed.flags });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof CliError) {
      console.error(`${red("error:")} ${err.message}`);
      process.exitCode = err.code;
    } else {
      console.error(`${red("error:")} ${(err as Error).message ?? String(err)}`);
      process.exitCode = 1;
    }
  });
