const ADB_TCP_PORT = 5555;

// Single source of truth for cross-process lock keys. ADB serializes access per host:port
// (one adb server per device endpoint), so Android contention is keyed by ip:port, not by
// Couch's device id — two devices behind the same endpoint must not run ADB concurrently.
// Every other transport locks per Couch device id.
export function deviceLockResourceId(device: {
  id: string;
  platform: string;
  ip?: string;
}): string {
  if (device.platform === "android-tv") return `adb:${device.ip ?? device.id}:${ADB_TCP_PORT}`;
  return `device:${device.id}`;
}
