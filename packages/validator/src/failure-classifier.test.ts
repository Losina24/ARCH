import type { ValidationResult } from '@losina/schemas';
import { describe, expect, it } from 'vitest';
import { isHumanInterventionNeeded, isInfraFailure } from './failure-classifier.js';

function result(checks: ValidationResult['checks']): ValidationResult {
  return { taskId: 'TASK-001', passed: checks.every((c) => c.passed), checks };
}

describe('isInfraFailure', () => {
  it('detects a DNS resolution failure', () => {
    const r = result([
      {
        name: 'build',
        passed: false,
        output:
          'Unknown host nexus.int.sys.idealista: nodename nor servname provided, or not known',
      },
    ]);
    expect(isInfraFailure(r)).toBe(true);
  });

  it('detects a connection-refused failure', () => {
    const r = result([
      { name: 'build', passed: false, output: 'connect ECONNREFUSED 127.0.0.1:8081' },
    ]);
    expect(isInfraFailure(r)).toBe(true);
  });

  it('does not classify a genuine assertion/lint failure as infra', () => {
    const r = result([{ name: 'lint', passed: false, output: 'unexpected token at line 4' }]);
    expect(isInfraFailure(r)).toBe(false);
  });

  it('does not classify a mix of infra and code failures as purely infra', () => {
    const r = result([
      { name: 'build', passed: false, output: 'Unknown host nexus.int.sys.idealista' },
      { name: 'lint', passed: false, output: 'unexpected token at line 4' },
    ]);
    expect(isInfraFailure(r)).toBe(false);
  });

  it('returns false when every check passed', () => {
    const r = result([{ name: 'build', passed: true, output: 'ok' }]);
    expect(isInfraFailure(r)).toBe(false);
  });
});

describe('isHumanInterventionNeeded', () => {
  it('detects a permission-denied crash message', () => {
    expect(isHumanInterventionNeeded("Error: EACCES: permission denied, open '/etc/hosts'")).toBe(
      true,
    );
  });

  it('detects a sandbox-blocked crash message', () => {
    expect(isHumanInterventionNeeded('Action blocked: sandbox denied network access')).toBe(true);
  });

  it('detects a message asking for manual approval', () => {
    expect(isHumanInterventionNeeded('This command requires manual approval to proceed')).toBe(
      true,
    );
  });

  it('does not classify a genuine code crash as needing human intervention', () => {
    expect(isHumanInterventionNeeded('TypeError: Cannot read properties of undefined')).toBe(false);
  });
});
