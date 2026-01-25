import { mkdirSync } from "fs";
import { homedir } from "os";
import path from "path";

export const WEBSOCKET_PORT = 3000;
export const WEBSOCKET_SSL_PORT = 3001;

export const URI_TURN_OFF = "ssap://system/turnOff";
export const URI_SET_MUTE = "ssap://audio/setMute";
export const URI_VOLUME_UP = "ssap://audio/volumeUp";
export const URI_VOLUME_DOWN = "ssap://audio/volumeDown";
export const URI_CHANNEL_UP = "ssap://tv/channelUp";
export const URI_CHANNEL_DOWN = "ssap://tv/channelDown";
export const URI_PLAY = "ssap://media.controls/play";
export const URI_PAUSE = "ssap://media.controls/pause";
export const URI_STOP = "ssap://media.controls/stop";
export const URI_REWIND = "ssap://media.controls/rewind";
export const URI_FAST_FORWARD = "ssap://media.controls/fastForward";
export const URI_SWITCH_INPUT = "ssap://tv/switchInput";
export const URI_POINTER_INPUT = "ssap://com.webos.service.networkinput/getPointerInputSocket";
export const URI_INSERT_TEXT = "ssap://com.webos.service.ime/insertText";

// TODO: Additional URIs for future implementation
// Reference: https://github.com/merdok/homebridge-webos-tv

// Full list: https://github.com/merdok/homebridge-webos-tv/blob/master/lib/LgTvController.js
export const REMOTE_COMMANDS = [
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "ENTER",
  "BACK",
  "HOME",
  "MENU",
  "EXIT",
  "INFO",
] as const;

export type RemoteCommand = (typeof REMOTE_COMMANDS)[number];

type MessageType = "register" | "request" | "subscribe";

interface WebOSMessage<T = object> {
  id: string;
  type: MessageType;
  uri?: string;
  payload?: T;
}

interface WebOSResponse<T = object> {
  id: string;
  type: "registered" | "response" | "purchased";
  payload?: T;
  "client-key"?: string;
}

// Do not modify - RSA-SHA256 signature is tied to exact content of "signed" section
// Reference: https://github.com/AdrienGiboire/lgtv2
export const PAIRING_MANIFEST = {
  forcePairing: false,
  pairingType: "PROMPT",
  manifest: {
    manifestVersion: 1,
    appVersion: "1.1",
    signed: {
      created: "20140509",
      appId: "com.lge.test",
      vendorId: "com.lge",
      localizedAppNames: {
        "": "LG Remote App",
        "ko-KR": "리모컨 앱",
        "zxx-XX": "ЛГ Rэмotэ AПП",
      },
      localizedVendorNames: {
        "": "LG Electronics",
      },
      permissions: [
        "TEST_SECURE",
        "CONTROL_INPUT_TEXT",
        "CONTROL_MOUSE_AND_KEYBOARD",
        "READ_INSTALLED_APPS",
        "READ_LGE_SDX",
        "READ_NOTIFICATIONS",
        "SEARCH",
        "WRITE_SETTINGS",
        "WRITE_NOTIFICATION_ALERT",
        "CONTROL_POWER",
        "READ_CURRENT_CHANNEL",
        "READ_RUNNING_APPS",
        "READ_UPDATE_INFO",
        "UPDATE_FROM_REMOTE_APP",
        "READ_LGE_TV_INPUT_EVENTS",
        "READ_TV_CURRENT_TIME",
      ],
      serial: "2f930e2d2cfe083771f68e4fe7bb07",
    },
    permissions: [
      "LAUNCH",
      "LAUNCH_WEBAPP",
      "APP_TO_APP",
      "CLOSE",
      "TEST_OPEN",
      "TEST_PROTECTED",
      "CONTROL_AUDIO",
      "CONTROL_DISPLAY",
      "CONTROL_INPUT_JOYSTICK",
      "CONTROL_INPUT_MEDIA_RECORDING",
      "CONTROL_INPUT_MEDIA_PLAYBACK",
      "CONTROL_INPUT_TV",
      "CONTROL_POWER",
      "READ_APP_STATUS",
      "READ_CURRENT_CHANNEL",
      "READ_INPUT_DEVICE_LIST",
      "READ_NETWORK_STATE",
      "READ_RUNNING_APPS",
      "READ_TV_CHANNEL_LIST",
      "WRITE_NOTIFICATION_TOAST",
      "READ_POWER_STATE",
      "READ_COUNTRY_INFO",
      "READ_SETTINGS",
      "CONTROL_TV_SCREEN",
      "CONTROL_TV_STANDBY",
      "CONTROL_FAVORITE_GROUP",
      "CONTROL_USER_INFO",
      "CHECK_BLUETOOTH_DEVICE",
      "CONTROL_BLUETOOTH",
      "CONTROL_TIMER_INFO",
      "STB_INTERNAL_CONNECTION",
      "CONTROL_RECORDING",
      "READ_RECORDING_STATE",
      "WRITE_RECORDING_LIST",
      "READ_RECORDING_LIST",
      "READ_RECORDING_SCHEDULE",
      "WRITE_RECORDING_SCHEDULE",
      "READ_STORAGE_DEVICE_LIST",
      "READ_TV_PROGRAM_INFO",
      "CONTROL_BOX_CHANNEL",
      "READ_TV_ACR_AUTH_TOKEN",
      "READ_TV_CONTENT_STATE",
      "READ_TV_CURRENT_TIME",
      "ADD_LAUNCHER_CHANNEL",
      "SET_CHANNEL_SKIP",
      "RELEASE_CHANNEL_SKIP",
      "CONTROL_CHANNEL_GROUP",
      "SCAN_TV_CHANNELS",
      "CONTROL_TV_POWER",
      "CONTROL_WOL",
    ],
    signatures: [
      {
        signatureVersion: 1,
        signature:
          "eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==",
      },
    ],
  },
} as const;

let keysDirInitialized = false;

function getKeysDir(): string {
  const dir = path.join(homedir(), ".config", "couch", "webos-keys");
  if (!keysDirInitialized) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory already exists
    }
    keysDirInitialized = true;
  }
  return dir;
}

export function getKeyFilePath(ip: string, mac: string): string {
  const safeIp = ip.replace(/\./g, "");
  const safeMac = mac.replace(/:/g, "");
  return path.join(getKeysDir(), `keyfile_${safeIp}_${safeMac}`);
}
