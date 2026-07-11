import type { OperationRecord } from "@couch/device";
import type { ResultBase } from "../commandOutput";
export interface ParsedScreenshot {
  command: "screenshot";
  targetAlias: string;
  out: string;
  json: boolean;
}
export interface ScreenshotResult extends ResultBase {
  command: "screenshot";
  targetAlias: string;
  out: string;
  status: "succeeded" | "failed" | "cancelled";
  operations: readonly OperationRecord[];
}
