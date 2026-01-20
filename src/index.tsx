import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import { App } from './App.tsx'
import { logger } from './utils/logger'

logger.init()

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
