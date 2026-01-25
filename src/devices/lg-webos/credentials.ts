import * as v from "valibot";

const MacAddressSchema = v.pipe(
  v.string(),
  v.regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, "Invalid MAC address format"),
);

export const WebOSCredentialsSchema = v.object({
  clientKey: v.pipe(v.string(), v.minLength(1, "Client key cannot be empty")),
  mac: v.optional(v.union([MacAddressSchema, v.literal("")]), ""),
  lastUpdated: v.optional(v.string(), new Date().toISOString()),
});

export type WebOSCredentials = v.InferOutput<typeof WebOSCredentialsSchema>;

export function validateWebOSCredentials(data: unknown): WebOSCredentials {
  return v.parse(WebOSCredentialsSchema, data);
}

export function createCredentials(params: { clientKey: string; mac?: string }): WebOSCredentials {
  return {
    clientKey: params.clientKey,
    mac: params.mac ?? "",
    lastUpdated: new Date().toISOString(),
  };
}
