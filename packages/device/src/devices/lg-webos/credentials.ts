import * as v from "valibot";
import { MacAddressSchema } from "../shared/macAddress";

export const WebOSCredentialsSchema = v.object({
  clientKey: v.pipe(v.string(), v.minLength(1, "Client key cannot be empty")),
  mac: v.optional(v.union([MacAddressSchema, v.literal("")]), ""),
  useSsl: v.optional(v.boolean(), false),
  lastUpdated: v.optional(v.string(), new Date().toISOString()),
});

export type WebOSCredentials = v.InferOutput<typeof WebOSCredentialsSchema>;

export function validateWebOSCredentials(data: unknown): WebOSCredentials {
  return v.parse(WebOSCredentialsSchema, data);
}

export function createCredentials(params: {
  clientKey: string;
  mac?: string;
  useSsl?: boolean;
}): WebOSCredentials {
  return {
    clientKey: params.clientKey,
    mac: params.mac ?? "",
    useSsl: params.useSsl ?? false,
    lastUpdated: new Date().toISOString(),
  };
}
