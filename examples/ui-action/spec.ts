import { defineExtensionType } from "@json-exe/runtime";

/**
 * ui-action/v1 — a contextual action shown in a UI.
 */
export const uiAction = defineExtensionType({
  kind: "ui-action/v1",
  version: "1.0.0",
  description: "A contextual action shown in a UI.",
  context: {
    user: "User",
    selection: "unknown[]",
    appState: "AppState",
    config: "Record<string, unknown>",
    actions: "ActionRegistry",
  },
  staticFields: {
    id: { required: true, schema: { type: "string" } },
  },
  slots: {
    visible: {
      returns: { type: "boolean" },
      description: "Should the action be shown?",
    },
    enabled: {
      returns: { type: "boolean" },
      description: "Should the action be enabled?",
    },
    label: {
      required: true,
      returns: { type: "string" },
      description: "The label to display.",
    },
    run: {
      required: true,
      async: true,
      returns: { type: "object" },
      phase: "run",
      description: "Perform the action and return a result object.",
    },
  },
});

export default uiAction;
