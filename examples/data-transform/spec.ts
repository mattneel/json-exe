import { defineExtensionType } from "@json-exe/runtime";

/**
 * data-transform/v1 — filter and reshape a single input row.
 */
export const dataTransform = defineExtensionType({
  kind: "data-transform/v1",
  version: "1.0.0",
  description: "Filter and reshape a single input row.",
  context: {
    row: "Record<string, unknown>",
    index: "number",
    helpers: "TransformHelpers",
  },
  staticFields: {
    id: { required: true, schema: { type: "string" } },
  },
  slots: {
    filter: {
      returns: { type: "boolean" },
      description: "Return true to keep the row.",
    },
    map: {
      required: true,
      returns: { type: "object" },
      description: "Return the transformed row.",
    },
    explain: {
      returns: { type: "string" },
      description: "Describe what this transform does.",
    },
  },
});

export default dataTransform;
