import type { Task } from '@losina/schemas';
import { Text } from 'ink';
import { taskStyle } from '../task-style.js';
import { ACCENT, SELECTION_CURSOR } from '../theme.js';

const NEUTRAL_STATUSES = new Set(['pending', 'ready', 'needs_correction']);

interface TaskLineProps {
  task: Task;
  selected?: boolean;
}

/** "[TASK-001] Title" — plain tasks get a gray id + white title, special statuses take over the whole line. */
export function TaskLine({ task, selected = false }: TaskLineProps) {
  const style = taskStyle(task.status);
  const cursor = <Text color={ACCENT}>{selected ? `${SELECTION_CURSOR} ` : '  '}</Text>;

  if (NEUTRAL_STATUSES.has(task.status)) {
    return (
      <Text>
        {cursor}
        <Text color={style.color}>[{task.id}]</Text> {task.title}
      </Text>
    );
  }

  return (
    <Text>
      {cursor}
      <Text
        color={style.color}
        bold={style.bold}
        italic={style.italic}
        strikethrough={style.strikethrough}
      >
        [{task.id}] {task.title}
      </Text>
    </Text>
  );
}
