import type { TestResult } from "./runner";

// status and exitCode are independent literal unions on TestResult, so TypeScript
// cannot prove they agree. Assert the mapping at publish time.

const EXPECTED_EXIT: Record<TestResult["status"], number | readonly number[]> = {
  passed: 0,
  failed: 1,
  "infrastructure-failed": 2,
  cancelled: [130, 143],
};

function exitCodeAligns(status: TestResult["status"], exitCode: number): boolean {
  const expected = EXPECTED_EXIT[status];
  return Array.isArray(expected) ? expected.includes(exitCode) : exitCode === expected;
}

export function assertExitCodeAligns(result: TestResult): void {
  if (!exitCodeAligns(result.status, result.exitCode)) {
    throw new Error(
      `Result status "${result.status}" and exitCode ${result.exitCode} do not align`,
    );
  }
}
