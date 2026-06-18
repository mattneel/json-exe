# data-transform/v1

## Purpose

Filter and reshape a single input row (e.g. an import/export mapper).

## Context

```ts
type Ctx = {
  row: Record<string, unknown>;   // the input row
  index: number;                  // row index
  helpers: TransformHelpers;      // host-provided helpers (e.g. slugify)
};
```

## Static fields

| Field | Required | Schema             |
| ----- | -------- | ------------------ |
| `id`  | yes      | `{ type: string }` |

## Slots

### filter

```ts
filter(ctx) -> boolean
```

Return `true` to keep the row.

### map (required)

```ts
map(ctx) -> object
```

Return the transformed row.

### explain

```ts
explain(ctx) -> string
```

Describe what this transform does (useful for UIs and audits).

## Example

```json
{
  "$kind": "data-transform/v1",
  "id": "normalize-user-row",
  "filter": "return !!ctx.row.email",
  "map": "return { id: String(ctx.row.id), email: String(ctx.row.email).trim().toLowerCase(), active: Boolean(ctx.row.active) }",
  "explain": "return 'Normalizes id, email, and active fields.'"
}
```

See [`examples/data-transform`](../../examples/data-transform).

## Common errors

- `MissingRequiredSlotError` — `map` is absent.
- `ReturnValidationError` — `map` returned a non-object, or `filter` returned a
  non-boolean.
