# JSON.exe SPEC.md

## One-Line Pitch

**JSON.exe** is a universal plugin, extension, and scripting layer where extensions are plain JSON objects, and selected named fields are executable JavaScript slots evaluated against a documented host context.

```txt
Document the ctx.
Document the slots.
Let JSON.exe do the rest.
```

---

# 1. Vision

Modern software keeps reinventing scripting layers:

* app plugins
* workflow steps
* agent policies
* form validators
* data transforms
* UI actions
* rules engines
* low-code automation blocks
* user-defined callbacks
* feature flags with logic
* custom import/export mappers

Most systems either:

1. invent a custom DSL,
2. expose a plugin API that requires a full package/build step,
3. store opaque JS snippets without structure,
4. use JSON config that cannot express behavior,
5. or bolt on a rules engine that becomes its own language.

**JSON.exe** takes a simpler position:

> JSON is the substrate.
> JavaScript is the behavior language.
> The host app defines the contract.

An extension is just a JSON object.

Some fields are metadata.

Some fields are JavaScript source strings.

Those JavaScript fields are compiled into named executable slots.

Each extension type documents:

* the shape of `ctx`
* the allowed slot names
* the expected return type of each slot
* whether each slot is sync or async
* what capabilities the slot may access
* how the host will call the slot

This creates a universal scripting layer without inventing a new programming language.

---

# 2. Core Concept

A JSON.exe extension looks like this:

```json
{
  "$kind": "form-validator/v1",
  "id": "required-email",
  "name": "Required Email",

  "validate": "return typeof ctx.value === 'string' && ctx.value.includes('@')",

  "message": "return 'Please enter a valid email address.'"
}
```

The host app defines the extension type:

```ts
const formValidatorSpec = defineExtensionType({
  kind: "form-validator/v1",

  context: {
    value: "unknown",
    field: "Field",
    form: "Record<string, unknown>",
    user: "User | null"
  },

  slots: {
    validate: {
      required: true,
      returns: "boolean",
      description: "Returns true when the field value is valid."
    },

    message: {
      required: false,
      returns: "string",
      description: "Returns the validation message shown to the user."
    }
  }
});
```

At runtime:

```ts
const extension = await compileExtension(formValidatorSpec, json);

const valid = await extension.run("validate", {
  value: "matt@example.com",
  field,
  form,
  user
});
```

The user writes JSON.

The host app owns the API.

JSON.exe owns compilation, validation, tracing, execution, and repair hooks.

---

# 3. Design Principles

## 3.1 JSON Is the Package Format

Extensions must be:

* serializable
* copyable
* diffable
* patchable
* inspectable
* storable in a database
* easy for LLMs to generate
* easy for humans to edit

No required bundler.

No required package manager.

No required AST format.

No required custom language.

## 3.2 JavaScript Is the Behavior Language

JavaScript already has:

* expressions
* functions
* arrays
* objects
* regex
* async/await
* string manipulation
* date handling
* closures
* broad developer familiarity

JSON.exe does not invent a new expression language.

A slot is JavaScript source code wrapped as a function:

```js
new Function("ctx", `"use strict";\n${source}`)
```

Production runtimes may use safer isolated evaluators, workers, subprocesses, or platform sandboxes, but the conceptual model remains:

```ts
slot(ctx) -> result
```

## 3.3 The Host Defines Meaning

JSON.exe itself does not know what a validator, agent policy, UI action, import mapper, or workflow step means.

The host defines an extension type.

An extension type is a contract.

```txt
Extension type = protocol
JSON object = implementation
Named fields = methods
ctx = capability boundary
return schemas = type system
runtime = executor
```

## 3.4 Slots Are Small

JSON.exe is not for generating 500-line plugins.

It is for small named executable behaviors.

Bad:

```json
{
  "plugin": "/* 700 lines of app logic */"
}
```

Good:

```json
{
  "match": "return ctx.text.includes('refund')",
  "classify": "return ctx.match ? 'billing' : 'general'",
  "confidence": "return ctx.classification === 'billing' ? 0.9 : 0.5"
}
```

Small slots are easier to:

* validate
* test
* trace
* regenerate
* diff
* repair
* secure
* explain

## 3.5 Context Is Authority

Slots receive no authority except what the host puts in `ctx`.

The host controls:

* available data
* available helpers
* available tools
* permissions
* budgets
* state
* environment
* side effects

The correct security model is not “trust the code.”

The correct security model is:

> Code can only do what `ctx` allows, and untrusted code must run in isolation.

---

# 4. Terminology

## Extension

A JSON object implementing a host-defined extension type.

```json
{
  "$kind": "data-transform/v1",
  "id": "normalize-user-row",
  "map": "return { id: String(ctx.row.id), email: ctx.row.email.toLowerCase() }"
}
```

## Extension Type

A named contract describing the context and slots for a class of extension.

Examples:

```txt
form-validator/v1
data-transform/v1
agent-policy/v1
ui-action/v1
workflow-step/v1
document-classifier/v1
```

## Slot

A named executable field inside the JSON extension.

Example:

```json
{
  "validate": "return ctx.value.length > 0"
}
```

## Source Field

A JSON string field that contains JavaScript source code.

## Static Field

A JSON field that is metadata or configuration, not executable code.

Example:

```json
{
  "id": "required-email",
  "name": "Required Email",
  "severity": "error"
}
```

## Context

The object passed into a slot at runtime.

```ts
slot(ctx)
```

## Capability

Any object, helper, tool, function, or side-effectful operation exposed through `ctx`.

## Runtime

The engine responsible for compiling, validating, and executing slots.

## Trace

A structured execution record of slot calls, inputs, outputs, errors, timing, and validation results.

---

# 5. Extension Object Format

Every JSON.exe extension SHOULD include:

```json
{
  "$schema": "https://jsonexe.dev/schemas/extension.v1.json",
  "$kind": "some-extension-kind/v1",
  "id": "unique-extension-id",
  "name": "Human Name",
  "description": "What this extension does."
}
```

Only `$kind` and executable slots are strictly required by the runtime unless the host spec requires more.

## 5.1 Reserved Fields

The following fields are reserved:

```txt
$schema
$kind
$id
$version
$meta
$permissions
$tests
$examples
```

Recommended standard metadata:

```json
{
  "$kind": "form-validator/v1",
  "$version": "1.0.0",
  "id": "required-email",
  "name": "Required Email",
  "description": "Validates that a field contains an email-like value.",
  "author": "Example",
  "license": "MIT"
}
```

## 5.2 Executable Fields

An executable field is a string that the extension type spec identifies as a slot.

```json
{
  "validate": "return ctx.value.includes('@')"
}
```

The runtime does not treat every string as code.

Only fields declared as slots in the extension type spec are compiled.

## 5.3 Nested Slot Names

Slots MAY use dotted names:

```json
{
  "state.init": "return { count: 0 }",
  "tool.search": "return { query: ctx.input }",
  "after.search": "return { ...ctx.state, result: ctx.result }"
}
```

Dotted names are names, not necessarily nested objects.

This keeps JSON flat, diffable, and easy to patch.

## 5.4 Optional Nested Objects

Hosts MAY allow nested executable objects:

```json
{
  "state": {
    "init": "return { count: 0 }"
  },
  "tool": {
    "search": "return { query: ctx.input }"
  }
}
```

The canonical internal path representation should still be:

```txt
state.init
tool.search
```

---

# 6. Extension Type Spec

An extension type spec defines the contract for one kind of extension.

```ts
type ExtensionTypeSpec = {
  kind: string;
  version?: string;

  description?: string;

  staticFields?: Record<string, StaticFieldSpec>;

  context: ContextSpec;

  slots: Record<string, SlotSpec>;

  permissions?: PermissionSpec;

  lifecycle?: LifecycleSpec;

  tests?: TestSpec[];
};
```

## 6.1 Slot Spec

```ts
type SlotSpec = {
  description?: string;

  required?: boolean;

  async?: boolean;

  phase?: "init" | "match" | "run" | "render" | "cleanup";

  returns: Schema;

  params?: Schema;

  reads?: string[];

  writes?: string[];

  permissions?: string[];

  timeoutMs?: number;

  maxCalls?: number;

  examples?: string[];
};
```

Example:

```ts
const spec = defineExtensionType({
  kind: "form-validator/v1",

  context: {
    value: "unknown",
    field: "Field",
    form: "Record<string, unknown>",
    user: "User | null"
  },

  slots: {
    validate: {
      required: true,
      returns: "boolean",
      timeoutMs: 20,
      description: "Return true if the field value is valid."
    },

    message: {
      required: false,
      returns: "string",
      timeoutMs: 20,
      description: "Return the message to show when validation fails."
    }
  }
});
```

## 6.2 Static Field Spec

```ts
type StaticFieldSpec = {
  required?: boolean;
  schema: Schema;
  description?: string;
};
```

Example:

```ts
staticFields: {
  id: {
    required: true,
    schema: { type: "string" }
  },

  severity: {
    required: false,
    schema: {
      enum: ["info", "warning", "error"]
    }
  }
}
```

---

# 7. Runtime API

## 7.1 Define Extension Type

```ts
import { defineExtensionType } from "@json-exe/runtime";

const validatorType = defineExtensionType({
  kind: "form-validator/v1",

  context: {
    value: "unknown",
    field: "Field",
    form: "Record<string, unknown>"
  },

  slots: {
    validate: {
      required: true,
      returns: { type: "boolean" }
    },

    message: {
      returns: { type: "string" }
    }
  }
});
```

## 7.2 Compile Extension

```ts
import { compileExtension } from "@json-exe/runtime";

const extension = await compileExtension(validatorType, {
  "$kind": "form-validator/v1",
  "id": "required-email",
  "validate": "return typeof ctx.value === 'string' && ctx.value.includes('@')",
  "message": "return 'Please enter a valid email address.'"
});
```

## 7.3 Run Slot

```ts
const result = await extension.run("validate", {
  value: "matt@example.com",
  field,
  form
});
```

## 7.4 Inspect Slots

```ts
extension.slots();
/*
[
  {
    name: "validate",
    required: true,
    compiled: true
  },
  {
    name: "message",
    required: false,
    compiled: true
  }
]
*/
```

## 7.5 Trace Execution

```ts
const result = await extension.run("validate", ctx, {
  trace: true
});

console.log(result.trace);
```

Example trace:

```json
{
  "slot": "validate",
  "startedAt": "2026-06-17T22:10:00.000Z",
  "durationMs": 1.4,
  "ok": true,
  "result": true,
  "validation": {
    "ok": true
  }
}
```

---

# 8. Execution Model

## 8.1 Slot Compilation

Default dev runtime:

```ts
function compileSlot(source: string) {
  return new Function(
    "ctx",
    `"use strict";\n${source}`
  ) as (ctx: unknown) => unknown;
}
```

Async-capable slots can be compiled as:

```ts
function compileAsyncSlot(source: string) {
  return new Function(
    "ctx",
    `"use strict";\nreturn (async () => {\n${source}\n})();`
  ) as (ctx: unknown) => Promise<unknown>;
}
```

## 8.2 Slot Execution

Basic flow:

```txt
load extension JSON
  ↓
validate static fields
  ↓
identify slots from extension type spec
  ↓
compile slot source strings
  ↓
freeze/proxy ctx
  ↓
run requested slot
  ↓
validate return value
  ↓
record trace
  ↓
return result
```

## 8.3 Evaluation Order

The host controls evaluation order.

JSON.exe does not require dataflow semantics by default.

A host may define:

```txt
validate -> message
match -> classify -> confidence -> explain
state.init -> shouldUseTool -> toolCall -> afterTool -> shouldAnswer
```

The runtime MAY provide helpers for dependency-driven execution later.

## 8.4 Sync and Async

Slots are sync by default.

A slot spec may allow async:

```ts
toolCall: {
  async: true,
  returns: ToolCallSchema
}
```

Then the slot can use:

```js
const result = await ctx.tools.search({ query: ctx.input });
return result.items;
```

The runtime must reject `await` in sync slots or compile all slots as async internally.

---

# 9. Security Model

## 9.1 Critical Rule

`new Function()` is not a sandbox.

JSON.exe must not claim that arbitrary untrusted code is safe merely because it only receives `ctx`.

The safe production model is:

```txt
untrusted JSON.exe extension
  ↓
schema validation
  ↓
permission validation
  ↓
isolated runtime
  ↓
frozen/proxied ctx
  ↓
timeout/budget enforcement
  ↓
return validation
  ↓
trace/audit
```

## 9.2 Threats

JSON.exe must account for:

* infinite loops
* memory exhaustion
* prototype pollution
* data exfiltration
* access to globals
* access to process/env/filesystem/network
* malicious helper calls
* expensive computation
* hidden side effects
* dependency confusion if imports are ever supported
* prompt-injected agent-generated extensions

## 9.3 Dev Runtime

The initial runtime may use `new Function()` and should be documented as trusted/local/dev only.

```ts
createRuntime({
  evaluator: "unsafe-new-function"
});
```

This is useful for:

* local development
* trusted admin-authored extensions
* fast prototyping
* tests

## 9.4 Production Runtime

Production should support isolated evaluators.

Possible adapters:

```txt
@json-exe/evaluator-worker
@json-exe/evaluator-iframe
@json-exe/evaluator-node-vm
@json-exe/evaluator-process
@json-exe/evaluator-cloudflare-workers
@json-exe/evaluator-deno
@json-exe/evaluator-quickjs
```

The exact implementation can vary by platform.

Required production properties:

* no ambient filesystem access
* no ambient network access
* no direct process/env access
* no unrestricted imports
* wall-clock timeout
* CPU budget where available
* memory budget where available
* structured clone boundary where possible
* frozen intrinsics where possible
* immutable or proxied `ctx`
* explicit capability grants

## 9.5 Capability-Based Context

Bad:

```ts
ctx = {
  db,
  fs,
  fetch,
  process
}
```

Good:

```ts
ctx = {
  input,
  user: safeUserView,
  tools: {
    search: limitedSearchTool,
    lookupCustomer: scopedCustomerLookup
  },
  budget: {
    toolCallsRemaining: 3
  }
}
```

Slots should receive narrow capabilities.

## 9.6 Permission Manifest

Extensions MAY declare permissions:

```json
{
  "$kind": "agent-policy/v1",
  "$permissions": {
    "tools": ["search"],
    "network": false,
    "memory": "read"
  },

  "shouldSearch": "return ctx.budget.toolCallsRemaining > 0",
  "tool.search": "return { query: ctx.input }"
}
```

The host must validate declared permissions against actual runtime grants.

---

# 10. Validation

JSON.exe validates three layers.

## 10.1 Extension Shape

Does the JSON object conform to the extension type?

```txt
required static fields exist
required slots exist
unknown slots allowed or rejected based on policy
slot fields are strings
metadata fields match schema
```

## 10.2 Slot Return Values

Every slot return value is validated against its declared schema.

Example:

```ts
validate: {
  returns: { type: "boolean" }
}
```

If the slot returns `"yes"` instead of `true`, runtime throws:

```json
{
  "ok": false,
  "error": {
    "kind": "ReturnValidationError",
    "slot": "validate",
    "expected": "boolean",
    "received": "string"
  }
}
```

## 10.3 Permission Use

If static analysis or runtime proxying detects unauthorized capability use, execution fails.

Example:

```json
{
  "ok": false,
  "error": {
    "kind": "PermissionError",
    "slot": "tool.search",
    "message": "Slot requested ctx.tools.search but extension lacks permission tools.search."
  }
}
```

---

# 11. Error Model

All runtime errors should be structured.

```ts
type JsonExeError =
  | ParseError
  | KindMismatchError
  | MissingRequiredSlotError
  | SlotCompileError
  | SlotRuntimeError
  | ReturnValidationError
  | TimeoutError
  | PermissionError;
```

Example:

```json
{
  "ok": false,
  "error": {
    "kind": "SlotRuntimeError",
    "slot": "classify",
    "message": "Cannot read properties of undefined",
    "line": 1,
    "column": 12
  }
}
```

Errors must include:

```txt
extension id when available
kind
slot when applicable
message
phase
trace id
```

Errors should not leak secrets from `ctx`.

---

# 12. Testing

Extensions may include tests:

```json
{
  "$kind": "form-validator/v1",
  "id": "email-validator",

  "validate": "return typeof ctx.value === 'string' && ctx.value.includes('@')",

  "$tests": [
    {
      "name": "valid email",
      "ctx": { "value": "matt@example.com" },
      "slot": "validate",
      "expect": true
    },
    {
      "name": "invalid email",
      "ctx": { "value": "nope" },
      "slot": "validate",
      "expect": false
    }
  ]
}
```

Runtime API:

```ts
const report = await testExtension(spec, extensionJson);
```

Example report:

```json
{
  "ok": true,
  "passed": 2,
  "failed": 0,
  "tests": [
    {
      "name": "valid email",
      "ok": true
    },
    {
      "name": "invalid email",
      "ok": true
    }
  ]
}
```

---

# 13. Agent-Generated Extensions

JSON.exe is especially useful when an LLM generates the extension object.

The model is not asked to write a full plugin package.

It is asked to fill named fields under a strict contract.

Prompt shape:

```txt
Generate a JSON.exe extension.

Kind:
data-transform/v1

Context:
ctx.row: input row object
ctx.index: row index
ctx.helpers.slugify(text): string

Slots:
filter(ctx) -> boolean
map(ctx) -> object
explain(ctx) -> string

Rules:
- Return only JSON.
- Slot values must be JavaScript source strings.
- Do not include unknown fields.
```

Example generated extension:

```json
{
  "$kind": "data-transform/v1",
  "id": "normalize-product-import",

  "filter": "return !!ctx.row.name && Number(ctx.row.price) > 0",

  "map": "return { sku: String(ctx.row.sku || '').trim(), name: String(ctx.row.name).trim(), slug: ctx.helpers.slugify(ctx.row.name), price: Number(ctx.row.price) }",

  "explain": "return 'Keeps rows with a name and positive price, then normalizes SKU, name, slug, and price.'"
}
```

This makes the model an author, not the executor.

```txt
user request
  ↓
LLM emits JSON.exe object
  ↓
runtime validates object
  ↓
runtime compiles slots
  ↓
runtime executes deterministically
  ↓
errors become repair prompts
```

## 13.1 Slot-Level Repair

If one slot fails, regenerate only that slot.

Error:

```json
{
  "error": {
    "kind": "ReturnValidationError",
    "slot": "filter",
    "expected": "boolean",
    "received": "object"
  }
}
```

Repair prompt:

```txt
Repair only the slot "filter".
Return a JSON patch object containing only "filter".
Expected return type: boolean.
```

Patch:

```json
{
  "filter": "return Boolean(ctx.row.name && Number(ctx.row.price) > 0)"
}
```

---

# 14. Example Extension Types

## 14.1 Form Validator

Spec:

```ts
const formValidator = defineExtensionType({
  kind: "form-validator/v1",

  context: {
    value: "unknown",
    field: "Field",
    form: "Record<string, unknown>",
    user: "User | null"
  },

  slots: {
    validate: {
      required: true,
      returns: { type: "boolean" }
    },

    message: {
      returns: { type: "string" }
    },

    severity: {
      returns: {
        enum: ["info", "warning", "error"]
      }
    }
  }
});
```

Extension:

```json
{
  "$kind": "form-validator/v1",
  "id": "strong-password",

  "validate": "return typeof ctx.value === 'string' && ctx.value.length >= 12 && /[0-9]/.test(ctx.value)",

  "message": "return 'Password must be at least 12 characters and include a number.'",

  "severity": "return 'error'"
}
```

## 14.2 Data Transform

Spec:

```ts
const dataTransform = defineExtensionType({
  kind: "data-transform/v1",

  context: {
    row: "Record<string, unknown>",
    index: "number",
    helpers: "TransformHelpers"
  },

  slots: {
    filter: {
      returns: { type: "boolean" }
    },

    map: {
      required: true,
      returns: { type: "object" }
    },

    explain: {
      returns: { type: "string" }
    }
  }
});
```

Extension:

```json
{
  "$kind": "data-transform/v1",
  "id": "normalize-user-row",

  "filter": "return !!ctx.row.email",

  "map": "return { id: String(ctx.row.id), email: String(ctx.row.email).trim().toLowerCase(), active: Boolean(ctx.row.active) }",

  "explain": "return 'Normalizes id, email, and active fields.'"
}
```

## 14.3 UI Action

Spec:

```ts
const uiAction = defineExtensionType({
  kind: "ui-action/v1",

  context: {
    user: "User",
    selection: "unknown[]",
    appState: "AppState",
    config: "Record<string, unknown>"
  },

  slots: {
    visible: {
      returns: { type: "boolean" }
    },

    enabled: {
      returns: { type: "boolean" }
    },

    label: {
      required: true,
      returns: { type: "string" }
    },

    run: {
      required: true,
      async: true,
      returns: { type: "object" }
    }
  }
});
```

Extension:

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

## 14.4 Agent Policy

Spec:

```ts
const agentPolicy = defineExtensionType({
  kind: "agent-policy/v1",

  context: {
    input: "string",
    state: "Record<string, unknown>",
    messages: "Message[]",
    tools: "ToolRegistry",
    memory: "MemoryView",
    budget: "Budget",
    trace: "Trace"
  },

  slots: {
    "state.init": {
      returns: { type: "object" }
    },

    shouldUseTool: {
      returns: { type: "boolean" }
    },

    toolCall: {
      returns: {
        type: "object",
        required: ["tool", "args"]
      }
    },

    afterTool: {
      returns: { type: "object" }
    },

    shouldAnswer: {
      returns: { type: "boolean" }
    },

    answerInstructions: {
      returns: { type: "string" }
    }
  }
});
```

Extension:

```json
{
  "$kind": "agent-policy/v1",
  "id": "source-first-research",

  "state.init": "return { sources: [], attempts: 0 }",

  "shouldUseTool": "return ctx.state.sources.length < 3 && ctx.budget.toolCallsRemaining > 0",

  "toolCall": "return { tool: 'search', args: { query: ctx.input + ' official source' } }",

  "afterTool": "return { ...ctx.state, attempts: ctx.state.attempts + 1, sources: ctx.state.sources.concat(ctx.result.items.slice(0, 5)) }",

  "shouldAnswer": "return ctx.state.sources.length >= 3 || ctx.budget.toolCallsRemaining <= 0",

  "answerInstructions": "return 'Answer using only ctx.state.sources. Cite factual claims. Say when evidence is insufficient.'"
}
```

---

# 15. TypeScript Package Design

## 15.1 Monorepo Packages

```txt
packages/
  runtime/
    @json-exe/runtime

  schema/
    @json-exe/schema

  testing/
    @json-exe/testing

  evaluators/
    @json-exe/evaluator-new-function
    @json-exe/evaluator-worker
    @json-exe/evaluator-process
    @json-exe/evaluator-quickjs

  agent/
    @json-exe/agent

  cli/
    jsonexe
```

## 15.2 Core Runtime Exports

```ts
export {
  defineExtensionType,
  compileExtension,
  validateExtension,
  runSlot,
  testExtension,
  createRuntime
};
```

## 15.3 Evaluator Interface

```ts
export interface Evaluator {
  compile(input: CompileInput): Promise<CompiledSlot>;
}

export interface CompiledSlot {
  run(ctx: unknown, options?: RunOptions): Promise<SlotResult>;
}

export type CompileInput = {
  slot: string;
  source: string;
  async: boolean;
  timeoutMs?: number;
};
```

## 15.4 Runtime Interface

```ts
export interface JsonExeRuntime {
  compile(spec: ExtensionTypeSpec, json: unknown): Promise<CompiledExtension>;
  validate(spec: ExtensionTypeSpec, json: unknown): ValidationResult;
}

export interface CompiledExtension {
  kind: string;
  id?: string;

  run(slot: string, ctx: unknown, options?: RunOptions): Promise<unknown>;

  has(slot: string): boolean;

  slots(): CompiledSlotInfo[];
}
```

---

# 16. CLI

Command name:

```txt
jsonexe
```

## 16.1 Validate

```bash
jsonexe validate extension.json --spec form-validator.spec.json
```

## 16.2 Run Slot

```bash
jsonexe run extension.json validate --ctx ctx.json
```

## 16.3 Test

```bash
jsonexe test extension.json --spec form-validator.spec.json
```

## 16.4 Explain

```bash
jsonexe explain extension.json
```

## 16.5 Compile Check

```bash
jsonexe check extension.json --spec form-validator.spec.json
```

---

# 17. Documentation Model

Every extension type should document:

```txt
Kind
Version
Purpose
Static fields
Context object
Slots
Return schemas
Permissions
Lifecycle
Examples
Common errors
Security notes
```

Template:

````md
# form-validator/v1

## Purpose

Defines validation logic for a single form field.

## Context

```ts
type Ctx = {
  value: unknown;
  field: Field;
  form: Record<string, unknown>;
  user: User | null;
};
````

## Slots

### validate

```ts
validate(ctx) -> boolean
```

Returns true when the field is valid.

### message

```ts
message(ctx) -> string
```

Returns the message shown when validation fails.

## Example

```json
{
  "$kind": "form-validator/v1",
  "id": "required",
  "validate": "return ctx.value != null && String(ctx.value).trim().length > 0",
  "message": "return 'This field is required.'"
}
```

````

---

# 18. MVP

The MVP should prove the core loop:

```txt
spec -> JSON extension -> compile -> run -> validate -> trace
````

## 18.1 MVP Scope

Implement:

* TypeScript runtime
* extension type definition
* static field validation
* slot declaration
* slot compilation with `new Function`
* sync slot execution
* async slot execution
* return schema validation
* structured errors
* traces
* tests embedded in `$tests`
* simple CLI

## 18.2 MVP Non-Scope

Do not implement yet:

* distributed package registry
* import system
* dependency resolution
* visual editor
* full sandbox
* marketplace
* WASM evaluator
* dataflow engine
* source maps beyond basic line/slot errors
* browser extension support
* permissions UI

## 18.3 MVP Packages

```txt
@json-exe/runtime
@json-exe/testing
jsonexe CLI
```

## 18.4 MVP Runtime Safety

MVP must clearly label the default evaluator as unsafe for untrusted code.

```ts
createRuntime({
  evaluator: "unsafe-new-function"
});
```

MVP should still provide:

* timeout wrapper where possible
* frozen context option
* return validation
* slot-level tracing
* no automatic access to globals through `ctx`
* documentation warnings

---

# 19. Roadmap

## Phase 0 — Repo Bootstrap

* create TypeScript monorepo
* configure package manager
* configure tests
* configure lint/typecheck
* create `@json-exe/runtime`
* create `jsonexe` CLI package
* add examples

## Phase 1 — Core Runtime

* `defineExtensionType`
* `validateExtension`
* `compileExtension`
* `run(slot, ctx)`
* structured errors
* return schema validation
* basic traces
* sync slots
* async slots

## Phase 2 — Testing

* `$tests` support
* CLI test runner
* snapshot traces
* expected error tests
* fixture examples

## Phase 3 — Agent Authoring

* prompt templates for generating extensions
* repair loop helpers
* JSON patch support
* slot-level regeneration
* validation-aware error prompts
* examples for agent-generated data transforms and policies

## Phase 4 — Safer Evaluators

* browser worker evaluator
* Node worker thread evaluator
* subprocess evaluator
* QuickJS evaluator
* timeout enforcement
* memory limits where available
* hardened context passing

## Phase 5 — Developer Experience

* VS Code snippets
* JSON Schema generation
* docs generator for extension types
* playground
* trace viewer
* example gallery

## Phase 6 — Registry / Distribution

* package manifest
* signing
* trusted publishers
* version constraints
* dependency metadata
* extension catalogs

---

# 20. Open Design Questions

## 20.1 Should Slot Source Require `return`?

Option A:

```js
return ctx.value > 0
```

Option B:

```js
ctx.value > 0
```

MVP should require explicit `return`.

It is clearer, closer to function bodies, and avoids expression-vs-statement ambiguity.

## 20.2 Should Slots Receive More Than `ctx`?

Default:

```ts
slot(ctx)
```

Possible future:

```ts
slot(ctx, api)
```

MVP should use only `ctx`.

All authority should live inside `ctx`.

## 20.3 Should Imports Exist?

MVP: no imports.

Future versions may support host-approved imports:

```json
{
  "$imports": {
    "date": "@json-exe/std/date"
  }
}
```

But imports introduce dependency, supply-chain, and sandbox complexity.

## 20.4 Should Static Analysis Exist?

MVP: syntax compile checks only.

Future:

* detect forbidden globals
* detect obvious infinite loops
* detect `while(true)`
* detect references to unavailable `ctx` fields
* infer slot dependencies
* generate docs from slot usage

## 20.5 Should JSON.exe Support Non-JS Languages?

Not in MVP.

The architecture can eventually support other evaluators, but JavaScript is the native first target.

---

# 21. Reference Implementation Sketch

```ts
export function defineExtensionType(spec: ExtensionTypeSpec): ExtensionTypeSpec {
  return spec;
}

export async function compileExtension(
  spec: ExtensionTypeSpec,
  json: Record<string, unknown>,
  options: CompileOptions = {}
): Promise<CompiledExtension> {
  if (json.$kind !== spec.kind) {
    throw new KindMismatchError(spec.kind, String(json.$kind));
  }

  const compiledSlots = new Map<string, Function>();

  for (const [slotName, slotSpec] of Object.entries(spec.slots)) {
    const source = json[slotName];

    if (source == null) {
      if (slotSpec.required) {
        throw new MissingRequiredSlotError(slotName);
      }

      continue;
    }

    if (typeof source !== "string") {
      throw new SlotCompileError(slotName, "Slot source must be a string.");
    }

    try {
      const fn = slotSpec.async
        ? new Function("ctx", `"use strict"; return (async () => {\n${source}\n})();`)
        : new Function("ctx", `"use strict";\n${source}`);

      compiledSlots.set(slotName, fn);
    } catch (error) {
      throw new SlotCompileError(slotName, String(error));
    }
  }

  return {
    kind: spec.kind,
    id: typeof json.id === "string" ? json.id : undefined,

    has(slot: string) {
      return compiledSlots.has(slot);
    },

    slots() {
      return Array.from(compiledSlots.keys()).map((name) => ({
        name,
        compiled: true,
        required: Boolean(spec.slots[name]?.required)
      }));
    },

    async run(slot: string, ctx: unknown, runOptions: RunOptions = {}) {
      const fn = compiledSlots.get(slot);

      if (!fn) {
        throw new Error(`Slot not compiled: ${slot}`);
      }

      const startedAt = performance.now();

      try {
        const safeCtx = options.freezeContext ? deepFreeze(ctx) : ctx;

        const result = await fn(safeCtx);

        validateReturn(spec.slots[slot].returns, result);

        return result;
      } catch (error) {
        throw new SlotRuntimeError(slot, String(error));
      } finally {
        const durationMs = performance.now() - startedAt;

        if (runOptions.trace) {
          runOptions.trace.record({
            slot,
            durationMs
          });
        }
      }
    }
  };
}
```

---

# 22. Example Repository Layout

```txt
jsonexe/
  README.md
  SPEC.md
  package.json
  tsconfig.json

  packages/
    runtime/
      src/
        index.ts
        defineExtensionType.ts
        compileExtension.ts
        runSlot.ts
        errors.ts
        schema.ts
        trace.ts
      test/

    testing/
      src/
        index.ts
        testExtension.ts

    cli/
      src/
        index.ts
        commands/
          validate.ts
          run.ts
          test.ts
          check.ts

  examples/
    form-validator/
      spec.ts
      required-email.json
      strong-password.json

    data-transform/
      spec.ts
      normalize-user-row.json

    agent-policy/
      spec.ts
      source-first-research.json
```

---

# 23. Branding

Name:

```txt
JSON.exe
```

Package names:

```txt
jsonexe
@json-exe/runtime
@json-exe/testing
@json-exe/schema
@json-exe/agent
```

Taglines:

```txt
JSON that runs.

Executable JSON for plugins, agents, and extensions.

A universal scripting layer for host-defined extension types.

Context + Slots = Plugins.

Document the ctx. Document the slots. Let JSON.exe do the rest.
```

File naming conventions:

```txt
*.jsonexe.json
*.plugin.json
*.behavior.json
*.agent.json
```

Avoid using `.exe` as a literal file extension.

The product is named JSON.exe, but extension files should remain normal JSON.

---

# 24. Success Criteria

JSON.exe succeeds if:

1. A host app can define a new extension type in under 30 lines.
2. A user can write a useful extension as a single JSON object.
3. An LLM can generate valid extensions reliably from docs.
4. Failed slots can be repaired independently.
5. The runtime can trace every slot execution.
6. Return values are validated.
7. The same core runtime works for validators, transforms, UI actions, workflow steps, and agent policies.
8. The system avoids becoming a custom language.
9. Production deployments have a clear path to isolated execution.
10. The mental model remains simple:

```txt
JSON object + documented ctx + named JS slots = extension
```

---

# 25. Final Shape

JSON.exe is not a framework.

It is not a DSL.

It is not a plugin marketplace.

It is not a rules engine.

It is a tiny universal executable-object substrate:

```txt
Host defines extension type.
Extension provides JSON object.
Runtime compiles named JS fields.
Host executes slots with ctx.
Runtime validates and traces results.
```

That is the entire library.

Everything else is adapters, docs, examples, and safety.
