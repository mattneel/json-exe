export interface Sample {
  id: string;
  label: string;
  /** Spec authored as TypeScript (`export default defineExtensionType(...)`). */
  spec: string;
  /** Extension authored as JSON. */
  extension: string;
  /** Default ctx for the run panel. */
  ctx: string;
  /** Slot pre-selected in the run panel. */
  defaultSlot: string;
}

const formValidator: Sample = {
  id: "form-validator",
  label: "Form validator",
  spec: `import { defineExtensionType } from "@json-exe/runtime";

export default defineExtensionType({
  kind: "form-validator/v1",
  context: {
    value: "unknown",
    field: "Field",
    form: "Record<string, unknown>",
    user: "User | null",
  },
  slots: {
    validate: { required: true, returns: { type: "boolean" } },
    message: { returns: { type: "string" } },
    severity: { returns: { enum: ["info", "warning", "error"] } },
  },
});
`,
  extension: `{
  "$kind": "form-validator/v1",
  "id": "required-email",
  "name": "Required Email",
  "validate": "return typeof ctx.value === 'string' && ctx.value.includes('@')",
  "message": "return 'Please enter a valid email address.'",
  "severity": "return 'error'",
  "$tests": [
    { "name": "accepts an email", "slot": "validate", "ctx": { "value": "matt@example.com" }, "expect": true },
    { "name": "rejects a non-email", "slot": "validate", "ctx": { "value": "nope" }, "expect": false }
  ]
}
`,
  ctx: `{ "value": "matt@example.com" }`,
  defaultSlot: "validate",
};

const dataTransform: Sample = {
  id: "data-transform",
  label: "Data transform",
  spec: `import { defineExtensionType } from "@json-exe/runtime";

export default defineExtensionType({
  kind: "data-transform/v1",
  context: {
    row: "Record<string, unknown>",
    index: "number",
    helpers: "TransformHelpers",
  },
  slots: {
    filter: { returns: { type: "boolean" } },
    map: { required: true, returns: { type: "object" } },
    explain: { returns: { type: "string" } },
  },
});
`,
  extension: `{
  "$kind": "data-transform/v1",
  "id": "normalize-user-row",
  "filter": "return !!ctx.row.email",
  "map": "return { id: String(ctx.row.id), email: String(ctx.row.email).trim().toLowerCase(), active: Boolean(ctx.row.active) }",
  "explain": "return 'Normalizes id, email, and active.'",
  "$tests": [
    { "name": "keeps rows with an email", "slot": "filter", "ctx": { "row": { "email": "a@b.com" } }, "expect": true },
    { "name": "normalizes a row", "slot": "map", "ctx": { "row": { "id": 7, "email": "  A@B.COM ", "active": 1 } }, "expect": { "id": "7", "email": "a@b.com", "active": true } }
  ]
}
`,
  ctx: `{ "row": { "id": 7, "email": "  A@B.COM ", "active": 1 } }`,
  defaultSlot: "map",
};

const agentPolicy: Sample = {
  id: "agent-policy",
  label: "Agent policy",
  spec: `import { defineExtensionType } from "@json-exe/runtime";

export default defineExtensionType({
  kind: "agent-policy/v1",
  context: {
    input: "string",
    state: "Record<string, unknown>",
    budget: "{ toolCallsRemaining: number }",
    result: "unknown",
  },
  slots: {
    "state.init": { phase: "init", returns: { type: "object" } },
    shouldUseTool: { returns: { type: "boolean" } },
    toolCall: { returns: { type: "object", required: ["tool", "args"] } },
    shouldAnswer: { returns: { type: "boolean" } },
  },
});
`,
  extension: `{
  "$kind": "agent-policy/v1",
  "id": "source-first-research",
  "state.init": "return { sources: [], attempts: 0 }",
  "shouldUseTool": "return ctx.state.sources.length < 3 && ctx.budget.toolCallsRemaining > 0",
  "toolCall": "return { tool: 'search', args: { query: ctx.input + ' official source' } }",
  "shouldAnswer": "return ctx.state.sources.length >= 3 || ctx.budget.toolCallsRemaining <= 0",
  "$tests": [
    { "name": "builds a search call", "slot": "toolCall", "ctx": { "input": "vaccines" }, "expect": { "tool": "search", "args": { "query": "vaccines official source" } } }
  ]
}
`,
  ctx: `{ "input": "vaccines" }`,
  defaultSlot: "toolCall",
};

export const SAMPLES: Sample[] = [formValidator, dataTransform, agentPolicy];
