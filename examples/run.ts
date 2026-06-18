/**
 * Runnable demo: compiles every example extension, exercises a few slots, and
 * runs each extension's embedded $tests. Exits non-zero if anything fails.
 *
 *   pnpm examples            # (after `pnpm build`)
 *   tsx examples/run.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileExtension, Trace } from "@json-exe/runtime";
import { testExtension, type TestReport } from "@json-exe/testing";
import { formValidator } from "./form-validator/spec";
import { dataTransform } from "./data-transform/spec";
import { uiAction } from "./ui-action/spec";
import { agentPolicy } from "./agent-policy/spec";

const here = import.meta.dirname;
const load = (rel: string): unknown =>
  JSON.parse(readFileSync(join(here, rel), "utf8"));

const requiredEmail = load("form-validator/required-email.json");
const strongPassword = load("form-validator/strong-password.json");
const normalizeRow = load("data-transform/normalize-user-row.json");
const bulkArchive = load("ui-action/bulk-archive.json");
const sourceFirst = load("agent-policy/source-first-research.json");

let failures = 0;

function line(label: string, value: unknown): void {
  console.log(`   ${label.padEnd(26)} ${JSON.stringify(value)}`);
}

function reportTests(name: string, report: TestReport): void {
  const status = report.ok ? "PASS" : "FAIL";
  console.log(`   $tests: ${status} (${report.passed}/${report.total})`);
  if (!report.ok) {
    failures += report.failed;
    for (const t of report.tests.filter((t) => !t.ok)) {
      console.log(`     - ${t.name}: ${t.message ?? "failed"}`);
    }
  }
}

async function main(): Promise<void> {
  console.log("\n== form-validator/v1 :: required-email ==");
  {
    const ext = await compileExtension(formValidator, requiredEmail);
    line("validate(matt@x.com)", await ext.run("validate", { value: "matt@x.com" }));
    line("validate(nope)", await ext.run("validate", { value: "nope" }));
    line("message()", await ext.run("message"));
    reportTests("required-email", await testExtension(formValidator, requiredEmail));
    reportTests("strong-password", await testExtension(formValidator, strongPassword));
  }

  console.log("\n== data-transform/v1 :: normalize-user-row ==");
  {
    const ext = await compileExtension(dataTransform, normalizeRow);
    line(
      "map(row)",
      await ext.run("map", { row: { id: 7, email: "  A@B.COM ", active: 1 } }),
    );
    reportTests("normalize-user-row", await testExtension(dataTransform, normalizeRow));
  }

  console.log("\n== ui-action/v1 :: bulk-archive ==");
  {
    const ext = await compileExtension(uiAction, bulkArchive);
    line("label([1,2,3])", await ext.run("label", { selection: [1, 2, 3] }));
    const archived = await ext.run("run", {
      selection: [{ id: "a" }, { id: "b" }],
      actions: { archive: async (ids: string[]) => ({ archived: ids }) },
    });
    line("run(selection)", archived);
    reportTests("bulk-archive", await testExtension(uiAction, bulkArchive));
  }

  console.log("\n== agent-policy/v1 :: source-first-research ==");
  {
    const ext = await compileExtension(agentPolicy, sourceFirst);
    const trace = new Trace();
    line("state.init()", await ext.run("state.init", {}, { trace }));
    line(
      "toolCall(vaccines)",
      await ext.run("toolCall", { input: "vaccines" }, { trace }),
    );
    line("trace records", trace.records.length);
    reportTests("source-first-research", await testExtension(agentPolicy, sourceFirst));
  }

  console.log(
    failures === 0
      ? "\nAll examples ran and all $tests passed.\n"
      : `\n${failures} test(s) failed.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
