# agent-policy/v1

## Purpose

A small policy that steers an agent loop: decide when to use a tool, what call
to make, how to fold results into state, and when to answer.

## Context

```ts
type Ctx = {
  input: string;
  state: Record<string, unknown>;
  messages: Message[];
  tools: ToolRegistry;
  memory: MemoryView;
  budget: Budget;            // e.g. { toolCallsRemaining: number }
  result: unknown;           // the most recent tool result (for afterTool)
};
```

## Slots

Slots use dotted names where helpful. The host controls evaluation order; a
recommended order is declared in the spec's `lifecycle.order`:

```txt
state.init -> shouldUseTool -> toolCall -> afterTool -> shouldAnswer -> answerInstructions
```

| Slot                 | Returns                                  | Phase |
| -------------------- | ---------------------------------------- | ----- |
| `state.init`         | `object`                                 | init  |
| `shouldUseTool`      | `boolean`                                |       |
| `toolCall`           | `object` (requires `tool` + `args`)      |       |
| `afterTool`          | `object`                                 |       |
| `shouldAnswer`       | `boolean`                                |       |
| `answerInstructions` | `string`                                 |       |

## Example

```json
{
  "$kind": "agent-policy/v1",
  "id": "source-first-research",
  "$permissions": { "tools": ["search"], "network": false, "memory": "read" },

  "state.init": "return { sources: [], attempts: 0 }",
  "shouldUseTool": "return ctx.state.sources.length < 3 && ctx.budget.toolCallsRemaining > 0",
  "toolCall": "return { tool: 'search', args: { query: ctx.input + ' official source' } }",
  "afterTool": "return { ...ctx.state, attempts: ctx.state.attempts + 1, sources: ctx.state.sources.concat(ctx.result.items.slice(0, 5)) }",
  "shouldAnswer": "return ctx.state.sources.length >= 3 || ctx.budget.toolCallsRemaining <= 0",
  "answerInstructions": "return 'Answer using only ctx.state.sources. Cite factual claims.'"
}
```

Both flat dotted keys (`"state.init"`) and nested objects
(`{ "state": { "init": "..." } }`) are accepted; the canonical slot name is the
dotted path.

See [`examples/agent-policy`](../../examples/agent-policy).

## Common errors

- `ReturnValidationError` — `toolCall` returned an object missing `tool`/`args`.
- `PermissionError` — declared `$permissions` exceed the host's grants (when
  `grantedPermissions` is supplied to `compileExtension`).

## Security note

`toolCall` only *describes* a call (`{ tool, args }`); the host decides whether
and how to execute it against the real, scoped `ctx.tools`. The policy never
holds the capability directly.
