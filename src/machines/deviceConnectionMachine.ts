import { assign, fromPromise, setup } from "xstate";
import { getDeviceHandler } from "../devices/factory";
import type { TVDevice, TVPlatform } from "../types";
import { logger } from "../utils/logger";

interface ConnectionContext {
  deviceId: string;
  ip: string;
  platform: TVPlatform;
  retryCount: number;
  maxRetries: number;
  error?: string;
}

type ConnectionEvent =
  | { type: "CONNECT" }
  | { type: "DISCONNECT" }
  | { type: "RETRY" }
  | { type: "CONNECTION_LOST"; error?: string };

const connectToDevice = fromPromise<void, { device: TVDevice }>(async ({ input }) => {
  logger.info("Connection", `Connecting to ${input.device.platform}`, { ip: input.device.ip });
  const handler = getDeviceHandler(input.device);
  try {
    await handler.connect();
    logger.info("Connection", `Connected to ${input.device.platform}`, { ip: input.device.ip });
  } catch (error) {
    logger.error("Connection", `Failed to connect: ${error}`, { ip: input.device.ip });
    throw error;
  }
});

const disconnectFromDevice = fromPromise<void, { device: TVDevice }>(async ({ input }) => {
  logger.info("Connection", `Disconnecting from ${input.device.platform}`, { ip: input.device.ip });
  const handler = getDeviceHandler(input.device);
  await handler.disconnect();
  logger.info("Connection", `Disconnected from ${input.device.platform}`, { ip: input.device.ip });
});

export const deviceConnectionMachine = setup({
  types: {
    context: {} as ConnectionContext,
    events: {} as ConnectionEvent,
    input: {} as { deviceId: string; ip: string; platform: TVPlatform },
  },
  actors: {
    connectToDevice,
    disconnectFromDevice,
  },
  actions: {
    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1,
    }),
    resetRetry: assign({
      retryCount: 0,
      error: undefined,
    }),
    setError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
  },
  guards: {
    canRetry: ({ context }) => context.retryCount < context.maxRetries,
  },
  delays: {
    retryDelay: ({ context }) => Math.min(1000 * 2 ** context.retryCount, 8000),
  },
}).createMachine({
  id: "deviceConnection",
  initial: "disconnected",
  context: ({ input }) => ({
    deviceId: input.deviceId,
    ip: input.ip,
    platform: input.platform,
    retryCount: 0,
    maxRetries: 5,
  }),
  states: {
    disconnected: {
      on: {
        CONNECT: { target: "connecting", actions: "resetRetry" },
      },
    },
    connecting: {
      invoke: {
        src: "connectToDevice",
        input: ({ context }) => ({
          device: {
            id: context.deviceId,
            ip: context.ip,
            platform: context.platform,
            name: "",
            status: "disconnected",
          } as TVDevice,
        }),
        onDone: { target: "connected" },
        onError: [
          {
            target: "retrying",
            guard: "canRetry",
            actions: "incrementRetry",
          },
          {
            target: "error",
            actions: {
              type: "setError",
              params: { error: "Max retries exceeded" },
            },
          },
        ],
      },
    },
    connected: {
      on: {
        DISCONNECT: { target: "disconnecting" },
        CONNECTION_LOST: {
          target: "retrying",
          actions: ["incrementRetry"],
        },
      },
    },
    retrying: {
      after: {
        retryDelay: { target: "connecting" },
      },
      on: {
        DISCONNECT: { target: "disconnected", actions: "resetRetry" },
      },
    },
    disconnecting: {
      invoke: {
        src: "disconnectFromDevice",
        input: ({ context }) => ({
          device: {
            id: context.deviceId,
            ip: context.ip,
            platform: context.platform,
            name: "",
            status: "connected",
          } as TVDevice,
        }),
        onDone: { target: "disconnected", actions: "resetRetry" },
        onError: { target: "disconnected", actions: "resetRetry" },
      },
    },
    error: {
      on: {
        CONNECT: { target: "connecting", actions: "resetRetry" },
        DISCONNECT: { target: "disconnected", actions: "resetRetry" },
      },
    },
  },
});
