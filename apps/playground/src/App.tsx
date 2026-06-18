import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import {
  validateExtension,
  type Evaluator,
  type ExtensionTypeSpec,
  type JsonExeErrorObject,
  type SlotResult,
} from "@json-exe/runtime";
import type { TestReport } from "@json-exe/testing";
import { evalSpecModel, installJsonExeLanguage } from "@json-exe/editor";
import { createQuickJSEvaluator } from "@json-exe/evaluator-quickjs";
import { monaco } from "./monaco/setup";
import { Editor } from "./components/Editor";
import { parseJson, runSlot, runTests, toErrorObject } from "./lib/run";
import { SAMPLES } from "./lib/samples";

function model(uri: string, value: string, language: string) {
  const parsed = monaco.Uri.parse(uri);
  return (
    monaco.editor.getModel(parsed) ??
    monaco.editor.createModel(value, language, parsed)
  );
}

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

type Output =
  | { kind: "idle" }
  | { kind: "run"; result: SlotResult }
  | { kind: "test"; report: TestReport }
  | { kind: "error"; error: JsonExeErrorObject };

export function App() {
  const sample0 = SAMPLES[0]!;
  // The spec model uses the file:// scheme so Monaco's Node module resolution
  // walks up to file:///node_modules/@json-exe/runtime (the extra-lib added in
  // monaco/setup.ts) and resolves the import for IntelliSense.
  const specModel = model("file:///spec.ts", sample0.spec, "typescript");
  const extModel = model("inmemory://playground/extension.json", sample0.extension, "json");
  const ctxModel = model("inmemory://playground/ctx.json", sample0.ctx, "json");

  const [spec, setSpec] = createSignal<ExtensionTypeSpec | undefined>();
  const [specError, setSpecError] = createSignal<string | undefined>();
  const [problems, setProblems] = createSignal<JsonExeErrorObject[]>([]);
  const [slot, setSlot] = createSignal(sample0.defaultSlot);
  const [output, setOutput] = createSignal<Output>({ kind: "idle" });
  const [busy, setBusy] = createSignal(false);

  // Selectable browser executor: the dev "unsafe" new Function, or sandboxed QuickJS.
  const [executor, setExecutor] = createSignal<"unsafe" | "quickjs">("unsafe");
  let quickjs: Evaluator | undefined;
  let quickjsLoading: Promise<Evaluator> | undefined;
  async function currentEvaluator(): Promise<Evaluator | undefined> {
    if (executor() === "unsafe") return undefined;
    if (quickjs) return quickjs;
    if (!quickjsLoading) {
      quickjsLoading = createQuickJSEvaluator().then((e) => (quickjs = e));
    }
    return quickjsLoading;
  }

  // Draggable vertical divider between the two columns.
  const [colFr, setColFr] = createSignal(0.5);
  const [dragging, setDragging] = createSignal(false);
  let gridEl: HTMLElement | undefined;

  function onGutterDown(e: PointerEvent) {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => {
      if (!gridEl) return;
      const r = gridEl.getBoundingClientRect();
      setColFr(Math.min(0.85, Math.max(0.15, (ev.clientX - r.left) / r.width)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Language-server ergonomics for the extension JSON, driven by the live spec.
  const language = installJsonExeLanguage(monaco, {
    model: extModel,
    getSpec: () => spec(),
  });

  const evalSpec = async (attempt = 0): Promise<void> => {
    const res = await evalSpecModel(monaco, specModel);
    // Retry transient failures (TS worker still warming up on first load).
    if (res.transient && !res.spec && attempt < 12) {
      setTimeout(() => void evalSpec(attempt + 1), 150);
      return;
    }
    setSpecError(res.error);
    setSpec(res.spec);
    if (res.spec) {
      const names = Object.keys(res.spec.slots);
      if (!names.includes(slot()) && names[0]) setSlot(names[0]);
    }
  };
  const refreshSpec = debounce(() => void evalSpec(), 250);

  const refreshProblems = debounce(() => {
    const current = spec();
    if (!current) {
      setProblems([]);
      return;
    }
    const parsed = parseJson(extModel.getValue(), "Extension");
    if (parsed.error) {
      setProblems([{ kind: "ParseError", message: parsed.error }]);
      return;
    }
    setProblems(validateExtension(current, parsed.value).errors);
  }, 250);

  const specSub = specModel.onDidChangeContent(() => refreshSpec());
  const extSub = extModel.onDidChangeContent(() => refreshProblems());
  onCleanup(() => {
    specSub.dispose();
    extSub.dispose();
    language.dispose();
    specModel.dispose();
    extModel.dispose();
    ctxModel.dispose();
  });

  // Initial + reactive recompute of problems/markers when the spec changes.
  createEffect(() => {
    spec();
    refreshProblems();
    language.refresh();
  });
  void evalSpec();

  const slotNames = () => (spec() ? Object.keys(spec()!.slots) : []);

  function loadSample(id: string) {
    const s = SAMPLES.find((x) => x.id === id);
    if (!s) return;
    specModel.setValue(s.spec);
    extModel.setValue(s.extension);
    ctxModel.setValue(s.ctx);
    setSlot(s.defaultSlot);
    setOutput({ kind: "idle" });
  }

  async function onRun() {
    const current = spec();
    if (!current) {
      setOutput({ kind: "error", error: { kind: "SpecError", message: specError() ?? "No valid spec." } });
      return;
    }
    const ext = parseJson(extModel.getValue(), "Extension");
    if (ext.error) {
      setOutput({ kind: "error", error: { kind: "ParseError", message: ext.error } });
      return;
    }
    const ctx = parseJson(ctxModel.getValue(), "ctx");
    if (ctx.error) {
      setOutput({ kind: "error", error: { kind: "ParseError", message: ctx.error } });
      return;
    }
    setBusy(true);
    try {
      const evaluator = await currentEvaluator();
      const result = await runSlot(current, ext.value, slot(), ctx.value, evaluator);
      setOutput({ kind: "run", result });
    } catch (err) {
      setOutput({ kind: "error", error: toErrorObject(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    const current = spec();
    if (!current) {
      setOutput({ kind: "error", error: { kind: "SpecError", message: specError() ?? "No valid spec." } });
      return;
    }
    const ext = parseJson(extModel.getValue(), "Extension");
    if (ext.error) {
      setOutput({ kind: "error", error: { kind: "ParseError", message: ext.error } });
      return;
    }
    setBusy(true);
    try {
      const evaluator = await currentEvaluator();
      setOutput({ kind: "test", report: await runTests(current, ext.value, evaluator) });
    } catch (err) {
      setOutput({ kind: "error", error: toErrorObject(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <strong>JSON.exe</strong> <span class="muted">playground</span>
        </div>
        <div class="controls">
          <label class="muted" for="executor">executor</label>
          <select
            id="executor"
            value={executor()}
            onChange={(e) => setExecutor(e.currentTarget.value as "unsafe" | "quickjs")}
          >
            <option value="unsafe">new Function (unsafe)</option>
            <option value="quickjs">QuickJS (sandboxed)</option>
          </select>
          <label class="muted" for="sample">sample</label>
          <select id="sample" onChange={(e) => loadSample(e.currentTarget.value)}>
            <For each={SAMPLES}>
              {(s) => <option value={s.id}>{s.label}</option>}
            </For>
          </select>
        </div>
      </header>

      <main
        class="grid"
        ref={gridEl}
        style={{ "grid-template-columns": `${colFr()}fr 6px ${1 - colFr()}fr` }}
      >
        <section class="pane">
          <div class="pane-title">Extension type <span class="muted">spec.ts</span></div>
          <Editor model={specModel} />
          <Show when={specError()}>
            <div class="banner error">{specError()}</div>
          </Show>
        </section>

        <section class="pane">
          <div class="pane-title">Extension <span class="muted">extension.json</span></div>
          <Editor model={extModel} />
          <div class="problems">
            <Show
              when={spec()}
              fallback={<span class="muted">{specError() ?? "evaluating spec…"}</span>}
            >
              <Show
                when={problems().length > 0}
                fallback={<span class="ok">✓ valid {spec()!.kind}</span>}
              >
                <For each={problems()}>
                  {(p) => (
                    <div class="problem">
                      <span class="kind">{p.kind}</span>
                      {p.slot || p.field ? <span class="where">[{p.slot ?? p.field}]</span> : null}
                      <span>{p.message}</span>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </section>

        <section class="pane">
          <div class="pane-title">Run <span class="muted">ctx.json</span></div>
          <Editor model={ctxModel} />
          <div class="runbar">
            <select value={slot()} onChange={(e) => setSlot(e.currentTarget.value)}>
              <For each={slotNames()}>{(n) => <option value={n}>{n}</option>}</For>
            </select>
            <button disabled={busy()} onClick={() => void onRun()}>Run slot</button>
            <button disabled={busy()} onClick={() => void onTest()}>Run $tests</button>
          </div>
        </section>

        <section class="pane">
          <div class="pane-title">Output</div>
          <div class="output">
            <OutputView output={output()} />
          </div>
        </section>

        <div
          class="gutter-v"
          classList={{ active: dragging() }}
          onPointerDown={onGutterDown}
        />
      </main>
    </div>
  );
}

function OutputView(props: { output: Output }) {
  const o = () => props.output;
  return (
    <Show when={o().kind !== "idle"} fallback={<div class="muted">Run a slot or the $tests to see results.</div>}>
      <Show when={o().kind === "error"}>
        {(() => {
          const e = (o() as { error: JsonExeErrorObject }).error;
          return (
            <div class="result-error">
              <div class="kind">{e.kind}</div>
              <div>{e.message}</div>
            </div>
          );
        })()}
      </Show>

      <Show when={o().kind === "run"}>
        {(() => {
          const r = (o() as { result: SlotResult }).result;
          return (
            <>
              <div class={r.ok ? "ok" : "result-error"}>
                {r.ok ? "✓ ok" : `✗ ${r.error?.kind}`}
              </div>
              <Show when={r.ok} fallback={<pre>{r.error?.message}</pre>}>
                <div class="label">result</div>
                <pre>{JSON.stringify(r.result, null, 2)}</pre>
              </Show>
              <div class="label">trace</div>
              <pre>{JSON.stringify(r.trace, null, 2)}</pre>
            </>
          );
        })()}
      </Show>

      <Show when={o().kind === "test"}>
        {(() => {
          const rep = (o() as { report: TestReport }).report;
          return (
            <>
              <div class={rep.ok ? "ok" : "result-error"}>
                {rep.passed} passed, {rep.failed} failed, {rep.total} total
              </div>
              <For each={rep.tests}>
                {(t) => (
                  <div class={t.ok ? "test ok" : "test fail"}>
                    {t.ok ? "✓" : "✗"} {t.name} <span class="muted">({t.slot})</span>
                    <Show when={!t.ok && t.message}>
                      <div class="muted">{t.message}</div>
                    </Show>
                  </div>
                )}
              </For>
            </>
          );
        })()}
      </Show>
    </Show>
  );
}
