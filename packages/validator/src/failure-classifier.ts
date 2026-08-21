import type { ValidationResult } from '@arch/schemas';

// Signatures of environment/network failures a Worker cannot fix by changing code — DNS
// resolution, unreachable registries/hosts, connection timeouts. Deliberately conservative:
// only well-known infra wording, never a guess at "this looks like a build error".
const INFRA_FAILURE_PATTERNS: RegExp[] = [
  /unknown host/i,
  /nodename nor servname provided/i,
  /name or service not known/i,
  /temporary failure in name resolution/i,
  /getaddrinfo (?:enotfound|eai_again)/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /enotfound/i,
  /connection timed out/i,
  /connection refused/i,
  /could not transfer artifact/i,
  /502 bad gateway/i,
  /503 service unavailable/i,
  /504 gateway timeout/i,
];

/**
 * True only when every failed check's output matches a known infra/network failure signature.
 * A single genuine code failure mixed in with an infra one still returns false: the Worker can
 * and should act on that check regardless of what else is failing.
 */
export function isInfraFailure(result: ValidationResult): boolean {
  const failed = result.checks.filter((check) => !check.passed);
  return (
    failed.length > 0 &&
    failed.every((check) => INFRA_FAILURE_PATTERNS.some((pattern) => pattern.test(check.output)))
  );
}

// Signatures of a crash that no amount of Worker retrying can resolve on its own — the sandbox
// or environment is blocking an action that requires a human to grant permission or intervene
// directly, not a code defect to fix.
const HUMAN_INTERVENTION_PATTERNS: RegExp[] = [
  /permission denied/i,
  /eacces/i,
  /eperm/i,
  /requires manual (?:approval|intervention)/i,
  /needs? (?:human|manual) (?:approval|intervention)/i,
  /operation not permitted/i,
  /sandbox (?:denied|blocked|restricted)/i,
  /user (?:approval|confirmation) required/i,
  /must be approved by a human/i,
];

/**
 * True when a crash's message looks like it needs a human to unblock it (an environment/sandbox
 * permission wall) rather than a code fix the Worker could retry its way out of. Deliberately
 * conservative, same spirit as `isInfraFailure` — only well-known wording, never a guess.
 */
export function isHumanInterventionNeeded(message: string): boolean {
  return HUMAN_INTERVENTION_PATTERNS.some((pattern) => pattern.test(message));
}
