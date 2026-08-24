import type { CheckDefinition, ValidationResult } from '@losina/schemas';
import { runChecks } from '@losina/validator';

export interface ProcessWorkerReportInput {
  taskId: string;
  worktreePath: string;
  checks: CheckDefinition[];
}

export async function processWorkerReport(
  input: ProcessWorkerReportInput,
): Promise<ValidationResult> {
  return runChecks(input.taskId, input.worktreePath, input.checks);
}
