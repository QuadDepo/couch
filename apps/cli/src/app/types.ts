import type { OperationRecord } from "@couch/device";
import type { ResultBase } from "../commandOutput";

export interface ParsedAppCommand {
  command: "app.launch" | "app.foreground";
  targetAlias: string;
  json: boolean;
}

export interface AppCommandResult extends ResultBase {
  command: "app.launch" | "app.foreground";
  targetAlias: string;
  deviceId?: string;
  status: "succeeded" | "failed" | "cancelled";
  operations: readonly OperationRecord[];
}
