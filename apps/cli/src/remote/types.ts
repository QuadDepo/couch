import type { OperationRecord, RemoteKey } from "@couch/device";
import type { ResultBase } from "../commandOutput";

export interface ParsedPress {
  command: "remote.press";
  targetId: string;
  key: RemoteKey;
  requestedTimes: number;
  json: boolean;
}

export interface PressResult extends ResultBase {
  command: "remote.press";
  targetId: string;
  key: RemoteKey;
  requestedTimes: number;
  status: "succeeded" | "failed" | "cancelled";
  operations: readonly OperationRecord[];
}
