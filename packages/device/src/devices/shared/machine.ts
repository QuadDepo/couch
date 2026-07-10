import {
  type AnyActorRef,
  assign,
  type EventObject,
  type InputFrom,
  type MachineContext,
  type MetaObject,
  type NonReducibleUnknown,
  type ParameterizedObject,
  type StateMachine,
  type StateSchema,
  type StateValue,
  sendTo,
  setup,
  type UnknownActorLogic,
} from "xstate";
import type { TVPlatform } from "../../types";
import { logger } from "../../utils/logger";
import { isValidIp } from "../../utils/network";
import type { CommonDeviceEvent } from "../commonEvents";
import {
  CONNECTION_TIMEOUT,
  calculateRetryDelay,
  HEARTBEAT_INTERVAL,
  MAX_SESSION_RETRIES,
  PAIRING_CONNECT_TIMEOUT,
  PAIRING_USER_INPUT_TIMEOUT,
} from "../constants";

const PAIRING_TIMEOUT_ERROR =
  "Pairing timed out — make sure the TV is on and accepting connections";
const INVALID_STORED_CREDENTIALS_ERROR = "Stored credentials are invalid — pair again";

/** Context fields every device machine shares. */
export interface DeviceContextBase {
  deviceId: string | null;
  deviceName: string;
  deviceIp: string;
  retryCount: number;
  maxRetries: number;
  error?: string;
  promptReceived: boolean;
}

export type DeviceContext<TCredentials extends object, TExtraContext> = DeviceContextBase & {
  credentials?: TCredentials;
} & TExtraContext;

/** Events every device machine handles; platforms add their own on top. */
export type DeviceEventBase =
  | CommonDeviceEvent
  | { type: "SET_DEVICE_INFO"; name: string; ip: string }
  | { type: "START_PAIRING" }
  | { type: "RESET_TO_SETUP" }
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRING_ERROR"; error: string };

export type DeviceEvent<TPlatformEvent extends EventObject> = DeviceEventBase | TPlatformEvent;

export type DeviceProvidedActor<
  TPairing extends UnknownActorLogic,
  TSession extends UnknownActorLogic,
> =
  | { src: "pairingConnection"; logic: TPairing; id: string | undefined }
  | { src: "connectionManager"; logic: TSession; id: string | undefined };

/**
 * Public shape of a factory-built machine. Context, events, input, and actor
 * logics stay precise; state values and action/guard names are widened because
 * the state chart is assembled dynamically (machine tests cover its behavior).
 */
export type DeviceMachine<
  TContext extends MachineContext,
  TEvent extends EventObject,
  TInput,
  TPairing extends UnknownActorLogic,
  TSession extends UnknownActorLogic,
> = StateMachine<
  TContext,
  TEvent,
  Record<string, AnyActorRef | undefined>,
  DeviceProvidedActor<TPairing, TSession>,
  ParameterizedObject,
  ParameterizedObject,
  string,
  StateValue,
  string,
  TInput,
  NonReducibleUnknown,
  EventObject,
  MetaObject,
  StateSchema
>;

/**
 * Platform-supplied state/transition fragments are loosely typed on purpose:
 * they reference platform-specific actions and guards the factory cannot know
 * statically. Each platform's machine tests are the safety net here.
 */
export type DeviceStateFragment = Record<string, object>;
export type DeviceTransitionFragment = object;
// biome-ignore lint/suspicious/noExplicitAny: escape-hatch implementations are validated by each platform's machine tests
export type DeviceImplementationFragment = Record<string, any>;

export interface DeviceCredentialsConfig<
  TCredentials extends object,
  TContext,
  TPairedEvent extends EventObject,
> {
  /** Parses stored credentials in load mode; a throw surfaces as a pair-again error. */
  validate: (data: unknown) => TCredentials;
  /** Builds the stored credentials from the platform's PAIRED event. */
  fromPairedEvent: (event: TPairedEvent, context: TContext) => TCredentials;
  hasCredentials: (credentials: TCredentials | undefined) => boolean;
}

export interface DevicePairingHelpers {
  /** Absolute target of the machine's top-level error state. */
  errorTarget: string;
  /** Shared timeout escape: `after: { pairingUserInputTimeout: helpers.userInputTimeout }`. */
  userInputTimeout: DeviceTransitionFragment;
}

export interface DevicePairingConfig<TContext, TPairing extends UnknownActorLogic> {
  logic: TPairing;
  input: (context: TContext) => InputFrom<TPairing>;
  /** Invoke id, set when pairing sub-states need to sendTo the pairing actor. */
  invokeId?: string;
  /** Pairing sub-state entered when the actor reports PROMPT_RECEIVED. */
  promptTarget: string;
  /** Platform pairing sub-states (waitingForUser, waitingForPin, verifying, ...). */
  states: (helpers: DevicePairingHelpers) => DeviceStateFragment;
  /** Tried before the default PAIRING_ERROR -> error transition (e.g. webOS SSL retry). */
  errorTransitions?: readonly DeviceTransitionFragment[];
  /** Actions for START_PAIRING from the pairing error sub-state (default: clearError). */
  retryActions?: readonly string[];
  /** Absolute target used by START_PAIRING when retry must recreate the pairing actor. */
  retryTarget?: string;
  /** Absolute target used by pairing timeouts (default: the machine's top-level error). */
  timeoutErrorTarget?: string;
  /** Where setup and START_PAIRING enter pairing (android-tv ADB uses "instructions"). */
  entryTarget?: string;
  /** Actions on START_PAIRING from idle (default: a "Starting pairing" log). */
  startActions?: readonly (string | DeviceTransitionFragment)[];
  /** Sub-states alongside idle/active (android-tv ADB instructions flow). */
  extraStates?: (helpers: DevicePairingHelpers) => DeviceStateFragment;
}

export interface DeviceSessionConfig<TContext, TSession extends UnknownActorLogic> {
  logic: TSession;
  input: (context: TContext) => InputFrom<TSession>;
  /** Events forwarded verbatim to the session actor while connected. */
  forward?: readonly ("SEND_KEY" | "SEND_TEXT")[];
  /** Extra event handlers active while connected (e.g. webOS MUTE_STATE_CHANGED). */
  connectedOn?: DeviceStateFragment;
}

export interface DeviceMachineConfig<
  TCredentials extends object,
  TPlatformEvent extends EventObject,
  TExtraContext extends Record<string, unknown>,
  TPairing extends UnknownActorLogic,
  TSession extends UnknownActorLogic,
> {
  /** Machine id — also the anchor for absolute state targets. */
  id: string;
  /** Logger category, e.g. "Tizen". */
  logCategory: string;
  /** null for credential-less platforms (android-tv ADB): CONNECT is not guarded. */
  credentials: DeviceCredentialsConfig<
    TCredentials,
    DeviceContext<TCredentials, TExtraContext>,
    Extract<TPlatformEvent, { type: "PAIRED" }>
  > | null;
  /** Platform context fields beyond the shared base. */
  extraContext?: (credentials: TCredentials | undefined) => TExtraContext;
  /** Extra fields RESET_TO_SETUP resets (webOS useSsl, ADB instructionStep). */
  extraContextOnReset?: Partial<TExtraContext>;
  pairing: DevicePairingConfig<DeviceContext<TCredentials, TExtraContext>, TPairing>;
  session: DeviceSessionConfig<DeviceContext<TCredentials, TExtraContext>, TSession>;
  extraActions?: DeviceImplementationFragment;
  extraGuards?: DeviceImplementationFragment;
}

interface InternalLoadInput {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
  credentials?: unknown;
}

type InternalInput = { platform: TVPlatform } | InternalLoadInput;

function isLoadInput(input: InternalInput): input is InternalLoadInput {
  return "deviceId" in input && "deviceName" in input && "deviceIp" in input;
}

// Internal widened types: the machine is built against these, then cast to the
// precise public DeviceMachine type. Platform-specific context fields and event
// payloads only exist inside platform-supplied fragments and config callbacks.
interface InternalContext extends DeviceContextBase {
  credentials?: object;
}

type InternalEvent = DeviceEventBase | { type: "PAIRED" };

export function createDeviceMachine<
  TInput extends { platform: TVPlatform },
  TCredentials extends object,
  TPlatformEvent extends EventObject,
  TExtraContext extends Record<string, unknown> = Record<never, never>,
  TPairing extends UnknownActorLogic = UnknownActorLogic,
  TSession extends UnknownActorLogic = UnknownActorLogic,
>(
  config: DeviceMachineConfig<TCredentials, TPlatformEvent, TExtraContext, TPairing, TSession>,
): DeviceMachine<
  DeviceContext<TCredentials, TExtraContext>,
  DeviceEvent<TPlatformEvent>,
  TInput,
  TPairing,
  TSession
> {
  type PlatformContext = DeviceContext<TCredentials, TExtraContext>;
  type PairedEvent = Extract<TPlatformEvent, { type: "PAIRED" }>;

  const { credentials: credentialsConfig, pairing, session } = config;

  const errorTarget = `#${config.id}.error`;
  const timeoutErrorTarget = pairing.timeoutErrorTarget ?? errorTarget;
  const setPairingTimeoutError = {
    type: "setError" as const,
    params: { error: PAIRING_TIMEOUT_ERROR },
  };
  const helpers: DevicePairingHelpers = {
    errorTarget,
    userInputTimeout: { target: timeoutErrorTarget, actions: setPairingTimeoutError },
  };

  const extraContext = (credentials: TCredentials | undefined): Record<string, unknown> =>
    config.extraContext?.(credentials) ?? {};

  const pairingEntryTarget = pairing.entryTarget ?? "active";

  const startPairingLog = {
    type: "log" as const,
    params: ({ context }: { context: InternalContext }) => ({
      message: `Starting pairing for ${context.deviceName}`,
    }),
  };

  const pairedLog = {
    type: "log" as const,
    params: ({ context }: { context: InternalContext }) => ({
      message: `Pairing successful for ${context.deviceName}`,
    }),
  };

  const connectTransition = credentialsConfig
    ? { target: "session", guard: "hasCredentials" as const, actions: "resetRetry" as const }
    : { target: "session", actions: "resetRetry" as const };

  const forgetAndResetTransition = credentialsConfig
    ? { target: "pairing.idle", actions: ["clearCredentials", "resetRetry"] as const }
    : { target: "pairing.idle", actions: ["resetRetry"] as const };

  const connectedForwardOn = Object.fromEntries(
    (session.forward ?? ["SEND_KEY", "SEND_TEXT"]).map((eventType) => [
      eventType,
      { actions: sendTo("connectionManager", ({ event }: { event: InternalEvent }) => event) },
    ]),
  ) as Record<string, never>;

  const machine = setup({
    types: {
      context: {} as InternalContext,
      events: {} as InternalEvent,
      input: {} as InternalInput,
    },
    actors: {
      pairingConnection: pairing.logic,
      connectionManager: session.logic,
    },
    actions: {
      setDeviceInfo: assign({
        deviceName: (_, params: { name: string; ip: string }) => params.name,
        deviceIp: (_, params: { name: string; ip: string }) => params.ip,
        error: undefined,
      }),
      generateDeviceId: assign({
        deviceId: () => crypto.randomUUID(),
      }),
      setValidationError: assign({
        error: (_, params: { error: string }) => params.error,
      }),
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
      clearError: assign({
        error: undefined,
      }),
      setPromptReceived: assign({
        promptReceived: true,
      }),
      resetPromptReceived: assign({
        promptReceived: false,
      }),
      setCredentials: assign({
        credentials: ({ context, event }) =>
          credentialsConfig?.fromPairedEvent(
            event as unknown as PairedEvent,
            context as unknown as PlatformContext,
          ),
      }),
      clearCredentials: assign({
        credentials: undefined,
      }),
      resetDeviceInfo: assign({
        deviceId: null,
        deviceName: "",
        deviceIp: "",
        error: undefined,
        promptReceived: false,
        ...(config.extraContextOnReset as Record<string, never> | undefined),
      }),
      log: ({ context }, params: { message: string }) => {
        logger.info(config.logCategory, params.message, { ip: context.deviceIp });
      },
      ...config.extraActions,
    },
    guards: {
      isSetupMode: ({ context }) => context.deviceId === null,
      hasCredentials: ({ context }) =>
        credentialsConfig
          ? credentialsConfig.hasCredentials(context.credentials as TCredentials | undefined)
          : false,
      canRetry: ({ context }) => context.retryCount < context.maxRetries,
      hasValidDeviceInfo: (_, params: { name: string; ip: string }) =>
        params.name.trim().length > 0 && isValidIp(params.ip),
      missingDeviceName: (_, params: { name: string }) => params.name.trim().length === 0,
      hasInvalidIp: (_, params: { ip: string }) => !isValidIp(params.ip),
      ...config.extraGuards,
    },
    delays: {
      connectionTimeout: CONNECTION_TIMEOUT,
      retryDelay: ({ context }) => calculateRetryDelay(context.retryCount),
      heartbeatInterval: HEARTBEAT_INTERVAL,
      pairingConnectTimeout: PAIRING_CONNECT_TIMEOUT,
      pairingUserInputTimeout: PAIRING_USER_INPUT_TIMEOUT,
    },
  }).createMachine({
    id: config.id,
    initial: "initializing",
    context: ({ input }) => {
      if (!isLoadInput(input)) {
        return {
          deviceId: null,
          deviceName: "",
          deviceIp: "",
          ...(credentialsConfig ? { credentials: undefined } : {}),
          retryCount: 0,
          maxRetries: MAX_SESSION_RETRIES,
          promptReceived: false,
          ...extraContext(undefined),
        };
      }

      let credentials: TCredentials | undefined;
      let error: string | undefined;
      if (credentialsConfig && input.credentials) {
        try {
          credentials = credentialsConfig.validate(input.credentials);
        } catch (validationError) {
          logger.warn(
            config.logCategory,
            `Invalid stored credentials for device ${input.deviceId}: ${validationError}`,
          );
          credentials = undefined;
          error = INVALID_STORED_CREDENTIALS_ERROR;
        }
      }

      return {
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        deviceIp: input.deviceIp,
        ...(credentialsConfig ? { credentials, error } : {}),
        retryCount: 0,
        maxRetries: MAX_SESSION_RETRIES,
        promptReceived: false,
        ...extraContext(credentials),
      };
    },
    states: {
      initializing: {
        always: credentialsConfig
          ? [
              { guard: "isSetupMode", target: "setup" },
              { guard: "hasCredentials", target: "disconnected" },
              { target: "pairing.idle" },
            ]
          : [{ guard: "isSetupMode", target: "setup" }, { target: "disconnected" }],
      },
      setup: {
        on: {
          SET_DEVICE_INFO: [
            {
              guard: {
                type: "hasValidDeviceInfo",
                params: ({
                  event,
                }: {
                  event: { type: "SET_DEVICE_INFO"; name: string; ip: string };
                }) => ({
                  name: event.name,
                  ip: event.ip,
                }),
              },
              target: `pairing.${pairingEntryTarget}`,
              actions: [
                {
                  type: "setDeviceInfo",
                  params: ({
                    event,
                  }: {
                    event: { type: "SET_DEVICE_INFO"; name: string; ip: string };
                  }) => ({
                    name: event.name,
                    ip: event.ip,
                  }),
                },
                "generateDeviceId",
                startPairingLog,
              ],
            },
            {
              guard: {
                type: "missingDeviceName",
                params: ({
                  event,
                }: {
                  event: { type: "SET_DEVICE_INFO"; name: string; ip: string };
                }) => ({
                  name: event.name,
                }),
              },
              actions: {
                type: "setValidationError",
                params: { error: "Device name is required" },
              },
            },
            {
              guard: {
                type: "hasInvalidIp",
                params: ({
                  event,
                }: {
                  event: { type: "SET_DEVICE_INFO"; name: string; ip: string };
                }) => ({
                  ip: event.ip,
                }),
              },
              actions: {
                type: "setValidationError",
                params: { error: "Invalid IP address" },
              },
            },
          ],
          CANCEL: { target: "cancelled" },
        },
      },
      pairing: {
        initial: "idle",
        on: {
          RESET_TO_SETUP: {
            target: `#${config.id}.setup`,
            actions: "resetDeviceInfo",
          },
        },
        states: {
          idle: {
            on: {
              START_PAIRING: {
                target: pairingEntryTarget,
                actions: (pairing.startActions ?? [startPairingLog]) as never,
              },
            },
          },
          ...((pairing.extraStates?.(helpers) ?? {}) as Record<string, never>),
          active: {
            initial: "connecting",
            // Cast: generic actor logic keeps the invoke mapped type from reducing
            invoke: {
              ...(pairing.invokeId ? { id: pairing.invokeId } : {}),
              src: "pairingConnection",
              input: ({ context }: { context: InternalContext }) =>
                pairing.input(context as unknown as PlatformContext),
            } as never,
            on: {
              PAIRED: {
                target: `#${config.id}.disconnected`,
                actions: (credentialsConfig ? ["setCredentials", pairedLog] : [pairedLog]) as never,
              },
              PAIRING_ERROR: [
                ...((pairing.errorTransitions ?? []) as never[]),
                {
                  target: ".error",
                  actions: { type: "setError", params: ({ event }) => ({ error: event.error }) },
                },
              ],
            },
            states: {
              connecting: {
                on: {
                  PROMPT_RECEIVED: {
                    target: pairing.promptTarget,
                    actions: "setPromptReceived",
                  },
                },
                after: {
                  pairingConnectTimeout: {
                    target: timeoutErrorTarget,
                    actions: setPairingTimeoutError,
                  },
                },
              },
              ...(pairing.states(helpers) as Record<string, never>),
              error: {
                on: {
                  START_PAIRING: {
                    target: pairing.retryTarget ?? "connecting",
                    actions: (pairing.retryActions ?? ["clearError"]) as never,
                  },
                },
              },
            },
          },
        },
      },
      disconnected: {
        entry: {
          type: "log",
          params: ({ context }) => ({ message: `Disconnected from ${context.deviceName}` }),
        },
        on: {
          CONNECT: connectTransition,
          FORGET: credentialsConfig
            ? { target: "pairing.idle", actions: "clearCredentials" }
            : { target: "pairing.idle" },
        },
      },
      session: {
        type: "parallel",
        // Cast: generic actor logic keeps the invoke mapped type from reducing
        invoke: {
          id: "connectionManager",
          src: "connectionManager",
          input: ({ context }: { context: InternalContext }) =>
            session.input(context as unknown as PlatformContext),
        } as never,
        on: {
          DISCONNECT: { target: "disconnected", actions: "resetRetry" },
          CONNECTION_LOST: [
            {
              target: ".connection.retrying",
              guard: "canRetry",
              actions: [
                "incrementRetry",
                { type: "setError", params: ({ event }) => ({ error: event.error ?? "Unknown" }) },
              ],
            },
            {
              target: "error",
              actions: { type: "setError", params: { error: "Max retries exceeded" } },
            },
          ],
          HEARTBEAT_FAILED: [
            {
              target: ".connection.retrying",
              guard: "canRetry",
              actions: [
                "incrementRetry",
                { type: "setError", params: ({ event }) => ({ error: event.error }) },
              ],
            },
            {
              target: "error",
              actions: { type: "setError", params: { error: "Max retries exceeded" } },
            },
          ],
          FORGET: forgetAndResetTransition,
        },
        states: {
          connection: {
            initial: "connecting",
            states: {
              connecting: {
                entry: {
                  type: "log",
                  params: ({ context }) => ({ message: `Connecting to ${context.deviceName}` }),
                },
                on: {
                  CONNECTED: { target: "connected", actions: "resetRetry" },
                },
                after: {
                  connectionTimeout: [
                    {
                      target: "retrying",
                      guard: "canRetry",
                      actions: [
                        "incrementRetry",
                        { type: "setError", params: { error: "Connection timed out" } },
                      ],
                    },
                    {
                      target: errorTarget,
                      actions: { type: "setError", params: { error: "Connection timed out" } },
                    },
                  ],
                },
              },
              connected: {
                entry: {
                  type: "log",
                  params: ({ context }) => ({ message: `Connected to ${context.deviceName}` }),
                },
                on: {
                  ...connectedForwardOn,
                  ...((session.connectedOn ?? {}) as Record<string, never>),
                },
              },
              retrying: {
                entry: {
                  type: "log",
                  params: ({ context }) => ({
                    message: `Retrying connection (${context.retryCount}/${context.maxRetries})`,
                  }),
                },
                after: {
                  retryDelay: { target: `#${config.id}.session`, reenter: true },
                },
              },
            },
          },
          heartbeat: {
            initial: "waiting",
            states: {
              waiting: {
                on: {
                  CONNECTED: { target: "idle" },
                },
              },
              idle: {
                after: {
                  heartbeatInterval: { target: "checking" },
                },
              },
              checking: {
                entry: sendTo("connectionManager", { type: "CHECK_HEARTBEAT" }),
                on: {
                  HEARTBEAT_OK: { target: "idle" },
                  HEARTBEAT_FAILED: { target: "waiting" },
                },
              },
            },
          },
        },
      },
      error: {
        on: {
          CONNECT: connectTransition,
          DISCONNECT: { target: "disconnected", actions: "resetRetry" },
          FORGET: forgetAndResetTransition,
        },
      },
      cancelled: {
        type: "final",
      },
    },
  });

  return machine as unknown as DeviceMachine<
    DeviceContext<TCredentials, TExtraContext>,
    DeviceEvent<TPlatformEvent>,
    TInput,
    TPairing,
    TSession
  >;
}
