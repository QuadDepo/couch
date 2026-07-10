import type { DriverReceipt } from "../../drivers/types";
import type { WebOSConnection, WebOSRequestOptions } from "./connectionTypes";
import { URI_GET_AUDIO_STATUS, URI_SET_MUTE } from "./protocol";

export function createMuteState(connection: WebOSConnection, onChanged?: (mute: boolean) => void) {
  let current: boolean | undefined;
  let subscriptionStarted = false;
  let transition = Promise.resolve();

  function update(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const mute = (data as { mute?: unknown }).mute;
    if (typeof mute !== "boolean") return;
    current = mute;
    onChanged?.(mute);
  }

  return {
    async subscribe(): Promise<void> {
      if (subscriptionStarted) return;
      subscriptionStarted = true;
      try {
        await connection.subscribe(URI_GET_AUDIO_STATUS, {}, update);
      } catch {
        subscriptionStarted = false;
      }
    },
    toggle(options: WebOSRequestOptions): Promise<DriverReceipt> {
      const run = async (): Promise<DriverReceipt> => {
        if (current === undefined) {
          update(await connection.request(URI_GET_AUDIO_STATUS, {}, options));
        }
        const next = !(current ?? false);
        await connection.request(URI_SET_MUTE, { mute: next }, options);
        update({ mute: next });
        return { confirmation: "protocol-response" };
      };
      const queued = transition.then(run, run);
      transition = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    reset(): void {
      current = undefined;
      subscriptionStarted = false;
    },
  };
}
