import { atomicWrite } from "../../utils/atomicWrite";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export async function downloadWebosCapture(
  imageUri: string,
  outputPath: string,
  tvHost: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    fetch?: typeof fetch;
  } = {},
): Promise<number> {
  let url: URL;
  try {
    url = new URL(imageUri);
  } catch {
    throw new Error("LG webOS returned an invalid capture URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("LG webOS returned an unsafe capture URL");
  }
  if (url.hostname !== tvHost) {
    throw new Error("LG webOS capture URL host does not match the TV");
  }

  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const request: BunFetchRequestInit = {
    redirect: "error",
    signal,
    ...(url.protocol === "https:" ? { tls: { rejectUnauthorized: false } } : {}),
  };
  const response = await (options.fetch ?? fetch)(url, request).catch((error) => {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    if (timeout.aborted) throw new Error("LG webOS capture download timed out");
    throw new Error("LG webOS capture download failed");
  });
  if (!response.ok)
    throw new Error(`LG webOS capture download failed with HTTP ${response.status}`);

  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType && mimeType !== "image/jpeg") {
    throw new Error("LG webOS capture response is not a JPEG");
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("LG webOS capture exceeds the byte limit");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("LG webOS capture response has no body");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new Error("LG webOS capture exceeds the byte limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    if (timeout.aborted) throw new Error("LG webOS capture download timed out");
    throw error;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (
    byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[byteLength - 2] !== 0xff ||
    bytes[byteLength - 1] !== 0xd9
  ) {
    throw new Error("LG webOS capture has an invalid JPEG signature");
  }

  signal.throwIfAborted();
  await atomicWrite(outputPath, bytes, { signal });
  return byteLength;
}
