# @json-exe/playground

A Monaco-based playground for authoring JSON.exe **extension types** and
**extensions** with language-server ergonomics, and running them in the browser.

**Live: [mattneel.github.io/json-exe](https://mattneel.github.io/json-exe/)**

## What it does

- **Spec editor** (TypeScript) — author `defineExtensionType({ ... })` with full
  IntelliSense on `@json-exe/runtime` (the runtime's `.d.ts` is loaded into
  Monaco's TS service). The spec is transpiled (CommonJS) by Monaco's worker and
  executed live.
- **Extension editor** (JSON) with an **embedded TypeScript service inside slot
  strings**: completions, hover, and type diagnostics for `ctx.*`, where the
  `ctx` type is synthesized from the live spec's `context`. Offsets are mapped
  precisely through JSON string escaping. Each slot is also checked against its
  declared `returns` schema — a `boolean` slot that returns a string is
  squiggled, and an `enum` slot autocompletes and rejects its allowed values.
  Plus structural validation markers (kind mismatch, missing/invalid slots) from
  the real runtime, and key/`$kind` completions from a spec-derived JSON schema.
- **Run panel** — compile in-browser, run any slot against a `ctx` editor, run
  the embedded `$tests`, and view the structured result + trace. Powered by the
  real `@json-exe/runtime` and `@json-exe/testing` — it eats its own dogfood.
- A **sample gallery** (form validator, data transform, agent policy).

## Run it

```bash
# from the repo root
pnpm install
pnpm --filter @json-exe/playground dev      # http://localhost:5173
```

`dev`/`build` run a `predev`/`prebuild` step that builds `@json-exe/runtime` and
`@json-exe/testing` first (the playground loads the runtime `.d.ts` and imports
the built packages).

```bash
pnpm --filter @json-exe/playground build     # static build to dist/
pnpm --filter @json-exe/playground preview
```

## Architecture

| File | Role |
| --- | --- |
| `src/monaco/setup.ts` | Monaco worker wiring; TS defaults; loads runtime `.d.ts` |
| `src/monaco/jsonexeLanguage.ts` | The embedded-TS bridge: completions / hover / diagnostics inside slot strings + structural markers + JSON schema |
| `src/lib/embed.ts` | Pure helpers: escape/offset mapping, `ctx` type synthesis, slot extraction, schema generation (unit-tested) |
| `src/lib/specEval.ts` | Transpile (CJS) + execute the spec module with a sandboxed `require` |
| `src/lib/run.ts` | Compile / run / test bridge to the runtime |
| `src/App.tsx` | SolidJS UI, model lifecycle, reactivity |

The trickiest logic — offset mapping through JSON escaping and `ctx` synthesis —
is isolated in `src/lib/embed.ts` and covered by unit tests
(`pnpm test`). A headless-browser smoke test exercises the full stack:

```bash
pnpm --filter @json-exe/playground dev &     # serve on :5173 (or use --port 5199)
SMOKE_URL=http://localhost:5173/ pnpm --filter @json-exe/playground smoke
```

## Notes / limitations

- The default evaluator is `new Function` (dev-only; see
  [`docs/security.md`](../../docs/security.md)). The playground runs untrusted-ish
  code in your own browser tab — fine for authoring, not a sandbox.
- For simplicity it imports the full `monaco-editor` entry, which bundles all
  basic-language grammars (large JS chunk). A production deploy could import the
  slim `editor.api` + only the TS/JSON contributions to slim the bundle.
- Multi-line slot bodies must be written as escaped JSON strings (`\n`); the
  embedded service maps through the escaping, but a future enhancement could add
  a per-slot focused JS editor for nicer multi-line authoring.
