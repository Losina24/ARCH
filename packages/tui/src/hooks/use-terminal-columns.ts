import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

const DEFAULT_COLUMNS = 80;

/**
 * Node's stdout doesn't emit an initial size — only `resize` on later
 * changes — and `columns` is undefined outside a real TTY (e.g. under the
 * ink-testing-library mock), hence the fallback.
 */
export function useTerminalColumns(): number {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout.columns ?? DEFAULT_COLUMNS);

  useEffect(() => {
    const handleResize = () => setColumns(stdout.columns ?? DEFAULT_COLUMNS);
    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  return columns;
}
