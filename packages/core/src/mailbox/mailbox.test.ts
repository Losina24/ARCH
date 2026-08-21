import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewRequest, ReviewResponse } from '@arch/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadReviewRequest,
  loadReviewResponse,
  writeReviewRequest,
  writeReviewResponse,
} from './mailbox.js';

describe('mailbox', () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'arch-mailbox-test-'));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it('round-trips a review request as a YAML document under runDir/mailbox', async () => {
    const request: ReviewRequest = {
      taskId: 'TASK-001',
      seq: 1,
      model: 'sonnet',
      correctionFilePath: join(runDir, 'tasks', 'TASK-001.corrections.1.md'),
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff --git a/src/index.js b/src/index.js',
      workerSummary: 'Implemented add(a, b) in src/index.js.',
    };

    const path = await writeReviewRequest(runDir, request);

    expect(path).toBe(join(runDir, 'mailbox', 'TASK-001.request.1.yaml'));
    expect(await loadReviewRequest(path)).toEqual(request);
  });

  it('round-trips a review response as a YAML document under runDir/mailbox', async () => {
    const response: ReviewResponse = {
      taskId: 'TASK-001',
      seq: 1,
      sessionId: 'session-1',
      approved: false,
      correctionMarkdown: 'Handle the negative-number case too.',
    };

    const path = await writeReviewResponse(runDir, response);

    expect(path).toBe(join(runDir, 'mailbox', 'TASK-001.response.1.yaml'));
    expect(await loadReviewResponse(path)).toEqual(response);
  });

  it('keeps requests for different tasks and rounds independent', async () => {
    const first: ReviewRequest = {
      taskId: 'TASK-001',
      seq: 1,
      model: 'sonnet',
      correctionFilePath: join(runDir, 'tasks', 'TASK-001.corrections.1.md'),
      taskMarkdown: '# Task 1',
      correctionMarkdowns: [],
      gitDiff: '',
      workerSummary: 'Implemented task 1.',
    };
    const second: ReviewRequest = {
      ...first,
      taskId: 'TASK-001',
      seq: 2,
      taskMarkdown: '# Task 1 v2',
    };

    const firstPath = await writeReviewRequest(runDir, first);
    const secondPath = await writeReviewRequest(runDir, second);

    expect(await loadReviewRequest(firstPath)).toEqual(first);
    expect(await loadReviewRequest(secondPath)).toEqual(second);
  });
});
