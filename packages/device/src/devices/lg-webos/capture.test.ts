import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadWebosCapture } from "./capture";

const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);

function response(body: BodyInit = jpeg, headers: Record<string, string> = {}) {
  return new Response(body, {
    headers: { "content-type": "image/jpeg", ...headers },
  });
}

describe("LG webOS capture download", () => {
  test("publishes a validated JPEG atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-webos-capture-"));
    const path = join(directory, "capture.jpg");

    const length = await downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
      fetch: async () => response(),
    });

    expect(length).toBe(jpeg.byteLength);
    expect(new Uint8Array(await readFile(path))).toEqual(jpeg);
    expect(await readdir(directory)).toEqual(["capture.jpg"]);
  });

  test("rejects unsafe hosts, MIME types, signatures, and oversized bodies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-webos-capture-"));
    const path = join(directory, "capture.jpg");

    await expect(
      downloadWebosCapture("http://example.com/capture.jpg", path, "192.0.2.20"),
    ).rejects.toThrow("host does not match");
    await expect(downloadWebosCapture("file:///capture.jpg", path, "192.0.2.20")).rejects.toThrow(
      "unsafe capture URL",
    );
    await expect(
      downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
        fetch: async () => response(jpeg, { "content-type": "text/plain" }),
      }),
    ).rejects.toThrow("not a JPEG");
    await expect(
      downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
        fetch: async () => response(new Uint8Array([1, 2, 3, 4])),
      }),
    ).rejects.toThrow("invalid JPEG signature");
    await expect(
      downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
        maxBytes: 5,
        fetch: async () => response(),
      }),
    ).rejects.toThrow("byte limit");
    expect(await readdir(directory)).toEqual([]);
  });

  test("caller cancellation wins and publishes nothing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-webos-capture-"));
    const path = join(directory, "capture.jpg");
    const controller = new AbortController();
    const reason = new Error("interrupted");
    const pending = downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
      signal: controller.signal,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          }),
        ),
    });

    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(await readdir(directory)).toEqual([]);
  });

  test("download timeout publishes nothing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-webos-capture-"));
    const path = join(directory, "capture.jpg");

    await expect(
      downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
        timeoutMs: 1,
        fetch: (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            }),
          ),
      }),
    ).rejects.toThrow("timed out");
    expect(await readdir(directory)).toEqual([]);
  });

  test("rejects redirects and oversized declared content before reading", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-webos-capture-"));
    const path = join(directory, "capture.jpg");
    await expect(
      downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
        fetch: async (_url, init) => {
          expect(init?.redirect).toBe("error");
          throw new TypeError("redirect mode is set to error");
        },
      }),
    ).rejects.toThrow("capture download failed");
    await expect(
      downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
        maxBytes: 5,
        fetch: async () => response(jpeg, { "content-length": "6" }),
      }),
    ).rejects.toThrow("byte limit");
    expect(await readdir(directory)).toEqual([]);
  });

  test("accepts the TV's locally issued HTTPS capture certificate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-webos-capture-"));
    const path = join(directory, "capture.jpg");
    let rejectUnauthorized: boolean | undefined;

    await downloadWebosCapture("https://192.0.2.20:3001/capture.jpg", path, "192.0.2.20", {
      fetch: async (_url, init) => {
        rejectUnauthorized = (init as RequestInit & { tls?: { rejectUnauthorized?: boolean } }).tls
          ?.rejectUnauthorized;
        return response();
      },
    });

    expect(rejectUnauthorized).toBe(false);
  });

  test("accepts a signature-valid JPEG when the TV omits Content-Type", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-webos-capture-"));
    const path = join(directory, "capture.jpg");

    await downloadWebosCapture("http://192.0.2.20/capture.jpg", path, "192.0.2.20", {
      fetch: async () => new Response(jpeg),
    });

    expect(new Uint8Array(await readFile(path))).toEqual(jpeg);
  });
});
