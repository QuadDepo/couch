import * as v from "valibot";

export const AndroidTvRemoteCredentialsSchema = v.object({
  certificate: v.pipe(v.string(), v.minLength(1, "Certificate cannot be empty")),
  privateKey: v.pipe(v.string(), v.minLength(1, "Private key cannot be empty")),
  serverCertificate: v.pipe(v.string(), v.minLength(1, "Server certificate cannot be empty")),
  lastUpdated: v.optional(v.string(), new Date().toISOString()),
});

export type AndroidTvRemoteCredentials = v.InferOutput<typeof AndroidTvRemoteCredentialsSchema>;

export function validateAndroidTvRemoteCredentials(data: unknown): AndroidTvRemoteCredentials {
  return v.parse(AndroidTvRemoteCredentialsSchema, data);
}

export function createCredentials(params: {
  certificate: string;
  privateKey: string;
  serverCertificate: string;
}): AndroidTvRemoteCredentials {
  return {
    certificate: params.certificate,
    privateKey: params.privateKey,
    serverCertificate: params.serverCertificate,
    lastUpdated: new Date().toISOString(),
  };
}
