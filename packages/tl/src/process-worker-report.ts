import type { CheckDefinition, ValidationResult } from '@arch/schemas';
import { runChecks } from '@arch/validator';

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
