import type { TestResult, TestTrace } from "@couch/runner/runner";
import type { ResultBase } from "../commandOutput";

export interface ParsedTest {
  command: "test";
  file: string;
  targetAlias: string;
  json: boolean;
}

export interface TestCommandResult extends ResultBase {
  command: "test";
  status: TestResult["status"];
  exitCode: TestResult["exitCode"];
  file: string;
  targetAlias: string;
  artifactDirectory?: string;
  trace?: TestTrace;
}
