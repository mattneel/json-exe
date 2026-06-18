# jsonexe

Command-line interface for **[JSON.exe](https://github.com/mattneel/json-exe)** —
validate, run, test, check, and explain extensions.

```bash
npm install -g jsonexe
# or: npx jsonexe ...
```

```bash
jsonexe validate <ext.json> --spec <spec>          # validate shape
jsonexe check    <ext.json> --spec <spec>          # validate + compile all slots
jsonexe run      <ext.json> <slot> --spec <spec> [--ctx ctx.json] [--trace] [--json]
jsonexe test     <ext.json> --spec <spec>          # run $tests
jsonexe explain  <ext.json> [--spec <spec>]        # describe the extension
```

Specs may be `.json` (a spec is pure data) or a `.js` module; `.ts` specs work
when run via `tsx`. Exit codes: `0` success, `1` validation/run/test failure,
`2` usage error. Add `--json` for machine-readable output.

```bash
jsonexe run required-email.json validate --ctx ctx.json --spec form-validator.spec.json
# true
```

MIT
