import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App.tsx";
import { useDeviceStore } from "./store/deviceStore";
import { logger } from "./utils/logger";

logger.init();

await useDeviceStore.getState().loadDevices();

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
