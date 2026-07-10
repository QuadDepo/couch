export function deviceLockResourceId(device: {
  id: string;
  platform: string;
  ip?: string;
}): string {
  if (device.platform === "android-tv") return `adb:${device.ip ?? device.id}:5555`;
  return `device:${device.id}`;
}
