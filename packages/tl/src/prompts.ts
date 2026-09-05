import type { CheckDefinition } from '@losina/schemas';

/** A dependency task's identity, surfaced to a dependent task's Worker so it reuses rather than
 * reinvents what that task already produced. */
export interface DependencyBrief {
  id: string;
  title: string;
  scope: string[];
  /** Short excerpt of the dependency's own task markdown — only set when it declared no `scope`
   * (nothing to point the Worker at otherwise). See `resolveDependencyBriefs`. */
  summary?: string;
}

/**
 * Who's actually behind a correction round, so the Worker prompt attributes it accurately:
 * - 'checks': the Team Lead ran this task's automated checks and they failed.
 * - 'scope': the Team Lead detected changes outside the task's declared scope.
 * - 'review': the Architect performed the semantic review and requested changes.
 */
export type CorrectionSource = 'checks' | 'scope' | 'review';

const CORRECTION_INTRO: Record<CorrectionSource, string> = {
  checks:
    "The Team Lead ran this task's automated checks against your previous implementation and they failed.",
  scope:
    "The Team Lead detected file changes outside this task's declared scope in your previous implementation.",
  review: 'The Architect reviewed your previous implementation of this task and requested changes.',
};

/**
 * Surfaces the exact commands the Team Lead will run to validate this task — including the
 * exact package/path each one targets — so the Worker can run them itself before finishing
 * instead of only self-verifying against a package/path it assumed. Without this, a check
 * that targets the wrong package for this repo's actual layout only surfaces after the Team
 * Lead runs it post-hoc, and the Worker has no way to tell that failure apart from a real
 * defect in its own code.
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

/**
 * Lists each dependency task's identity so the Worker treats what it already produced as a fixed
 * contract to build on, instead of rediscovering — or worse, redefining — it blind. The last
 * sentence matters even in the common case: it's what keeps the prompt honest if the underlying
 * worktree/branch machinery ever fails to actually land a dependency's files, instead of pushing
 * the Worker to silently reimplement a "missing" contract.
 */
function formatDependenciesBlock(dependencies: DependencyBrief[]): string {
  if (dependencies.length === 0) return '';
  const list = dependencies
    .map((dep) => {
      const scopeText = dep.scope.length > 0 ? dep.scope.join(', ') : '(no declared scope)';
      const summaryText = dep.summary ? `\n  ${dep.summary}` : '';
      return `- ${dep.id} "${dep.title}" — owns: ${scopeText}${summaryText}`;
    })
    .join('\n');
  return `\n\nThis task depends on work other tasks already completed. Their code is already in
this repository — treat it as a fixed contract:
${list}

Read those files first and build on top of what they define. Do not redefine, duplicate or
re-declare anything they already provide, and do not edit the files they own: if you believe one
is wrong or insufficient for your needs, adapt your own code and say so explicitly in your final
summary instead of changing it. If a file listed above is not present in your working copy, do not
recreate it — report that in your final summary instead.`;
}

export interface BuildWorkerPromptInput {
  /** This task's own id — echoed as a line in the prompt so tooling (and this codebase's e2e
   * fake runtime) can identify which task a given dispatch is for without guessing from cwd or
   * scanning the prompt for a queued id, which breaks once the prompt legitimately mentions
   * other tasks' ids too (see the dependencies block above). */
  taskId: string;
  taskMarkdown: string;
  correctionMarkdown?: string;
  humanMessage?: string;
  correctionSource?: CorrectionSource;
  checks?: CheckDefinition[];
  dependencies?: DependencyBrief[];
}

export function buildWorkerPrompt(input: BuildWorkerPromptInput): string {
  const {
    taskId,
    taskMarkdown,
    correctionMarkdown,
    humanMessage,
    correctionSource = 'review',
    checks = [],
    dependencies = [],
  } = input;
  const checksBlock = formatChecksBlock(checks);
  const dependenciesBlock = formatDependenciesBlock(dependencies);
  const taskIdLine = `Task under implementation: ${taskId}`;

  if (!correctionMarkdown) {
    const note = humanMessage
      ? `\n\nA human reviewed this task after a previous attempt and left this note for you:\n"""\n${humanMessage}\n"""`
      : '';
    return `You are a WORKER agent of ARCH, an autonomous multi-agent software engineering system.
${taskIdLine}
Implement the following task completely in this repository. Follow the existing code style and
conventions. Do not ask questions — make reasonable decisions and implement the full task.

Task brief:
"""
${taskMarkdown}
"""${note}${checksBlock}${dependenciesBlock}

When you are done, make sure every item in the Definition of Done is satisfied.

IMPORTANT: Never run \`git commit\` yourself. Committing is handled centrally by ARCH's orchestrator, which may deliberately leave your changes uncommitted (e.g. when working directly on the user's own checked-out branch) for a human to review and commit by hand.`;
  }

  return `You are a WORKER agent of ARCH. ${CORRECTION_INTRO[correctionSource]} Apply exactly the
corrections below on top of your previous work in this same repository/session.
${taskIdLine}

Original task brief:
"""
${taskMarkdown}
"""

Requested corrections:
"""
${correctionMarkdown}
"""${checksBlock}${dependenciesBlock}

When you are done, make sure every item in the Definition of Done is satisfied.

IMPORTANT: Never run \`git commit\` yourself. Committing is handled centrally by ARCH's orchestrator, which may deliberately leave your changes uncommitted (e.g. when working directly on the user's own checked-out branch) for a human to review and commit by hand.`;
}
