import type { OperationKind, OperationRecord, RemoteKey } from "@couch/device";

export interface TvTestContext {
  tv: {
    app: {
      launch(): Promise<OperationRecord>;
      foreground(): Promise<OperationRecord>;
    };
    press(key: RemoteKey, options?: { times?: number; intervalMs?: number }): Promise<void>;
    screen: { capture(name?: string): Promise<OperationRecord> };
  };
  expect: {
    foreground(record?: OperationRecord): void;
    equal<T>(actual: T, expected: T, message?: string): void;
  };
}

export interface TvTestDefinition {
  name: string;
  requires: readonly OperationKind[];
  run(context: TvTestContext): Promise<void> | void;
}

export function defineTvTest(test: TvTestDefinition): TvTestDefinition {
  if (!test.name.trim()) throw new Error("TV test name must not be empty");
  return test;
}
