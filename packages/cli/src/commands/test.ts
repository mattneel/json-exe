import { testExtension } from "@json-exe/testing";
import { loadJsonFile, loadSpec } from "../load";
import { cross, dim, green, printJson, red, tick } from "../output";
import { CliError, flagString, type ParsedArgs } from "../util";

export async function testCommand(args: ParsedArgs): Promise<number> {
  const file = args._[0];
  const specPath = flagString(args.flags, "spec");
  if (!file) {
    throw new CliError("usage: jsonexe test <extension.json> --spec <spec>");
  }
  if (!specPath) {
    throw new CliError("test requires --spec <spec file>");
  }

  const spec = await loadSpec(specPath);
  const json = await loadJsonFile(file);

  const report = await testExtension(spec, json);

  if (args.flags.json) {
    printJson(report);
    return report.ok ? 0 : 1;
  }

  if (report.compileError) {
    console.log(`${cross()} compile error: ${report.compileError.message}`);
  }

  for (const test of report.tests) {
    if (test.ok) {
      console.log(`  ${tick()} ${test.name} ${dim(`(${test.slot})`)}`);
    } else {
      console.log(`  ${cross()} ${test.name} ${dim(`(${test.slot})`)}`);
      if (test.message) console.log(`      ${red(test.message)}`);
      if ("expected" in test && "actual" in test) {
        console.log(
          dim(
            `      expected ${JSON.stringify(test.expected)}, got ${JSON.stringify(test.actual)}`,
          ),
        );
      }
    }
  }

  const summary = `${report.passed} passed, ${report.failed} failed, ${report.total} total`;
  console.log(report.ok ? green(summary) : red(summary));
  return report.ok ? 0 : 1;
}
