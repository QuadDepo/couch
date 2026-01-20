import type { TVDevice } from "../types";

export const initialDevices: TVDevice[] = [
  {
    id: "1",
    name: "Living Room Android TV",
    platform: "philips-android-tv",
    ip: "192.168.1.241",
    status: "disconnected",
  },
  {
    id: "2",
    name: "Chromecast",
    platform: "android-tv",
    ip: "192.168.1.85",
    status: "disconnected",
  },
];
