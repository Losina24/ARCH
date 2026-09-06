import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type AgentProgressEvent, runAgentHeadless } from '@losina/agent-runtime';
import { ChatNewTasksSchema, type NewTaskSpec, type RunMeta, type RunPlan } from '@losina/schemas';
import { buildChatPrompt } from './prompts.js';
import { fileExists } from './util/file-exists.js';

export interface ChatWithArchitectInput {
  run: RunMeta;
  runDir: string;
  plan: RunPlan | null;
  message: string;
  model: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AgentProgressEvent) => void;
}

export interface ChatWithArchitectOutput {
  sessionId: string;
  reply: string;
  /** New tasks the Architect decided to add to this same run's plan, when this turn called for
   * real work rather than just an answer — see buildChatPrompt. Absent on an ordinary turn. */
  newTasks?: NewTaskSpec[];
}

const TASK_ID_PATTERN = /^TASK-(\d+)$/;

/** The next id to hand the Architect, continuing this run's own "TASK-NNN" numbering. */
function computeNextTaskId(plan: RunPlan | null): string {
  const highest = (plan?.tasksIndex.tasks ?? []).reduce((max, task) => {
    const match = TASK_ID_PATTERN.exec(task.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `TASK-${String(highest + 1).padStart(3, '0')}`;
}

/**
 * One turn of an ongoing, always-resumed conversation with the human who requested this run.
 * Mostly no file/sentinel protocol like review/consultation use — the model's own output is the
 * reply, verbatim, the same way `dispatchWorker` treats a worker's output as its summary. The one
 * exception is the optional new-tasks manifest, mirroring runGrillingRound's question.json:
 * present only when this turn decided the plan should grow.
 */
export async function chatWithArchitect(
  input: ChatWithArchitectInput,
): Promise<ChatWithArchitectOutput> {
  const { run, runDir, plan, message } = input;
  const tasksDirPath = join(runDir, 'tasks');
  const newTasksFilePath = join(runDir, 'chat-new-tasks.json');
  const nextTaskId = computeNextTaskId(plan);
  const prompt = buildChatPrompt({
    run,
    plan,
    message,
    tasksDirPath,
    newTasksFilePath,
    nextTaskId,
  });

  const { sessionId, output } = await runAgentHeadless({
    prompt,
    model: input.model,
    cwd: run.cwd,
    resumeSessionId: input.resumeSessionId,
    permissionMode: 'bypassPermissions',
    // The whole run directory, not just where the manifest lives — a new task's own brief also
    // has to land under tasksDirPath, same as plan-project.ts grants for Definition phase.
    additionalDirs: [runDir],
    signal: input.signal,
    onProgress: input.onProgress,
  });

  if (!(await fileExists(newTasksFilePath))) {
    return { sessionId, reply: output };
  }

  const raw = await readFile(newTasksFilePath, 'utf-8');
  const parsed = ChatNewTasksSchema.parse(JSON.parse(raw));
  await rm(newTasksFilePath);

  return { sessionId, reply: output, newTasks: parsed.tasks };
}
