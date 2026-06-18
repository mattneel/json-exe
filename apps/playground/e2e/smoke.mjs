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

// 2b. The spec editor resolves @json-exe/runtime (no type errors / import 2307).
const specCheck = await page.evaluate(async () => {
  const m = globalThis.jsonexeMonaco;
  if (!m) return { error: "no monaco hook" };
  const spec = m.editor.getModels().find((x) => x.uri.toString().endsWith("spec.ts"));
  if (!spec) return { error: "no spec model" };
  await new Promise((r) => setTimeout(r, 3000)); // let TS diagnostics settle
  const errors = m.editor
    .getModelMarkers({ resource: spec.uri })
    .filter((k) => k.severity === 8) // MarkerSeverity.Error
    .map((k) => k.message);
  return { errors };
});
assert(
  Array.isArray(specCheck.errors) && specCheck.errors.length === 0,
  `spec editor resolves the runtime import (no type errors): ${JSON.stringify(specCheck).slice(0, 200)}`,
);

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

// 5a. The default (well-typed) sample has NO embedded-TS error markers.
const clean = await page.evaluate(async () => {
  const m = globalThis.jsonexeMonaco;
  const ext = m.editor.getModels().find((x) => x.uri.toString().includes("extension.json"));
  await new Promise((r) => setTimeout(r, 1500));
  return m.editor
    .getModelMarkers({ resource: ext.uri })
    .filter((k) => k.source === "ts(ctx)" && k.severity === 8)
    .map((k) => k.message);
});
assert(clean.length === 0, `clean sample has no ts(ctx) errors: ${JSON.stringify(clean).slice(0, 200)}`);

// 5b. Return-type awareness: a boolean slot returning a string is flagged.
const bridge = await page.evaluate(async () => {
  const m = globalThis.jsonexeMonaco;
  if (!m) return { error: "no monaco hook" };
  const ext = m.editor.getModels().find((x) => x.uri.toString().includes("extension.json"));
  if (!ext) return { error: "no extension model" };
  ext.setValue(
    JSON.stringify(
      { $kind: "form-validator/v1", id: "x", validate: "return 'yes'" },
      null,
      2,
    ),
  );
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    const markers = m.editor
      .getModelMarkers({ resource: ext.uri })
      .filter((mk) => mk.source === "ts(ctx)");
    if (markers.length) return { ok: true, markers: markers.map((x) => x.message) };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ok: false, markers: [] };
});
assert(
  bridge.ok === true && /boolean/.test(JSON.stringify(bridge.markers)),
  `return-type awareness flags string-for-boolean: ${JSON.stringify(bridge).slice(0, 220)}`,
);

// 6. The QuickJS executor: select it, run a slot in the WASM sandbox.
await page.evaluate(() => {
  const m = globalThis.jsonexeMonaco;
  const ext = m.editor.getModels().find((x) => x.uri.toString().includes("extension.json"));
  ext.setValue(
    JSON.stringify(
      { $kind: "form-validator/v1", id: "x", validate: "return ctx.value.includes('@')" },
      null,
      2,
    ),
  );
});
await page.selectOption("#executor", "quickjs");
await page.selectOption(".runbar select", "validate");
await page.getByRole("button", { name: "Run slot" }).click();
await page
  .waitForFunction(() => /durationMs/.test(document.querySelector(".output")?.textContent || ""), null, { timeout: 20000 })
  .catch(() => {});
const qjsOut = (await page.locator(".output").textContent()) || "";
assert(
  qjsOut.includes("ok") && qjsOut.includes("true") && qjsOut.includes("durationMs"),
  `QuickJS executor runs a slot in-browser: "${qjsOut.replace(/\s+/g, " ").slice(0, 90)}"`,
);

await browser.close();

if (pageErrors.length) {
  console.error("[smoke] page errors:\n" + pageErrors.slice(0, 8).join("\n"));
}
log(failures === 0 ? "ALL SMOKE CHECKS PASSED" : `${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
