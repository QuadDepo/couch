import { describe, expect, test } from "bun:test";
import type { WebOSRequestMessage } from "./connectionTypes";
import { createRequestChannel } from "./requestChannel";

function channel() {
  const sent: WebOSRequestMessage[] = [];
  const events: string[] = [];
  const value = createRequestChannel({
    ip: "192.168.1.20",
    mac: "",
    timeout: 100,
    getClientKey: () => "client-key",
    setClientKey: () => undefined,
    send: (message) => sent.push(message),
    emit: (event) => events.push(event),
  });
  return { value, sent, events };
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
});
