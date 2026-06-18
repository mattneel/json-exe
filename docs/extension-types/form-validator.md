# form-validator/v1

## Purpose

Defines validation logic for a single form field.

## Context

```ts
type Ctx = {
  value: unknown;                    // the field's current value
  field: Field;                      // field metadata
  form: Record<string, unknown>;     // the whole form
  user: User | null;                 // current user
};
```

## Static fields

| Field | Required | Schema             |
| ----- | -------- | ------------------ |
| `id`  | yes      | `{ type: string }` |

## Slots

### validate (required)

```ts
validate(ctx) -> boolean
```

Return `true` when the field value is valid.

### message

```ts
message(ctx) -> string
```

Return the message shown when validation fails.

### severity

```ts
severity(ctx) -> "info" | "warning" | "error"
```

Return the severity of a failed validation.

## Example

```json
{
  "$kind": "form-validator/v1",
  "id": "strong-password",
  "validate": "return typeof ctx.value === 'string' && ctx.value.length >= 12 && /[0-9]/.test(ctx.value)",
  "message": "return 'Password must be at least 12 characters and include a number.'",
  "severity": "return 'error'"
}
```

See [`examples/form-validator`](../../examples/form-validator).

## Common errors

- `MissingRequiredSlotError` — `validate` is absent.
- `ReturnValidationError` — `validate` returned a non-boolean, or `severity`
  returned a value outside the enum.
- `StaticFieldValidationError` — `id` missing or not a string.
