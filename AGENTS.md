# AGENTS.md

Terminal-based TV remote control app using Bun, React 19, and OpenTUI.

## Tech Stack

- **Runtime**: Bun
- **UI**: React 19 with OpenTUI (terminal UI framework)
- **State**: Zustand for global state, XState for connection state machines
- **Language**: TypeScript (strict mode)

## Commands

```bash
bun install        # Install dependencies
bun dev            # Run dev server with watch mode
```

## Project Structure

```
src/
├── components/    # React components (controls, devices, dialogs, layout, shared)
├── devices/       # Platform-specific handlers (android-tv, philips-tv, etc.)
├── hooks/         # Custom React hooks
├── machines/      # XState state machines
├── store/         # Zustand stores
├── types/         # TypeScript types
└── utils/         # Utility functions
```

## Code Style

### Comments

Code should be self-explanatory. Only use comments when absolutely necessary (e.g., explaining non-obvious business logic or workarounds).

```tsx
// ❌ Bad
// Get the device by id
const device = devices.find((d) => d.id === deviceId);

// ✅ Good - no comment needed, code is clear
const device = devices.find((d) => d.id === deviceId);

// ✅ Good - comment explains WHY, not WHAT
// Philips requires 2 OCUs minimum for their pairing protocol
const minOCUs = 2;
```

### Imports

Import from specific files, not barrel exports. Do not create `index.ts` files for re-exporting.

```tsx
// ❌ Bad - barrel import
import { TVDevice, RemoteKey } from "../types";

// ✅ Good - direct import (this project uses a single types file)
import type { TVDevice, RemoteKey } from "../types";
```

### Types

Before creating new types, check if they already exist in `src/types/` or in the libraries used (OpenTUI, XState, Zustand).

```tsx
// ❌ Bad - recreating existing types
interface MyConnectionStatus {
  connected: boolean;
}

// ✅ Good - use existing types
import type { ConnectionStatus } from "../types";
```

## Boundaries

### Always

- Use `type` imports for TypeScript types
- Check `src/types/` before defining new types
- Follow existing patterns for device handlers in `src/devices/`

### Ask First

- Adding new dependencies
- Changing state machine logic
- Modifying the device connection flow

### Never

- Add unnecessary comments
- Create `index.ts` barrel files
- Recreate types that already exist
- Commit secrets or credentials
