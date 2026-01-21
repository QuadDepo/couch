import type { KeyMap } from "../types";
import type { RemoteCommand } from "./protocol";
import {
  REMOTE_COMMANDS,
  URI_TURN_OFF,
  URI_SET_MUTE,
  URI_VOLUME_UP,
  URI_VOLUME_DOWN,
  URI_CHANNEL_UP,
  URI_CHANNEL_DOWN,
  URI_PLAY,
  URI_PAUSE,
  URI_STOP,
  URI_REWIND,
  URI_FAST_FORWARD,
  URI_SWITCH_INPUT,
} from "./protocol";

// POWER sends turnOff signal; use Wake on LAN to turn on
const LUNA_KEYMAP: KeyMap = {
  POWER: URI_TURN_OFF,
  VOLUME_UP: URI_VOLUME_UP,
  VOLUME_DOWN: URI_VOLUME_DOWN,
  MUTE: URI_SET_MUTE,
  CHANNEL_UP: URI_CHANNEL_UP,
  CHANNEL_DOWN: URI_CHANNEL_DOWN,
  PLAY: URI_PLAY,
  PAUSE: URI_PAUSE,
  STOP: URI_STOP,
  REWIND: URI_REWIND,
  FAST_FORWARD: URI_FAST_FORWARD,
  INPUT: URI_SWITCH_INPUT,
};

// Navigation uses a separate WebSocket connection (input socket)
const INPUT_SOCKET_KEYMAP: Partial<Record<string, RemoteCommand>> = {
  UP: "UP",
  DOWN: "DOWN",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
  OK: "ENTER",
  ENTER: "ENTER",
  BACK: "BACK",
  HOME: "HOME",
  MENU: "MENU",
  EXIT: "EXIT",
  INFO: "INFO",
};

const KEYMAP: KeyMap = {
  ...LUNA_KEYMAP,
  ...Object.fromEntries(
    Object.entries(INPUT_SOCKET_KEYMAP).map(([key, command]) => [key, `INPUT:${command}`]),
  ),
};

export const keymap = KEYMAP;

export function isInputSocketKey(keyCode: string | number): boolean {
  return String(keyCode).startsWith("INPUT:");
}

export function getInputSocketCommand(keyCode: string | number): RemoteCommand {
  const str = String(keyCode);
  if (!str.startsWith("INPUT:")) {
    throw new Error(`Not an input socket key: ${keyCode}`);
  }
  const command = str.replace("INPUT:", "") as RemoteCommand;

  if (!REMOTE_COMMANDS.includes(command)) {
    throw new Error(`Unknown remote command: ${command}`);
  }

  return command;
}
