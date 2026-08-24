import type { ValidationResult } from '@losina/schemas';

export function buildCorrectionPrompt(result: ValidationResult): string {
  const failed = result.checks.filter((check) => !check.passed);
  const details = failed.map((check) => `### ${check.name}\n${check.output}`).join('\n\n');
  return `The following checks failed and must be fixed:\n\n${details}`;
}
