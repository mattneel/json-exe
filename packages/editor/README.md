# @json-exe/editor

Embeddable Monaco language features and an editor component for JSON.exe. Bring
your own `monaco-editor` instance (it's a peer dependency, so there's one Monaco).

## Drop-in editor

```ts
import * as monaco from "monaco-editor";
import { createExtensionEditor } from "@json-exe/editor";

const handle = createExtensionEditor(monaco, container, {
  spec: formValidatorSpec, // an ExtensionTypeSpec (value or () => spec)
  value: '{\n  "$kind": "form-validator/v1",\n  "validate": "return ctx.value.includes(\'@\')"\n}',
});

const res = await handle.run("validate", { value: "a@b.com" }); // SlotResult + trace
const report = await handle.test();                              // runs $tests
handle.dispose();
```

You get JSON editing with a **TypeScript service embedded inside the slot
strings**: `ctx.*` completions/hover/signature-help, return-type checking from
each slot's `returns` schema, slot-key signature hovers, structural diagnostics
from the real runtime, and `$kind`/slot-key completions.

## Lower-level: attach features to your own model

```ts
import { setupJsonExeMonaco, installJsonExeLanguage } from "@json-exe/editor";

setupJsonExeMonaco(monaco); // configure the TS service (idempotent)

const language = installJsonExeLanguage(monaco, {
  model,               // a JSON ITextModel
  getSpec: () => spec, // live spec
});
// language.refresh() when the spec changes; language.dispose() to tear down.
```

## Spec authoring (optional)

To give a TypeScript spec editor IntelliSense on `@json-exe/runtime`:

```ts
import { addRuntimeTypes, evalSpecModel } from "@json-exe/editor";

// runtimeDts: the text of @json-exe/runtime's index.d.ts (e.g. imported with ?raw)
addRuntimeTypes(monaco, runtimeDts);
// spec models should use the file:// URI scheme so module resolution works.

const { spec, error } = await evalSpecModel(monaco, specModel);
```

## Notes

- Peer: `monaco-editor` (>= 0.50; tested with 0.55, which exposes the TS API at
  `monaco.typescript`).
- The pure helpers (`schemaToTsType`, `synthesizeCtxDecls`, offset mapping, etc.)
  are exported and Monaco-free.
