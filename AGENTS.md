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


## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI has really generous
limits), not list price. Intelligence is how hard a problem you can hand the model
unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model             | cost | intelligence | taste |
|-------------------|------|--------------|-------|
| gpt-5.5           | 9    | 8            | 5     |
| composer-2.5-fast | 8    | 5            | 5     |
| composer-2.5      | 7    | 6            | 6     |
| sonnet-5          | 5    | 5            | 7     |
| opus-4.8          | 4    | 7            | 8     |
| fable-5           | 2    | 9            | 9     |

How to apply:
- These are defaults, not limits. You have standing permission to override them: if a cheaper
  model's output doesn't meet the bar, rerun or redo the work with a smarter model without
  asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre
  work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence >
  taste > cost.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): gpt-5.5 or
  composer-2.5 — both effectively free. Composer is faster; prefer it for quick iteration
  loops, gpt-5.5 for anything needing more reasoning depth.
- Anything user-facing (UI, copy, API design) needs taste ≥ 7.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally gpt-5.5 as an extra
  independent perspective.
- Never use Haiku.

Mechanics — non-Claude models run via their own CLIs:

- **gpt-5.5** is only reachable through the Codex CLI — `codex exec` / `codex review`
  (my ~/.codex/config.toml defaults to gpt-5.5). Use the codex-implementation, codex-review,
  and codex-computer-use skills; for work they don't cover (investigation, data analysis),
  run `codex exec -s read-only` directly with a self-contained prompt.

- **composer-2.5 / composer-2.5-fast** run via Cursor's `cursor-agent` CLI. `-p` is the critical
  flag for automation: it enables non-interactive print mode (without it, the agent stays
  interactive and waits for input). `--force` auto-approves changes.

  Making changes:

```sh
  cursor-agent -p --force --model composer-2.5 --workspace "$PWD" \
    "Fix the failing tests, run the test suite, and summarize the changes"
```

  Read-only / analysis:

```sh
  cursor-agent -p --model composer-2.5 --output-format text \
    "Summarize this repo and suggest the first 3 improvements"
```

  Model slug caveat: naming around Composer 2.5 fast/non-fast has been messy. `composer-2.5`
  should resolve to base (non-fast) Composer 2.5, but the explicit non-fast syntax is
  `composer-2.5[fast=false]` or `composer-2.5[]` — if output seems off (too fast, too
  shallow), pin the explicit slug.

- **Claude models** (sonnet-5, opus-4.8, fable-5) run via the Agent/Workflow model parameter.

Using non-Claude models inside workflows and subagents (the model parameter only takes
Claude models, so use a wrapper):
- Spawn a thin Claude wrapper agent with `model: 'sonnet', effort: 'low'` whose prompt
  instructs it to write a self-contained prompt for the target CLI, run it via Bash
  (`codex exec` or `cursor-agent -p`), and return the output verbatim as its final message.