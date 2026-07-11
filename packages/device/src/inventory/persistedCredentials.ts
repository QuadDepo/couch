import * as v from "valibot";
import { AndroidTvRemoteCredentialsSchema } from "../devices/android-tv-remote/credentials";
import { WebOSCredentialsSchema } from "../devices/lg-webos/credentials";
import { PhilipsCredentialsSchema } from "../devices/philips-tv/credentials";
import { TizenCredentialsSchema } from "../devices/samsung-tizen/credentials";

// Persisted credentials reuse each vendor schema's field validation, but stay lenient about
// what is already on disk: unknown keys are preserved (looseObject) and vendor defaults are
// dropped, so a stored device file round-trips verbatim instead of being rewritten with
// injected default values (see the "without rewriting stored config" test).
type StripDefaults<TEntries extends v.ObjectEntries> = {
  [K in keyof TEntries]: TEntries[K] extends v.OptionalSchema<infer TWrapped, unknown>
    ? v.OptionalSchema<TWrapped, undefined>
    : TEntries[K];
};

function toPersistedSchema<TEntries extends v.ObjectEntries>(
  vendor: v.ObjectSchema<TEntries, undefined>,
): v.LooseObjectSchema<StripDefaults<TEntries>, undefined> {
  const entries: v.ObjectEntries = {};
  for (const [key, schema] of Object.entries(vendor.entries)) {
    entries[key] =
      schema.type === "optional"
        ? v.optional((schema as v.OptionalSchema<v.GenericSchema, unknown>).wrapped)
        : schema;
  }
  return v.looseObject(entries) as v.LooseObjectSchema<StripDefaults<TEntries>, undefined>;
}

const WEBOS_CREDENTIALS = toPersistedSchema(WebOSCredentialsSchema);
const ANDROID_REMOTE_CREDENTIALS = toPersistedSchema(AndroidTvRemoteCredentialsSchema);
const PHILIPS_CREDENTIALS = toPersistedSchema(PhilipsCredentialsSchema);
const TIZEN_CREDENTIALS = toPersistedSchema(TizenCredentialsSchema);

export type PersistedWebOSCredentials = v.InferOutput<typeof WEBOS_CREDENTIALS>;
export type PersistedAndroidRemoteCredentials = v.InferOutput<typeof ANDROID_REMOTE_CREDENTIALS>;
export type PersistedPhilipsCredentials = v.InferOutput<typeof PHILIPS_CREDENTIALS>;
export type PersistedTizenCredentials = v.InferOutput<typeof TIZEN_CREDENTIALS>;

export function parsePersistedWebOSCredentials(value: unknown): PersistedWebOSCredentials {
  return v.parse(WEBOS_CREDENTIALS, value);
}

export function parsePersistedAndroidRemoteCredentials(
  value: unknown,
): PersistedAndroidRemoteCredentials {
  return v.parse(ANDROID_REMOTE_CREDENTIALS, value);
}

export function parsePersistedPhilipsCredentials(value: unknown): PersistedPhilipsCredentials {
  return v.parse(PHILIPS_CREDENTIALS, value);
}

export function parsePersistedTizenCredentials(value: unknown): PersistedTizenCredentials {
  return v.parse(TIZEN_CREDENTIALS, value);
}
