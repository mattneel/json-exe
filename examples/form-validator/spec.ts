import { defineExtensionType } from "@json-exe/runtime";

/**
 * form-validator/v1 — validation logic for a single form field.
 */
export const formValidator = defineExtensionType({
  kind: "form-validator/v1",
  version: "1.0.0",
  description: "Validation logic for a single form field.",
  context: {
    value: "unknown",
    field: "Field",
    form: "Record<string, unknown>",
    user: "User | null",
  },
  staticFields: {
    id: { required: true, schema: { type: "string" } },
  },
  slots: {
    validate: {
      required: true,
      returns: { type: "boolean" },
      timeoutMs: 50,
      description: "Return true when the field value is valid.",
    },
    message: {
      returns: { type: "string" },
      description: "Return the message shown when validation fails.",
    },
    severity: {
      returns: { enum: ["info", "warning", "error"] },
      description: "Return the severity of a failed validation.",
    },
  },
});

export default formValidator;
