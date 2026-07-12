import {
  isOperationKind,
  type OperationKind,
  type OperationRecord,
  type RemoteKey,
} from "@couch/device";
import { isRecord } from "./guards";
import type { VisualRectangle } from "./visual";

export interface VisualRegionOptions {
  region: string;
  threshold?: number;
  maxDiffRatio?: number;
  ignoreRegions?: readonly VisualRectangle[];
}

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
    visualRegion(name: string, options: VisualRegionOptions): Promise<void>;
  };
}

export interface TvTestDefinition {
  name: string;
  requires: readonly OperationKind[];
  run(context: TvTestContext): Promise<void> | void;
}

// Single source of truth for the test-definition contract. Runs both at authoring time
// (defineTvTest) and at the trust boundary when a test module is loaded (loadTest).
export function assertTvTestDefinition(value: unknown): asserts value is TvTestDefinition {
  if (!isRecord(value)) {
    throw new Error("TV test must default-export defineTvTest({...})");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("TV test name must be a non-empty string");
  }
  if (!Array.isArray(value.requires)) {
    throw new Error("TV test requires must be an array of operation kinds");
  }
  value.requires.forEach((kind, index) => {
    if (typeof kind !== "string" || !isOperationKind(kind)) {
      throw new Error(`TV test requires[${index}] is not a known operation kind`);
    }
  });
  if (typeof value.run !== "function") {
    throw new Error("TV test run must be a function");
  }
}

export function defineTvTest(test: TvTestDefinition): TvTestDefinition {
  assertTvTestDefinition(test);
  return test;
}
