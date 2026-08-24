import type { RunMeta } from '@losina/schemas';

const TASKS_INDEX_SCHEMA = `tasks:
  - id: TASK-001            # stable id, format TASK-NNN
    title: "Short imperative title"
    status: pending          # always "pending" for new tasks
    dependsOn: []             # ids of tasks that must be "done" first
    file: tasks/TASK-001.md   # path to the task file, relative to the run directory
    correctionFiles: []       # always [] for new tasks
    retries: 0                # always 0 for new tasks
    checks:                   # commands that verify the Definition of Done, run from the repo root
      - name: "build"
        command: "pnpm"
        args: ["--filter", "some-app", "build"]
    scope:                   # dirs/files this task will modify — keep disjoint between
                              # independent tasks so they can run in parallel safely
      - apps/some-app/src/feature/`;

interface PlanPromptInput {
  run: RunMeta;
  projectMarkdownPath: string;
  tasksIndexPath: string;
  tasksDirPath: string;
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const { run, projectMarkdownPath, tasksIndexPath, tasksDirPath } = input;
  return `You are the ARCHITECT agent of ARCH, an autonomous multi-agent software engineering system. This system will be used to read the requirements of a project, analyze the codebase, generate a really good implementation plan, divide the plan in a DAG of tasks, and implement the tasks.

Your ONLY job right now is the Definition phase: turn the user's request below into a concrete implementation plan for this repository. You must NOT write, edit, or refactor any application or source code, and you must NOT modify any file outside of "${projectMarkdownPath}", "${tasksIndexPath}" and files under "${tasksDirPath}/" — these are absolute paths outside this repository, in ARCH's own run storage; you have been granted access to write there. Explore the repository (or the repositories if you identify that there is something usefull in another one) as needed (read files, run read-only commands) to ground the plan in how this codebase actually works.

User request:
"""
${run.prompt}
"""

Produce exactly these deliverables:

1. "${projectMarkdownPath}" — a well explained project brief in Markdown: goal, chosen approach, the parts of the existing codebase that are relevant, and any architectural decisions or risks a future implementer should know about. There may be more than one repository involved.

2. "${tasksIndexPath}" — a YAML file listing every implementation task, matching this exact schema:

${TASKS_INDEX_SCHEMA}

   Guidelines for decomposing tasks:
   - Prefer several small, independently implementable tasks over one large task but DO NOT abuse of small, every task should have a reasonable amount of content. Example: Do NOT create a specific task for changing a CHANGELOG file. 
   - A good task could be one that is limited to a specific module but implements the complete solution within that module. A small project could have 2 or 3, even 4 tasks, a medium-sized project could have 6-7 tasks, and a large project could have more than 10 tasks (these figures are for reference only).
   - Use "dependsOn" only for genuine ordering constraints (e.g. shared types/schema before their consumers). Tasks with no constraint between them should be able to run in parallel.
   - Every "id" must be unique and every "dependsOn" entry must reference an id that exists.
   - For "checks", inspect the repo (package.json scripts, Makefiles, existing CI config) and use real, runnable commands scoped to the affected package/app (build/lint/test/typecheck). Use an empty list only if truly nothing applies.
   - For "scope", list the directories/files this task will modify. Keep scopes disjoint between tasks that have no "dependsOn" relationship, so they can be safely worked on in parallel.

3. One Markdown file per task at "${tasksDirPath}/<id>.md" (the path referenced by "file"), containing: a complete context section, an explicit Definition of Done checklist, and any implementation notes or constraints. This file is the only brief the worker that implements the task will receive, so it must be self-contained. It is VERY IMPORTANT that this file has a good explanation. It is not necessary to include every line of code, but you must provide enough explanation so that two different workers could implement practically the same solution.

End your final message with exactly one line: PLAN_READY`;
}

interface RefinePlanPromptInput extends PlanPromptInput {
  feedback: string;
}

export function buildRefinePlanPrompt(input: RefinePlanPromptInput): string {
  const { projectMarkdownPath, tasksIndexPath, tasksDirPath, feedback } = input;
  return `You are the ARCHITECT agent of ARCH. The user reviewed the plan you produced and asked for changes before approving it. This is still the Definition phase: you must NOT write, edit, or refactor any application or source code, and you must NOT modify any file outside of "${projectMarkdownPath}", "${tasksIndexPath}" and files under "${tasksDirPath}/".

User feedback:
"""
${feedback}
"""

Revise "${projectMarkdownPath}", "${tasksIndexPath}" and the task files under "${tasksDirPath}/" in place to address this feedback. Keep the ids of tasks that are still valid unchanged (so any existing references keep working); add, remove or rewrite tasks as needed. The tasks-index file must keep matching this schema:

${TASKS_INDEX_SCHEMA}

End your final message with exactly one line: PLAN_READY`;
}

interface ReviewPromptInput {
  taskId: string;
  taskMarkdown: string;
  correctionMarkdowns: string[];
  gitDiff: string;
  correctionFilePath: string;
  workerSummary: string;
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const { taskId, taskMarkdown, correctionMarkdowns, gitDiff, correctionFilePath, workerSummary } =
    input;
  const priorCorrections = correctionMarkdowns.length
    ? `\n\nPrior correction rounds already sent to the worker for this task:\n${correctionMarkdowns
        .map((markdown, index) => `--- correction round ${index + 1} ---\n${markdown}`)
        .join('\n\n')}`
    : '';

  return `You are the ARCHITECT agent of ARCH. A worker just finished implementing task "${taskId}" and it already passed the automated build/lint/test checks. Your job now is the semantic review (does the change actually satisfy the Definition of Done, is it well-integrated with the rest of the codebase, is it complete). You must NOT edit any source file yourself.

Task brief (this is the only brief the worker received):
"""
${taskMarkdown}
"""
${priorCorrections}

Worker's own explanation of what it did in this attempt (unverified — cross-check it against the actual diff below, don't take it at face value):
"""
${workerSummary || '(the worker left no explanation)'}
"""

Full diff of the worker's changes for this task:
"""
${gitDiff || '(no changes were staged)'}
"""

Decide:
- If the change satisfies the Definition of Done: do not write any file, and end your final message with exactly one line: APPROVED
- Otherwise: write precise, actionable correction instructions (what is missing or wrong, and what must change) to exactly this path: "${correctionFilePath}", then end your final message with exactly one line: NEEDS_CORRECTION`;
}
