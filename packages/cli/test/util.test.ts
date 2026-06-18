import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/util";

describe("parseArgs", () => {
  it("parses positionals and value flags", () => {
    const { _, flags } = parseArgs(["run", "ext.json", "validate", "--spec", "s.json"]);
    expect(_).toEqual(["run", "ext.json", "validate"]);
    expect(flags.spec).toBe("s.json");
  });

  it("supports --key=value", () => {
    const { flags } = parseArgs(["--unknown-slots=error"]);
    expect(flags["unknown-slots"]).toBe("error");
  });

  it("does not let a boolean flag swallow the following positional", () => {
    const { _, flags } = parseArgs([
      "run",
      "ext.json",
      "--trace",
      "validate",
      "--spec",
      "s.json",
    ]);
    expect(flags.trace).toBe(true);
    expect(_).toEqual(["run", "ext.json", "validate"]);
    expect(flags.spec).toBe("s.json");
  });

  it("treats --json as boolean even before positionals", () => {
    const { _, flags } = parseArgs(["--json", "ext.json", "validate"]);
    expect(flags.json).toBe(true);
    expect(_).toEqual(["ext.json", "validate"]);
  });

  it("maps -h and -v", () => {
    expect(parseArgs(["-h"]).flags.help).toBe(true);
    expect(parseArgs(["-v"]).flags.version).toBe(true);
  });
});
