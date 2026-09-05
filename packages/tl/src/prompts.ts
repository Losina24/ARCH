import type { CheckDefinition } from '@losina/schemas';

/**
 * Who's actually behind a correction round, so the Worker prompt attributes it accurately:
 * - 'checks': ARCH ran this task's automated checks and they failed.
 * - 'scope': an automated scope check detected changes outside the task's declared scope.
 * - 'review': the Architect performed the semantic review and requested changes.
 */
export type CorrectionSource = 'checks' | 'scope' | 'review';

const CORRECTION_INTRO: Record<CorrectionSource, string> = {
  checks:
    "This task's automated checks were run against your previous implementation and they failed.",
  scope:
    "An automated scope check found file changes outside this task's declared scope in your previous implementation.",
  review: 'The Architect reviewed your previous implementation of this task and requested changes.',
};

/**
 * Surfaces the exact commands ARCH will run to validate this task — including the exact
 * package/path each one targets — so the Worker can run them itself before finishing instead
 * of only self-verifying against a package/path it assumed. Without this, a check that targets
 * the wrong package for this repo's actual layout only surfaces after they are run post-hoc,
 * and the Worker has no way to tell that failure apart from a real defect in its own code.
 */
function formatChecksBlock(checks: CheckDefinition[]): string {
  if (checks.length === 0) return '';
  const list = checks
    .map((check) => `- ${check.name}: ${[check.command, ...check.args].join(' ')}`)
    .join('\n');
  return `\n\nYour work will be validated by running these exact commands, from the repository root:
"""
${list}
"""
Run them yourself, against that exact package/path, before finishing. If one of them fails
because the command, package, or path it targets does not actually exist in this repository,
that is a mistake in this task's own definition, not something to fix by guessing at a
replacement path — say so explicitly in your final summary instead of only reporting on your
own code changes.`;
}

export function buildWorkerPrompt(
  taskMarkdown: string,
  correctionMarkdown?: string,
  humanMessage?: string,
  correctionSource: CorrectionSource = 'review',
  checks: CheckDefinition[] = [],
): string {
  const checksBlock = formatChecksBlock(checks);

  if (!correctionMarkdown) {
    const note = humanMessage
      ? `\n\nA human reviewed this task after a previous attempt and left this note for you:\n"""\n${humanMessage}\n"""`
      : '';
    return `You are a WORKER agent of ARCH, an autonomous multi-agent software engineering system.
Implement the following task completely in this repository. Follow the existing code style and
conventions. Do not ask questions — make reasonable decisions and implement the full task.

Task brief:
"""
${taskMarkdown}
"""${note}${checksBlock}

When you are done, make sure every item in the Definition of Done is satisfied.

IMPORTANT: Never run \`git commit\` yourself. Committing is handled centrally by ARCH's orchestrator, which may deliberately leave your changes uncommitted (e.g. when working directly on the user's own checked-out branch) for a human to review and commit by hand.`;
  }

  return `You are a WORKER agent of ARCH. ${CORRECTION_INTRO[correctionSource]} Apply exactly the
corrections below on top of your previous work in this same repository/session.

Original task brief:
"""
${taskMarkdown}
"""

Requested corrections:
"""
${correctionMarkdown}
"""${checksBlock}

When you are done, make sure every item in the Definition of Done is satisfied.

IMPORTANT: Never run \`git commit\` yourself. Committing is handled centrally by ARCH's orchestrator, which may deliberately leave your changes uncommitted (e.g. when working directly on the user's own checked-out branch) for a human to review and commit by hand.`;
}
