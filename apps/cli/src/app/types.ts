import type { OperationRecord } from "@couch/device";
import type { ResultBase } from "../commandOutput";

export type AppCommandKind = "app.launch" | "app.foreground";

// Parameterized so each runner accepts only its own literal: `runLaunch` cannot
// be handed an `app.foreground` command, and vice versa.
export interface ParsedAppCommand<K extends AppCommandKind = AppCommandKind> {
  command: K;
  targetAlias: string;
  json: boolean;
}

export interface AppCommandResult extends ResultBase {
  command: AppCommandKind;
  targetAlias: string;
  deviceId?: string;
  status: "succeeded" | "failed" | "cancelled";
  operations: readonly OperationRecord[];
}
