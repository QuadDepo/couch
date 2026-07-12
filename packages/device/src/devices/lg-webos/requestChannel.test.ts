import { describe, expect, test } from "bun:test";
import type { WebOSRequestMessage } from "./connectionTypes";
import { createRequestChannel, formatWebosRequestLog } from "./requestChannel";

function channel() {
  const sent: WebOSRequestMessage[] = [];
  const events: string[] = [];
  const clientKeys: string[] = [];
  const value = createRequestChannel({
    ip: "192.168.1.20",
    mac: "",
    timeout: 100,
    getClientKey: () => "client-key",
    setClientKey: (clientKey) => clientKeys.push(clientKey),
    send: (message) => sent.push(message),
    emit: (event) => events.push(event),
  });
  return { value, sent, events, clientKeys };
}

describe("webOS request channel", () => {
  test("routes successful responses to their pending request", async () => {
    const { value, sent } = channel();
    const result = value.request<{ returnValue: boolean; volume: number }>(
      "ssap://audio/getVolume",
    );
    const request = sent[0];
    expect(request?.type).toBe("request");

    value.handleMessage(
      JSON.stringify({
        id: request?.id,
        type: "response",
        payload: { returnValue: true, volume: 12 },
      }),
    );

    await expect(result).resolves.toEqual({ returnValue: true, volume: 12 });
  });

  test("removes an aborted request", async () => {
    const { value, sent } = channel();
    const controller = new AbortController();
    const result = value.request("ssap://audio/getVolume", {}, { signal: controller.signal });
    controller.abort(new Error("request cancelled"));

    await expect(result).rejects.toThrow("request cancelled");
    value.handleMessage(
      JSON.stringify({
        id: sent[0]?.id,
        type: "response",
        payload: { returnValue: true },
      }),
    );
  });

  test("routes subscription payloads independently from requests", async () => {
    const { value, sent } = channel();
    const payloads: unknown[] = [];
    await value.subscribe("ssap://audio/getStatus", {}, (payload) => payloads.push(payload));

    value.handleMessage(
      JSON.stringify({
        id: sent[0]?.id,
        type: "response",
        payload: { returnValue: true, mute: false },
      }),
    );

    expect(payloads).toEqual([{ returnValue: true, mute: false }]);
  });

  test("clears subscription callbacks when the transport tears down", async () => {
    const { value, sent } = channel();
    const payloads: unknown[] = [];
    await value.subscribe("ssap://audio/getStatus", {}, (payload) => payloads.push(payload));
    const subscription = sent[0];

    value.reset(new Error("transport closed"));
    value.handleMessage(
      JSON.stringify({
        id: subscription?.id,
        type: "response",
        payload: { returnValue: true, mute: true },
      }),
    );

    expect(payloads).toEqual([]);
  });

  test("keeps subscriptions after rejecting pending requests for a malformed frame", async () => {
    const { value, sent } = channel();
    const payloads: unknown[] = [];
    await value.subscribe("ssap://audio/getStatus", {}, (payload) => payloads.push(payload));
    const subscription = sent[0];
    const request = value.request("ssap://audio/getVolume");

    value.handleMessage("not json");
    await expect(request).rejects.toMatchObject({ code: "WEBOS_INVALID_RESPONSE" });
    value.handleMessage(
      JSON.stringify({
        id: subscription?.id,
        type: "response",
        payload: { returnValue: true, mute: true },
      }),
    );

    expect(payloads).toEqual([{ returnValue: true, mute: true }]);
  });

  test("sanitizes permission failures before rejecting the request", async () => {
    const { value, sent } = channel();
    const result = value.request("ssap://tv/executeOneShot");
    value.handleMessage(
      JSON.stringify({
        id: sent[0]?.id,
        type: "response",
        payload: {
          returnValue: false,
          errorCode: "403",
          errorText: "permission denied for ssap://secret?client-key=raw",
        },
      }),
    );

    await expect(result).rejects.toMatchObject({
      code: "WEBOS_AUTHORIZATION_REQUIRED",
      message:
        "LG webOS denied the operation; explicitly re-pair the TV outside the test before retrying.",
    });
  });

  test("preserves authorization classification for protocol error envelopes", async () => {
    const { value, sent } = channel();
    const result = value.register();
    value.handleMessage(
      JSON.stringify({
        id: sent[0]?.id,
        type: "error",
        error: "403 denied for ssap://secret?client-key=raw-pairing-material",
      }),
    );

    const error = await result.catch((caught) => caught);
    expect(error).toMatchObject({
      code: "WEBOS_AUTHORIZATION_REQUIRED",
      message:
        "LG webOS denied the operation; explicitly re-pair the TV outside the test before retrying.",
    });
    expect(JSON.stringify(error)).not.toMatch(/secret|client-key|pairing-material|ssap:/);
  });

  test.each([
    null,
    42,
    "response",
    [],
    {},
    { id: "request" },
    { type: "response" },
  ])("rejects malformed envelopes without throwing: %p", async (message) => {
    const { value } = channel();
    const result = value.request("ssap://audio/getVolume");

    expect(() => value.handleMessage(JSON.stringify(message))).not.toThrow();
    await expect(result).rejects.toMatchObject({
      code: "WEBOS_INVALID_RESPONSE",
      message: "LG webOS returned an invalid protocol response.",
    });
  });

  test("redacts non-authorization failures from errors and events", async () => {
    const { value, sent, events } = channel();
    const result = value.request("ssap://tv/executeOneShot");
    value.handleMessage(
      JSON.stringify({
        id: sent[0]?.id,
        type: "response",
        payload: {
          returnValue: false,
          errorCode: "FIRMWARE_9001",
          errorText: "failed at ssap://capture?token=secret&client-key=raw-pairing-material",
        },
      }),
    );

    const error = await result.catch((caught) => caught);
    expect(error).toMatchObject({
      code: "WEBOS_REQUEST_FAILED",
      message: "LG webOS rejected the operation.",
    });
    expect(JSON.stringify(error)).not.toMatch(/secret|client-key|pairing|ssap:/);
    expect(events).not.toContain("message");
  });

  test.each([undefined, "", "   "])("rejects invalid registration client keys: %p", async (key) => {
    const { value, sent, events, clientKeys } = channel();
    const registration = value.register();
    value.handleMessage(
      JSON.stringify({
        id: sent[0]?.id,
        type: "registered",
        payload: key === undefined ? {} : { "client-key": key },
      }),
    );

    await expect(registration).rejects.toMatchObject({ code: "WEBOS_INVALID_RESPONSE" });
    expect(clientKeys).toEqual([]);
    expect(events).not.toContain("connect");
  });

  test("rejects when a response parser rejects a malformed payload", async () => {
    const { value, sent } = channel();
    const result = value.request("ssap://pointer", {}, {}, () => {
      throw new Error("Malformed pointer payload");
    });

    expect(() =>
      value.handleMessage(
        JSON.stringify({
          id: sent[0]?.id,
          type: "response",
          payload: { returnValue: true },
        }),
      ),
    ).not.toThrow();
    await expect(result).rejects.toThrow("Malformed pointer payload");
  });

  test("logs only outgoing envelope metadata", async () => {
    const logged = formatWebosRequestLog({
      type: "request",
      id: "request-id",
      uri: "ssap://system.launcher/launch",
      payload: {
        id: "app",
        params: { token: "secret", "client-key": "pairing-material" },
      },
    });

    expect(logged).toContain("type=request");
    expect(logged).toContain("ssap://system.launcher/launch");
    expect(logged).not.toMatch(/secret|client-key|pairing-material/);
  });
});
