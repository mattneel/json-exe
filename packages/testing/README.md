# @json-exe/testing

Run the `$tests` embedded in a **[JSON.exe](https://github.com/mattneel/json-exe)**
extension and get a structured pass/fail report.

```bash
npm install @json-exe/testing
```

```ts
import { testExtension } from "@json-exe/testing";

const report = await testExtension(spec, {
  $kind: "form-validator/v1",
  validate: "return typeof ctx.value === 'string' && ctx.value.includes('@')",
  $tests: [
    { name: "valid",   slot: "validate", ctx: { value: "a@b.com" }, expect: true },
    { name: "invalid", slot: "validate", ctx: { value: "nope" },    expect: false },
  ],
});
// { ok: true, passed: 2, failed: 0, total: 2, tests: [...] }
```

Each test uses `expect` (deep-equals the return value) or `throws` (expects an
error of a given `kind`, or any error with `true`). Extra options accept anything
`compileExtension` does (e.g. a sandboxed `evaluator`).

MIT
