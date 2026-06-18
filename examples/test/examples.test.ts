import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileExtension, type ExtensionTypeSpec } from "@json-exe/runtime";
import { testExtension } from "@json-exe/testing";
import { formValidator } from "../form-validator/spec";
import { dataTransform } from "../data-transform/spec";
import { uiAction } from "../ui-action/spec";
import { agentPolicy } from "../agent-policy/spec";

const root = join(import.meta.dirname, "..");
const load = (rel: string): unknown =>
  JSON.parse(readFileSync(join(root, rel), "utf8"));

const cases: Array<[string, ExtensionTypeSpec, string]> = [
  ["required-email", formValidator, "form-validator/required-email.json"],
  ["strong-password", formValidator, "form-validator/strong-password.json"],
  ["normalize-user-row", dataTransform, "data-transform/normalize-user-row.json"],
  ["bulk-archive", uiAction, "ui-action/bulk-archive.json"],
  ["source-first-research", agentPolicy, "agent-policy/source-first-research.json"],
];

describe("example extensions: embedded $tests pass", () => {
  for (const [name, spec, file] of cases) {
    it(name, async () => {
      const report = await testExtension(spec, load(file));
      if (!report.ok) {
        console.error(report.tests.filter((t) => !t.ok));
      }
      expect(report.ok).toBe(true);
      expect(report.total).toBeGreaterThan(0);
    });
  }
});

describe("ui-action run slot (async with mock capabilities)", () => {
  it("archives the selection via ctx.actions", async () => {
    const ext = await compileExtension(uiAction, load("ui-action/bulk-archive.json"));
    const result = await ext.run("run", {
      selection: [{ id: "a" }, { id: "b" }],
      actions: { archive: async (ids: string[]) => ({ archived: ids }) },
    });
    expect(result).toEqual({ archived: ["a", "b"] });
  });
});
