/**
 * Case-insensitive subsequence match: every character of `query` must appear in
 * `target`, in order, though not necessarily contiguously. Score rewards
 * contiguous runs and word-boundary starts so tighter/more-relevant matches sort
 * first. Returns null when `query` doesn't fully match.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let queryIndex = 0;
  let score = 0;
  let consecutive = 0;

  for (let targetIndex = 0; targetIndex < t.length && queryIndex < q.length; targetIndex++) {
    if (t[targetIndex] === q[queryIndex]) {
      consecutive += 1;
      score += consecutive * consecutive;
      if (targetIndex === 0 || t[targetIndex - 1] === ' ') score += 2;
      queryIndex += 1;
    } else {
      consecutive = 0;
    }
  }

  return queryIndex === q.length ? score : null;
}

export function filterRuns<T extends { title: string }>(runs: T[], query: string): T[] {
  if (!query.trim()) return runs;

  return runs
    .map((run) => ({ run, score: fuzzyScore(query, run.title) }))
    .filter((entry): entry is { run: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.run);
}
