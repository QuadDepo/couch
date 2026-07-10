import * as v from "valibot";

export const PhilipsCredentialsSchema = v.object({
  deviceId: v.pipe(v.string(), v.minLength(1, "Device ID cannot be empty")),
  authKey: v.pipe(v.string(), v.minLength(1, "Auth key cannot be empty")),
});

export type PhilipsCredentials = v.InferOutput<typeof PhilipsCredentialsSchema>;

export function validatePhilipsCredentials(data: unknown): PhilipsCredentials {
  return v.parse(PhilipsCredentialsSchema, data);
}
