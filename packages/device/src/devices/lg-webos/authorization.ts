import { DeviceInventoryError } from "../../errors";

export function sanitizeWebosRequestError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission|unauthori[sz]ed|not authorized|access denied|forbidden|\b403\b/i.test(message)) {
    return new DeviceInventoryError(
      "WEBOS_AUTHORIZATION_REQUIRED",
      "LG webOS denied the operation; explicitly re-pair the TV outside the test before retrying.",
    );
  }
  return new DeviceInventoryError("WEBOS_REQUEST_FAILED", "LG webOS rejected the operation.");
}
