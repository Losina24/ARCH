import type { CheckDefinition, ValidationResult } from '@arch/schemas';
import { execa } from 'execa';

export async function runChecks(
  taskId: string,
  cwd: string,
  checks: CheckDefinition[],
): Promise<ValidationResult> {
  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        const { stdout } = await execa(check.command, check.args, { cwd });
        return { name: check.name, passed: true, output: stdout };
      } catch (error) {
        const output = error instanceof Error ? error.message : String(error);
        return { name: check.name, passed: false, output };
      }
    }),
  );

  return {
    taskId,
    passed: results.every((r) => r.passed),
    checks: results,
  };
}
