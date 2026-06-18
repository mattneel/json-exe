import { defineExtensionType } from "@json-exe/runtime";

/**
 * agent-policy/v1 — a small policy that steers an agent loop.
 */
export const agentPolicy = defineExtensionType({
  kind: "agent-policy/v1",
  version: "1.0.0",
  description: "A small policy that steers an agent loop.",
  context: {
    input: "string",
    state: "Record<string, unknown>",
    messages: "Message[]",
    tools: "ToolRegistry",
    memory: "MemoryView",
    budget: "Budget",
    result: "unknown",
  },
  lifecycle: {
    order: [
      "state.init",
      "shouldUseTool",
      "toolCall",
      "afterTool",
      "shouldAnswer",
      "answerInstructions",
    ],
  },
  slots: {
    "state.init": { phase: "init", returns: { type: "object" } },
    shouldUseTool: { returns: { type: "boolean" } },
    toolCall: { returns: { type: "object", required: ["tool", "args"] } },
    afterTool: { returns: { type: "object" } },
    shouldAnswer: { returns: { type: "boolean" } },
    answerInstructions: { returns: { type: "string" } },
  },
});

export default agentPolicy;
