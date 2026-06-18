# ui-action/v1

## Purpose

A contextual action shown in a UI (e.g. a toolbar/menu command).

## Context

```ts
type Ctx = {
  user: User;
  selection: unknown[];
  appState: AppState;
  config: Record<string, unknown>;
  actions: ActionRegistry;   // scoped, host-provided side-effecting capabilities
};
```

## Static fields

| Field | Required | Schema             |
| ----- | -------- | ------------------ |
| `id`  | yes      | `{ type: string }` |

## Slots

### visible

```ts
visible(ctx) -> boolean
```

Should the action be shown?

### enabled

```ts
enabled(ctx) -> boolean
```

Should the action be enabled?

### label (required)

```ts
label(ctx) -> string
```

The label to display.

### run (required, async)

```ts
run(ctx) -> object   // async
```

Perform the action and return a result object. Side effects must go through
scoped capabilities on `ctx` (e.g. `ctx.actions.archive(...)`).

## Example

```json
{
  "$kind": "ui-action/v1",
  "id": "bulk-archive",
  "visible": "return ctx.user.role === 'admin'",
  "enabled": "return ctx.selection.length > 0",
  "label": "return `Archive ${ctx.selection.length} items`",
  "run": "return await ctx.actions.archive(ctx.selection.map(item => item.id))"
}
```

See [`examples/ui-action`](../../examples/ui-action).

## Common errors

- `MissingRequiredSlotError` — `label` or `run` is absent.
- `ReturnValidationError` — `run` resolved to a non-object.
- `SlotRuntimeError` — `ctx.actions` (or a capability) was not provided.
