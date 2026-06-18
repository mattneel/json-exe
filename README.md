# JSON.exe

> JSON that runs. Executable JSON for plugins, agents, and extensions.

**▶ [Try the playground](https://mattneel.github.io/json-exe/)** — author specs and extensions with live typed-`ctx` IntelliSense, run/test/trace, and a sandboxed QuickJS executor, all in the browser.

**JSON.exe** is a universal plugin / extension / scripting layer where extensions
are plain JSON objects, and selected named fields are executable JavaScript
"slots" evaluated against a documented host context.

```txt
Document the ctx.
Document the slots.
Let JSON.exe do the rest.
```

The host app defines an **extension type** (a contract: the shape of `ctx`, the
allowed slot names, their return schemas, sync/async). A user — or an LLM —
writes an **extension** (a JSON object). The runtime compiles the named JS
fields, runs them against `ctx`, validates return values, and traces everything.

```txt
JSON object + documented ctx + named JS slots = extension
```

---

## Install

This is a pnpm workspace monorepo. From a clone:

```bash
pnpm install
pnpm build        # build all packages to dist/
pnpm test         # run the test suite
pnpm typecheck    # typecheck everything
pnpm examples     # run the runnable examples (after build)
```

Packages:

| Package               | What it is                                                  |
| --------------------- | ---------------------------------------------------------- |
| `@json-exe/runtime`   | Core: define types, compile, run, validate, trace          |
| `@json-exe/testing`   | Run the `$tests` embedded in an extension                  |
| `jsonexe`             | CLI: `validate`, `run`, `test`, `check`, `explain`         |
| `@json-exe/editor`    | Embeddable Monaco language features + editor component       |
| `@json-exe/evaluator-quickjs` | Sandboxed evaluator (QuickJS-ng WASM)               |
| `@json-exe/playground`| Monaco + Solid playground with embedded-TS slot ergonomics |

---

## Quick start

### 1. Define an extension type (the host owns this)

```ts
import { defineExtensionType } from "@json-exe/runtime";

const formValidator = defineExtensionType({
  kind: "form-validator/v1",
  context: {
    value: "unknown",
    field: "Field",
    form: "Record<string, unknown>",
  },
  slots: {
    validate: { required: true, returns: { type: "boolean" } },
    message: { returns: { type: "string" } },
  },
});
```

### 2. Write an extension (the user owns this — it's just JSON)

```json
{
  "$kind": "form-validator/v1",
  "id": "required-email",
  "validate": "return typeof ctx.value === 'string' && ctx.value.includes('@')",
  "message": "return 'Please enter a valid email address.'"
}
```

### 3. Compile and run

```ts
import { compileExtension } from "@json-exe/runtime";

const ext = await compileExtension(formValidator, json);

const ok = await ext.run("validate", { value: "matt@example.com" });
// => true
```

That's the entire model. Everything else is adapters, docs, examples, and safety.

### More than `eval`

A plain eval system is `string → Function → hope`. JSON.exe is spec-driven:

```txt
spec → typed ctx → slot contracts → JSON-aware editing → validation → tests → trace → repair
```

A single host spec is simultaneously the runtime ABI, the validation schema, the
editor schema, a mini language-server input, the test-harness definition, and the
LLM generation contract.

> JSON.exe is executable JSON with spec-driven tooling. Define the host context
> and slot contracts once, and the runtime automatically gets validation,
> execution, testing, tracing, autocomplete, hovers, and repair boundaries.
> **JSON.exe turns every extension type into its own tiny typed programming
> environment.**

---

## Core API (`@json-exe/runtime`)

```ts
defineExtensionType(spec)                       // -> spec (with light validation)
compileExtension(spec, json, options?)          // -> Promise<CompiledExtension>
validateExtension(spec, json, options?)         // -> { ok, errors[] }  (never throws)
runSlot(spec, json, slot, ctx?, options?)       // -> one-shot compile + run
createRuntime(defaults?)                         // -> { compile, validate } with default options
```

A `CompiledExtension` has:

```ts
ext.kind                                  // string
ext.id                                    // string | undefined
ext.has(slot)                             // boolean
ext.slots()                               // CompiledSlotInfo[]
ext.run<T>(slot, ctx?, options?)          // -> T          (throws JsonExeError on failure)
ext.exec<T>(slot, ctx?, options?)         // -> SlotResult (never throws; { ok, result, error, trace })
```

Use **`run`** when you want the value (and want failures to throw). Use
**`exec`** when you want a structured, non-throwing envelope including the trace.

### Return validation

Every slot return value is validated against its declared `returns` schema:

```ts
// slot returns "yes" but the spec says { type: "boolean" }:
await ext.run("validate");
// throws ReturnValidationError { expected: "boolean", received: "string" }
```

The schema language is a tiny JSON-Schema subset: `type` (incl. unions),
`enum`, `const`, `nullable`, object `required`/`properties`/`additionalProperties`,
array `items`, and basic string/number constraints. `"unknown"`, `"any"`, and
unrecognized type names impose no constraint. Disable with
`validateReturns: false`.

### Tracing

```ts
const res = await ext.exec("validate", { value: "a@b.co" }, { trace: true });
res.trace;
// {
//   slot: "validate", startedAt: "2026-…Z", durationMs: 0.04,
//   ok: true, result: true, validation: { ok: true }
// }
```

Pass a shared `new Trace()` as `options.trace` to accumulate records across
multiple slot calls.

### Async slots

A slot marked `async: true` may use `await`:

```ts
toolCall: { async: true, returns: { type: "object" } }
```

```json
{ "toolCall": "const r = await ctx.tools.search({ q: ctx.input }); return { items: r };" }
```

`await` inside a non-async slot is rejected at compile time
(`SlotCompileError`).

### Structured errors

All failures are `JsonExeError` instances with a stable `kind` and a `toJSON()`:

`ParseError`, `KindMismatchError`, `StaticFieldValidationError`,
`MissingRequiredSlotError`, `UnknownSlotError`, `SlotNotFoundError`,
`SlotCompileError`, `SlotRuntimeError`, `ReturnValidationError`,
`TimeoutError`, `PermissionError`, `ValidationError`.

Runtime errors carry a best-effort `line`/`column` mapped back to the **slot
source** (not the wrapper). Errors never embed `ctx` values.

---

## Testing extensions (`@json-exe/testing`)

Extensions can embed `$tests`:

```json
{
  "$kind": "form-validator/v1",
  "validate": "return typeof ctx.value === 'string' && ctx.value.includes('@')",
  "$tests": [
    { "name": "valid",   "slot": "validate", "ctx": { "value": "a@b.com" }, "expect": true },
    { "name": "invalid", "slot": "validate", "ctx": { "value": "nope" },    "expect": false }
  ]
}
```

```ts
import { testExtension } from "@json-exe/testing";

const report = await testExtension(spec, json);
// { ok: true, passed: 2, failed: 0, total: 2, tests: [...] }
```

A test uses `expect` (deep-equal the return value) or `throws` (expect an error
of a given `kind`, or any error with `true`).

---

## CLI (`jsonexe`)

```bash
jsonexe validate <ext.json> --spec <spec>          # validate shape
jsonexe check    <ext.json> --spec <spec>          # validate + compile all slots
jsonexe run      <ext.json> <slot> --spec <spec> [--ctx ctx.json] [--trace] [--json]
jsonexe test     <ext.json> --spec <spec>          # run $tests
jsonexe explain  <ext.json> [--spec <spec>]        # describe the extension
```

Specs can be `.json` (a spec is pure data) or a `.js` module. `.ts` specs work
when the CLI is run via `tsx`. Exit codes: `0` success, `1` validation/run/test
failure, `2` usage error. Add `--json` for machine-readable output.

```bash
jsonexe run required-email.json validate --ctx ctx.json --spec form-validator.spec.json
# true
```

---

## Playground

**Live: [mattneel.github.io/json-exe](https://mattneel.github.io/json-exe/)** (deployed from `master` via GitHub Actions).

A browser playground (`apps/playground`, SolidJS + Vite + Monaco) lets you author
a spec (TypeScript, with IntelliSense on `@json-exe/runtime`) and an extension
(JSON, with a **TypeScript service embedded inside the slot strings** — `ctx.*`
completions/hover/type-errors **and return-type checking** driven by the live
spec, so a `boolean` slot that returns a string is squiggled and an `enum` slot
autocompletes its allowed values), then run/test/trace it in-browser using the
real runtime.

```bash
pnpm --filter @json-exe/playground dev
```

See [`apps/playground/README.md`](apps/playground/README.md).

## Security

> `new Function()` is **not** a sandbox.

The default evaluator (`"unsafe-new-function"`) runs slot code with the full
privileges of the host process. It is intended for **trusted / local / admin /
test** use only. The runtime still gives you:

- return validation and structured errors,
- an optional `freezeContext` (immutable `ctx`),
- best-effort per-slot timeouts (meaningful for async slots),
- a declared-vs-granted permission check (`$permissions`),
- no automatic exposure of host globals through `ctx`.

The security model is **capability-based**: a slot can only do what `ctx` lets
it. Put narrow, scoped capabilities in `ctx` — not `db`, `fs`, `fetch`, or
`process`. See [docs/security.md](docs/security.md).

For untrusted code, run the **sandboxed** [`@json-exe/evaluator-quickjs`](packages/evaluator-quickjs)
(QuickJS-ng compiled to WASM): no host globals, a memory limit, and a CPU
deadline that interrupts infinite loops.

```ts
import { createQuickJSEvaluator } from "@json-exe/evaluator-quickjs";
const evaluator = await createQuickJSEvaluator();
const ext = await compileExtension(spec, json, { evaluator });
```

The playground has an **executor dropdown** to switch between `new Function`
(dev) and the QuickJS sandbox live in the browser.

---

## Repository layout

```txt
packages/
  runtime/   @json-exe/runtime   (core)
  testing/   @json-exe/testing   (testExtension)
  cli/       jsonexe             (CLI)
examples/
  form-validator/  data-transform/  ui-action/  agent-policy/
docs/
  security.md
  extension-types/  (one doc per example type)
SPEC.md
```

## License

MIT
