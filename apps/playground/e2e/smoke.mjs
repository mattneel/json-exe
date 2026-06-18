// Headless browser smoke test for the JSON.exe playground.
// Usage: start `vite --port 5199` first, then `node e2e/smoke.mjs`.
import { chromium } from "playwright";
import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const URL = process.env.SMOKE_URL || "http://localhost:5199/";
const log = (...a) => console.log("[smoke]", ...a);
let failures = 0;
const assert = (cond, msg) => {
  if (cond) log("PASS:", msg);
  else {
    failures++;
    console.error("[smoke] FAIL:", msg);
  }
};

async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const base = join(homedir(), ".cache/ms-playwright");
    const candidates = [];
    if (existsSync(base)) {
      for (const d of readdirSync(base)) {
        if (d.startsWith("chromium_headless_shell-"))
          candidates.push(join(base, d, "chrome-linux/headless_shell"));
        if (d.startsWith("chromium-"))
          candidates.push(join(base, d, "chrome-linux/chrome"));
      }
    }
    candidates.sort().reverse();
    for (const p of candidates) {
      if (existsSync(p)) {
        log("using cached browser", p);
        return await chromium.launch({ headless: true, executablePath: p });
      }
    }
    throw err;
  }
}

const browser = await launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(m.text());
});

await page.goto(URL, { waitUntil: "load", timeout: 30000 });

// 1. Monaco editors render.
await page.waitForSelector(".monaco-editor", { timeout: 25000 });
await page.waitForTimeout(1500);
const editorCount = await page.locator(".monaco-editor").count();
assert(editorCount >= 3, `3 editors rendered (found ${editorCount})`);

// 2. Structural validation ran in-browser via the real runtime.
await page
  .waitForFunction(() => document.querySelector(".problems")?.textContent?.includes("valid"), null, { timeout: 15000 })
  .catch(() => {});
const problems = (await page.locator(".problems").first().textContent()) || "";
assert(problems.includes("valid"), `extension validates: "${problems.trim().slice(0, 50)}"`);

// 3. Run a slot — runtime executes in the browser, result + trace shown.
// Wait for the spec to evaluate (slot dropdown populated).
await page.waitForFunction(
  () => document.querySelectorAll(".runbar select option").length > 0,
  null,
  { timeout: 15000 },
);
await page.getByRole("button", { name: "Run slot" }).click();
await page
  .waitForFunction(() => document.querySelector(".output")?.textContent?.includes("trace"), null, { timeout: 10000 })
  .catch(() => {});
const out1 = (await page.locator(".output").textContent()) || "";
log("run output:", JSON.stringify(out1.slice(0, 200)));
assert(out1.includes("ok") && out1.includes("true"), "run slot returns ok + true");
assert(out1.includes("durationMs"), "trace with durationMs shown");

// 4. Run $tests.
await page.getByRole("button", { name: "Run $tests" }).click();
await page
  .waitForFunction(() => /\d+ passed/.test(document.querySelector(".output")?.textContent || ""), null, { timeout: 10000 })
  .catch(() => {});
const out2 = (await page.locator(".output").textContent()) || "";
assert(/[1-9]\d* passed/.test(out2), `tests pass: "${out2.trim().slice(0, 40)}"`);

// 5. The embedded-TS bridge flags a slot-level TYPE error (not a structural one).
const bridge = await page.evaluate(async () => {
  const m = globalThis.jsonexeMonaco;
  if (!m) return { error: "no monaco hook" };
  const ext = m.editor.getModels().find((x) => x.uri.toString().includes("extension.json"));
  if (!ext) return { error: "no extension model" };
  ext.setValue(
    JSON.stringify(
      {
        $kind: "form-validator/v1",
        id: "x",
        // Returns boolean (structurally valid) but contains a TS type error:
        validate: "const n: number = 'nope'; return true;",
      },
      null,
      2,
    ),
  );
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    const markers = m.editor.getModelMarkers({ resource: ext.uri });
    if (markers.some((mk) => mk.source === "ts(ctx)")) {
      return { ok: true, markers: markers.map((x) => ({ source: x.source, message: x.message })) };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ok: false, markers: m.editor.getModelMarkers({ resource: ext.uri }).map((x) => ({ source: x.source, message: x.message })) };
});
assert(bridge.ok === true, `embedded TS bridge flags slot type error: ${JSON.stringify(bridge).slice(0, 220)}`);

await browser.close();

if (pageErrors.length) {
  console.error("[smoke] page errors:\n" + pageErrors.slice(0, 8).join("\n"));
}
log(failures === 0 ? "ALL SMOKE CHECKS PASSED" : `${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
