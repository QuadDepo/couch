import type {
  DeviceDescriptor,
  DeviceInventory,
  OperationCapability,
  OperationKind,
} from "@couch/device";
import { cancelledFields, failedFields } from "../commandOutput";
import type { CommandError } from "../errors";
import { errorDetails, FAILURE_EXIT, UsageError } from "../errors";
import { parseOptions } from "../parseOptions";
import type { SignalControl } from "../processSignals";
import type { DeviceDoctorResult, DoctorCapability, ParsedDoctor } from "./types";

export function parseDoctor(args: readonly string[]): ParsedDoctor {
  const targetId = args[0];
  if (!targetId || targetId.startsWith("-")) {
    throw new UsageError("expected: couch device doctor <target>");
  }
  const { json } = parseOptions(args, 1);
  return { command: "device.doctor", targetId, json };
}

export async function runDoctor(
  command: ParsedDoctor,
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
): Promise<DeviceDoctorResult> {
  let target: DeviceDescriptor | undefined;
  try {
    const inventory = await getInventory();
    target = await inventory.getDevice(command.targetId, { signal: signals.signal });
    const capabilities = doctorCapabilities(
      command.targetId,
      await inventory.getCapabilities(command.targetId, { signal: signals.signal }),
    );
    if (signals.exitCode) return cancelledDoctor(command, signals, target);
    const scope = readinessScope(capabilities);
    const status = doctorStatus(capabilities, scope);
    const error = doctorError(command.targetId, capabilities, status);
    return {
      resultVersion: 1,
      command: "device.doctor",
      targetId: command.targetId,
      target,
      status,
      exitCode: status === "ready" ? 0 : FAILURE_EXIT,
      readinessScope: scope,
      capabilities,
      ...(error ? { error } : {}),
    };
  } catch (error) {
    if (signals.exitCode) return cancelledDoctor(command, signals, target);
    return {
      resultVersion: 1,
      command: "device.doctor",
      targetId: command.targetId,
      ...(target ? { target } : {}),
      readinessScope: "unknown",
      capabilities: [],
      ...failedFields(errorDetails(error)),
    };
  }
}

function doctorStatus(
  capabilities: readonly DoctorCapability[],
  scope: DeviceDoctorResult["readinessScope"],
): DeviceDoctorResult["status"] {
  const allReadyAndStable =
    capabilities.length > 0 &&
    capabilities.every((item) => item.readiness === "ready" && item.support === "stable");

  if (!allReadyAndStable) return "not-ready";
  if (scope === "configuration-only") return "unverified";
  return "ready";
}

function cancelledDoctor(
  command: ParsedDoctor,
  signals: SignalControl,
  target?: DeviceDescriptor,
): DeviceDoctorResult {
  return {
    resultVersion: 1,
    command: "device.doctor",
    targetId: command.targetId,
    ...(target ? { target } : {}),
    readinessScope: "unknown",
    capabilities: [],
    ...cancelledFields(signals),
  };
}

function doctorCapabilities(
  targetId: string,
  capabilities: ReadonlyMap<OperationKind, OperationCapability>,
): readonly DoctorCapability[] {
  return [...capabilities]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([kind, capability]) => ({
      kind,
      ...capability,
      remediation: remediationFor(targetId, capability),
    }));
}

function readinessScope(items: readonly DoctorCapability[]): DeviceDoctorResult["readinessScope"] {
  if (items.some((item) => item.constraints?.readinessCheck === "paired-configuration-only")) {
    return "configuration-only";
  }
  if (
    items.length > 0 &&
    items.every((item) => item.constraints?.readinessCheck === "live-adb-probe")
  ) {
    return "live";
  }
  return "unknown";
}

function doctorError(
  targetId: string,
  capabilities: readonly DoctorCapability[],
  status: DeviceDoctorResult["status"],
): CommandError | undefined {
  if (capabilities.length === 0) {
    return {
      code: "no-capabilities",
      message: "No executable capabilities were reported for this target",
    };
  }
  if (status === "unverified") {
    return {
      code: "live-readiness-unverified",
      message: `Live connectivity was not checked for ${targetId}`,
    };
  }
  if (status === "not-ready") {
    const unready = capabilities.filter(
      (item) => item.readiness !== "ready" || item.support !== "stable",
    );
    const detail = unready.map((item) => item.kind).join(", ");
    return {
      code: "target-not-ready",
      message: `Not ready for ${targetId}: ${detail}`,
    };
  }

  return undefined;
}

function remediationFor(targetId: string, capability: OperationCapability): string {
  if (capability.support === "unsupported")
    return "Choose a target and driver that support this operation.";
  if (capability.readiness === "missing-tool")
    return "Install the required device tool and ensure it is available on PATH, then rerun doctor.";
  if (capability.readiness === "unauthorized")
    return "Authorize this host on the device, then rerun doctor.";
  if (capability.readiness === "offline")
    return "Power on the device, confirm network reachability, then rerun doctor.";
  if (capability.readiness === "misconfigured")
    return "Update the device configuration or pairing credentials, then rerun doctor.";
  if (capability.constraints?.readinessCheck === "paired-configuration-only")
    return `Live connectivity was not checked; run \`couch remote press ${targetId} LEFT\` to verify control.`;
  if (capability.support === "experimental")
    return "Explicitly allow this experimental operation for the target before use.";
  return "None.";
}

function constraintText(constraints: DoctorCapability["constraints"]): string | undefined {
  if (!constraints) return undefined;
  return Object.entries(constraints)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

export function formatDoctorResult(result: DeviceDoctorResult): string {
  const lines = [`device.doctor ${result.targetId}: ${result.status}`];
  if (result.target)
    lines.push(
      `target\t${result.target.name}\t${result.target.platform}\t${result.target.driverId ?? "-"}\t${result.target.ip}`,
    );
  if (result.capabilities.length === 0) lines.push("No executable capabilities reported.");
  for (const capability of result.capabilities) {
    lines.push(`${capability.kind}\t${capability.support}\t${capability.readiness}`);
    if (capability.reason) lines.push(`  reason\t${capability.reason}`);
    const constraints = constraintText(capability.constraints);
    if (constraints) lines.push(`  constraints\t${constraints}`);
    lines.push(`  remediation\t${capability.remediation}`);
  }
  return `${lines.join("\n")}\n`;
}
