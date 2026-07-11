import type { DeviceInventory, OperationKind } from "@couch/device";

export async function preflight(
  inventory: DeviceInventory,
  deviceId: string,
  requires: readonly OperationKind[],
  allowExperimental: readonly OperationKind[],
  signal?: AbortSignal,
): Promise<void> {
  const capabilities = await inventory.getCapabilities(deviceId, { signal });
  for (const kind of new Set(requires)) {
    const capability = capabilities.get(kind);
    if (capability?.readiness !== "ready" || capability.support === "unsupported") {
      throw new Error(`${kind} is not ready for ${deviceId}`);
    }
    if (capability.support === "experimental" && !allowExperimental.includes(kind)) {
      throw new Error(`${kind} requires explicit target approval`);
    }
  }
}
