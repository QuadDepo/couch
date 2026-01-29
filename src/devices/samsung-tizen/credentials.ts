import * as v from "valibot";

const MacAddressSchema = v.pipe(
  v.string(),
  v.regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, "Invalid MAC address format"),
);

export const TizenCredentialsSchema = v.object({
  token: v.pipe(v.string(), v.minLength(1, "Token cannot be empty")),
  mac: v.optional(v.union([MacAddressSchema, v.literal("")]), ""),
});

export type TizenCredentials = v.InferOutput<typeof TizenCredentialsSchema>;

export function validateTizenCredentials(data: unknown): TizenCredentials {
  return v.parse(TizenCredentialsSchema, data);
}

export function createCredentials(params: { token: string; mac?: string }): TizenCredentials {
  return {
    token: params.token,
    mac: params.mac ?? "",
  };
}
