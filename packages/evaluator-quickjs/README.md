# @json-exe/evaluator-quickjs

A **sandboxed** JSON.exe evaluator backed by [QuickJS-ng](https://github.com/quickjs-ng/quickjs)
compiled to WebAssembly (via [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten)).

Unlike the built-in `unsafe-new-function` evaluator, slot code runs in an
isolated VM:

- **no host globals** — no `process`, `fetch`, `globalThis`, `require`, …
- **memory limit** per run,
- a **CPU deadline** that actually interrupts infinite loops (`while (true) {}`),
- `ctx` is marshalled across a value boundary; host capabilities (functions on
  `ctx`) are exposed to the guest — both sync and async are supported.

Runs anywhere WASM does: Node, browsers, Deno, edge runtimes.

## Usage

```ts
import { compileExtension } from "@json-exe/runtime";
import { createQuickJSEvaluator } from "@json-exe/evaluator-quickjs";

const evaluator = await createQuickJSEvaluator({
  memoryLimitBytes: 16 * 1024 * 1024, // default 16 MiB
  deadlineMs: 1000,                   // default: interrupt after 1s of CPU
});

const ext = await compileExtension(spec, json, { evaluator });
const result = await ext.run("toolCall", ctx); // runs inside the sandbox
```

Host capabilities pass straight through:

```ts
await ext.run("toolCall", {
  input: "vaccines",
  tools: { search: async ({ q }) => ({ items: [q, q] }) }, // async host fn
});
```

## Options

| Option              | Default                                   | Notes |
| ------------------- | ----------------------------------------- | ----- |
| `module`            | loaded from `variant`                     | Reuse a pre-created `QuickJSWASMModule`. |
| `variant`           | quickjs-ng wasmfile release **sync**      | Any quickjs-emscripten variant. |
| `memoryLimitBytes`  | `16 * 1024 * 1024`                        | Per-run memory cap. |
| `maxStackSizeBytes` | `512 * 1024`                             | Per-run stack cap. |
| `deadlineMs`        | `1000`                                    | Per-run CPU deadline (interrupts loops). |

A fresh runtime + context is created per run for isolation; the WASM module is
loaded once and reused.

## Limitations

- `ctx` values cross a value boundary: primitives, arrays, plain objects, and
  functions are marshalled. Class instances become plain objects; `Date`/`Map`/
  `Set` are not specially handled.
- Slot return values must be structured-cloneable (no functions returned out).
