import type { PermissionSpec } from "./types";
import { PermissionError } from "./errors";

const MEMORY_RANK = { none: 0, read: 1, write: 2 } as const;

/**
 * Validate the permissions an extension *declares* (its `$permissions`) against
 * the permissions the host actually *grants*. Returns one
 * {@link PermissionError} per over-reach. This is the SPEC §9.6 check: "the host
 * must validate declared permissions against actual runtime grants."
 */
export function checkPermissions(
  declared: PermissionSpec | undefined,
  granted: PermissionSpec | undefined,
  extensionId?: string,
): PermissionError[] {
  if (!declared) return [];
  const grants = granted ?? {};
  const errors: PermissionError[] = [];

  if (declared.tools) {
    const grantedTools = new Set(grants.tools ?? []);
    for (const tool of declared.tools) {
      if (!grantedTools.has(tool)) {
        errors.push(
          new PermissionError(
            `Extension declares tool permission "${tool}" which the host did not grant.`,
            { permission: `tools.${tool}`, extensionId },
          ),
        );
      }
    }
  }

  if (declared.network === true && grants.network !== true) {
    errors.push(
      new PermissionError(
        "Extension declares network permission which the host did not grant.",
        { permission: "network", extensionId },
      ),
    );
  }

  if (declared.memory && declared.memory !== "none") {
    const need = MEMORY_RANK[declared.memory];
    const grantedMemory = (grants.memory ?? "none") as keyof typeof MEMORY_RANK;
    const have = MEMORY_RANK[grantedMemory] ?? 0;
    if (have < need) {
      errors.push(
        new PermissionError(
          `Extension declares memory permission "${declared.memory}" exceeding the host grant "${grants.memory ?? "none"}".`,
          { permission: `memory.${declared.memory}`, extensionId },
        ),
      );
    }
  }

  return errors;
}
