import type { OperationCapability, OperationKind, Readiness } from "./types";

// Why a single evaluator: the readiness + experimental-approval gate used to be
// reimplemented at every layer that guards an operation (session open, per-operation
// queueing, runner preflight). Sharing it keeps those sites in lockstep and lets each
// caller decide how to surface the blocker (throw a typed error vs. record a failure).

export type RequirementBlockReason = "missing" | "not-ready" | "unsupported" | "experimental";

export interface RequirementBlock {
  reason: RequirementBlockReason;
  // Populated only for `not-ready`; the specific readiness state to surface to the user.
  readiness?: Readiness;
  // Mirrors the legacy `experimental` flag: unapproved experimental support, independent of
  // readiness. A capability can be both not-ready and experimental-blocked at once.
  experimentalBlocked: boolean;
}

export function evaluateRequirement(
  capability: OperationCapability | undefined,
  kind: OperationKind,
  allowExperimental: readonly OperationKind[],
): RequirementBlock | undefined {
  const experimentalBlocked =
    capability?.support === "experimental" && !allowExperimental.includes(kind);

  if (!capability) return { reason: "missing", experimentalBlocked };

  if (capability.readiness !== "ready") {
    return { reason: "not-ready", readiness: capability.readiness, experimentalBlocked };
  }

  if (capability.support === "unsupported") return { reason: "unsupported", experimentalBlocked };

  if (experimentalBlocked) return { reason: "experimental", experimentalBlocked };

  return undefined;
}
