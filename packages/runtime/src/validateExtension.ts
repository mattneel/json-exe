/**
 * Shape validation (SPEC §10.1): does a JSON object conform to an extension
 * type? Checks `$kind`, required static fields and their schemas, required
 * slots, slot fields being strings, the unknown-slot policy, and declared
 * vs granted permissions. Does NOT compile slot source (that's `check` /
 * `compileExtension`).
 */
import type {
  CompileOptions,
  ExtensionJson,
  ExtensionTypeSpec,
  ValidationResult,
} from "./types";
import { RESERVED_FIELDS, STANDARD_METADATA_FIELDS } from "./types";
import {
  JsonExeError,
  KindMismatchError,
  MissingRequiredSlotError,
  ParseError,
  SlotCompileError,
  StaticFieldValidationError,
  UnknownSlotError,
} from "./errors";
import { validateAgainstSchema } from "./schema";
import { getSlotSource } from "./slots";
import { checkPermissions } from "./permissions";

/** Collect validation errors as live {@link JsonExeError} instances. */
export function collectExtensionErrors(
  spec: ExtensionTypeSpec,
  json: unknown,
  options: CompileOptions = {},
): JsonExeError[] {
  const errors: JsonExeError[] = [];

  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    errors.push(new ParseError("Extension must be a JSON object."));
    return errors;
  }

  const ext = json as ExtensionJson;
  const record = ext as Record<string, unknown>;
  const extId =
    typeof ext.$id === "string"
      ? ext.$id
      : typeof ext.id === "string"
        ? ext.id
        : undefined;

  // $kind
  if (ext.$kind !== spec.kind) {
    errors.push(
      new KindMismatchError(spec.kind, String(ext.$kind)).withExtensionId(extId),
    );
  }

  // static fields
  if (spec.staticFields) {
    for (const [field, fieldSpec] of Object.entries(spec.staticFields)) {
      const present =
        Object.prototype.hasOwnProperty.call(record, field) &&
        record[field] !== undefined;
      if (!present) {
        if (fieldSpec.required) {
          errors.push(
            new StaticFieldValidationError(
              field,
              "required",
              "missing",
              `Required static field "${field}" is missing.`,
              { extensionId: extId },
            ),
          );
        }
        continue;
      }
      const check = validateAgainstSchema(fieldSpec.schema, record[field]);
      if (!check.ok) {
        errors.push(
          new StaticFieldValidationError(
            field,
            check.expected,
            check.received,
            `Static field "${field}" failed validation: ${check.message ?? "invalid value"}`,
            { extensionId: extId },
          ),
        );
      }
    }
  }

  // declared slots
  for (const [slotName, slotSpec] of Object.entries(spec.slots)) {
    const source = getSlotSource(ext, slotName);
    if (source === undefined) {
      if (slotSpec.required) {
        errors.push(
          new MissingRequiredSlotError(slotName).withExtensionId(extId),
        );
      }
      continue;
    }
    if (typeof source !== "string") {
      errors.push(
        new SlotCompileError(slotName, "Slot source must be a string.", {
          extensionId: extId,
        }),
      );
    }
  }

  // unknown-slot policy
  const policy = options.unknownSlots ?? spec.unknownSlots ?? "ignore";
  if (policy === "error") {
    const declaredSlots = new Set(Object.keys(spec.slots));
    const declaredStatic = new Set(Object.keys(spec.staticFields ?? {}));
    const allowed = new Set<string>([
      ...RESERVED_FIELDS,
      ...STANDARD_METADATA_FIELDS,
    ]);
    for (const key of Object.keys(record)) {
      if (key.startsWith("$")) continue;
      if (
        allowed.has(key) ||
        declaredSlots.has(key) ||
        declaredStatic.has(key)
      ) {
        continue;
      }
      // Allow a nested-object container for dotted slots (e.g. "state" for "state.init").
      const isContainer = [...declaredSlots].some((s) =>
        s.startsWith(`${key}.`),
      );
      if (isContainer) continue;
      const value = record[key];
      if (typeof value === "string") {
        errors.push(new UnknownSlotError(key).withExtensionId(extId));
      }
    }
  }

  // declared vs granted permissions — enforced when the host supplies grants
  // or explicitly opts in (a missing grant is then treated as deny-all).
  if (
    ext.$permissions &&
    (options.grantedPermissions !== undefined || options.enforcePermissions)
  ) {
    for (const err of checkPermissions(
      ext.$permissions,
      options.grantedPermissions ?? {},
      extId,
    )) {
      errors.push(err);
    }
  }

  return errors;
}

export function validateExtension(
  spec: ExtensionTypeSpec,
  json: unknown,
  options: CompileOptions = {},
): ValidationResult {
  const errors = collectExtensionErrors(spec, json, options);
  return { ok: errors.length === 0, errors: errors.map((e) => e.toJSON()) };
}
