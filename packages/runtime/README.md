# @json-exe/runtime

Core runtime for **[JSON.exe](https://github.com/mattneel/json-exe)** — a universal
executable-object substrate. A host defines an *extension type* (the shape of
`ctx` and a set of named JS *slots* with return schemas); users (or LLMs) write
an *extension* as a JSON object; the runtime compiles the slot strings, runs them
against `ctx`, validates return values, and traces everything.

Zero dependencies. Runs in Node, browsers, Deno, and edge runtimes.

```bash
npm install @json-exe/runtime
```

```ts
import { defineExtensionType, compileExtension } from "@json-exe/runtime";

const formValidator = defineExtensionType({
  kind: "form-validator/v1",
  context: { value: "unknown" },
  slots: { validate: { required: true, returns: { type: "boolean" } } },
});

const ext = await compileExtension(formValidator, {
  $kind: "form-validator/v1",
  validate: "return typeof ctx.value === 'string' && ctx.value.includes('@')",
});

await ext.run("validate", { value: "matt@example.com" }); // => true
```

## API

- `defineExtensionType(spec)` — define/validate an extension type.
- `compileExtension(spec, json, options?)` → `CompiledExtension` with
  `run<T>(slot, ctx?, opts?)` (returns the validated value or throws) and
  `exec<T>(slot, ctx?, opts?)` (non-throwing `{ ok, result, error, trace }`).
- `validateExtension(spec, json, options?)` → `{ ok, errors[] }` (never throws).
- `runSlot(spec, json, slot, ctx?, options?)` — one-shot compile + run.
- `createRuntime(defaults?)` — a runtime with default compile options.
- `Trace`, structured `JsonExeError` types, and a tiny schema validator
  (`validateAgainstSchema`, `deepEqual`) are exported too.

## Security

The default evaluator (`unsafe-new-function`) is **not a sandbox** — use it for
trusted/local/dev code. For untrusted code, pass an isolated evaluator such as
[`@json-exe/evaluator-quickjs`](https://github.com/mattneel/json-exe/tree/master/packages/evaluator-quickjs):

```ts
import { createQuickJSEvaluator } from "@json-exe/evaluator-quickjs";
const ext = await compileExtension(spec, json, { evaluator: await createQuickJSEvaluator() });
```

See the [full docs](https://github.com/mattneel/json-exe) and
[security notes](https://github.com/mattneel/json-exe/blob/master/docs/security.md).

MIT
