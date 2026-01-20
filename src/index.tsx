import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import { App } from './App.tsx'
import { logger } from './utils/logger'
import { useDeviceStore } from './store/deviceStore'

logger.init()

await useDeviceStore.getState().loadDevices()

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
