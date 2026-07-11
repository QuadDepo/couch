import type { TestResult, TestTrace } from "@couch/runner/runner";
export interface ParsedTest {
  command: "test";
  file: string;
  targetAlias: string;
  json: boolean;
}
export interface TestCommandResult {
  resultVersion: 1;
  command: "test";
  status: TestResult["status"];
  exitCode: TestResult["exitCode"];
  file: string;
  targetAlias: string;
  artifactDirectory?: string;
  trace?: TestTrace;
  error?: { code: string; message: string };
  cleanupError?: { code: string; message: string };
}
