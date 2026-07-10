import type {
  DeviceDescriptor,
  DeviceInventory,
  OperationCapability,
  OperationKind,
} from "@couch/device";
import { errorDetails, FAILURE_EXIT, UsageError } from "../errors";
import type { SignalControl } from "../processSignals";
import type { DeviceDoctorResult, DoctorCapability, ParsedDoctor } from "./types";

export function parseDoctor(args: readonly string[]): ParsedDoctor {
  const targetId = args[0];
  if (!targetId || targetId.startsWith("-")) {
    throw new UsageError("expected: couch device doctor <target>");
  }
  let json = false;
  for (const argument of args.slice(1)) {
    if (argument === "--json" && !json) {
      json = true;
      continue;
    }
    if (argument === "--json") throw new UsageError("--json may only be specified once");
    throw new UsageError(`unknown option: ${argument}`);
  }
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
    const stable =
      capabilities.length > 0 &&
      capabilities.every((item) => item.readiness === "ready" && item.support === "stable");
    const scope = readinessScope(capabilities);
    const status = !stable ? "not-ready" : scope === "configuration-only" ? "unverified" : "ready";
    const error = doctorError(command.targetId, capabilities.length, status);
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
      status: "failed",
      exitCode: FAILURE_EXIT,
      readinessScope: "unknown",
      capabilities: [],
      error: errorDetails(error),
    };
  }
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
    status: "cancelled",
    exitCode: signals.exitCode ?? 130,
    readinessScope: "unknown",
    capabilities: [],
    error: { code: "cancelled", message: signals.message ?? "Interrupted" },
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

function doctorError(targetId: string, count: number, status: DeviceDoctorResult["status"]) {
  if (count === 0) {
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
    return {
      code: "target-not-ready",
      message: `One or more capabilities are not ready for ${targetId}`,
    };
  }
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

export function humanDoctor(result: DeviceDoctorResult): string {
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
