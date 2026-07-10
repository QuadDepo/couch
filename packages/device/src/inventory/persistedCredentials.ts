import * as v from "valibot";
import { validateAndroidTvRemoteCredentials } from "../devices/android-tv-remote/credentials";
import { validateWebOSCredentials } from "../devices/lg-webos/credentials";
import { validatePhilipsCredentials } from "../devices/philips-tv/credentials";
import { validateTizenCredentials } from "../devices/samsung-tizen/credentials";

const WEBOS_CREDENTIALS = v.looseObject({
  clientKey: v.string(),
  mac: v.optional(v.string()),
  useSsl: v.optional(v.boolean()),
  lastUpdated: v.optional(v.string()),
});
const ANDROID_REMOTE_CREDENTIALS = v.looseObject({
  certificate: v.string(),
  privateKey: v.string(),
  serverCertificate: v.string(),
  lastUpdated: v.optional(v.string()),
});
const PHILIPS_CREDENTIALS = v.looseObject({
  deviceId: v.string(),
  authKey: v.string(),
});
const TIZEN_CREDENTIALS = v.looseObject({
  token: v.string(),
  mac: v.optional(v.string()),
});

export type PersistedWebOSCredentials = v.InferOutput<typeof WEBOS_CREDENTIALS>;
export type PersistedAndroidRemoteCredentials = v.InferOutput<typeof ANDROID_REMOTE_CREDENTIALS>;
export type PersistedPhilipsCredentials = v.InferOutput<typeof PHILIPS_CREDENTIALS>;
export type PersistedTizenCredentials = v.InferOutput<typeof TIZEN_CREDENTIALS>;

export function parsePersistedWebOSCredentials(value: unknown): PersistedWebOSCredentials {
  validateWebOSCredentials(value);
  return v.parse(WEBOS_CREDENTIALS, value);
}

export function parsePersistedAndroidRemoteCredentials(
  value: unknown,
): PersistedAndroidRemoteCredentials {
  validateAndroidTvRemoteCredentials(value);
  return v.parse(ANDROID_REMOTE_CREDENTIALS, value);
}

export function parsePersistedPhilipsCredentials(value: unknown): PersistedPhilipsCredentials {
  validatePhilipsCredentials(value);
  return v.parse(PHILIPS_CREDENTIALS, value);
}

export function parsePersistedTizenCredentials(value: unknown): PersistedTizenCredentials {
  validateTizenCredentials(value);
  return v.parse(TIZEN_CREDENTIALS, value);
}
