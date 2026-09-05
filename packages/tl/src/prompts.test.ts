import { describe, expect, it } from 'vitest';
import { buildWorkerPrompt } from './prompts.js';

describe('buildWorkerPrompt', () => {
  it('embeds the task brief when there is no correction', () => {
    const prompt = buildWorkerPrompt('# Task brief\n\nAdd add(a, b).');
    expect(prompt).toContain('# Task brief');
    expect(prompt).toContain('Add add(a, b).');
    expect(prompt).not.toContain('Requested corrections');
  });

  it('embeds both the original brief and the correction when one is given, defaulting to review attribution', () => {
    const prompt = buildWorkerPrompt('# Task brief', 'Handle the negative-number case too.');
    expect(prompt).toContain('# Task brief');
    expect(prompt).toContain('Handle the negative-number case too.');
    expect(prompt).toContain('Requested corrections');
    expect(prompt).toContain('The Architect reviewed your previous implementation');
  });

  it('attributes the correction to the automated checks when the source is checks', () => {
    const prompt = buildWorkerPrompt(
      '# Task brief',
      'The build check failed.',
      undefined,
      'checks',
    );
    expect(prompt).toContain("This task's automated checks were run");
    expect(prompt).not.toContain('The Architect');
    expect(prompt).not.toContain('Team Lead');
  });

  it('attributes the correction to an automated scope check when the source is scope', () => {
    const prompt = buildWorkerPrompt(
      '# Task brief',
      'You changed a file outside your scope.',
      undefined,
      'scope',
    );
    expect(prompt).toContain('An automated scope check found file changes outside');
    expect(prompt).not.toContain('The Architect');
    expect(prompt).not.toContain('Team Lead');
  });

  it('embeds a human note when retrying with no correction', () => {
    const prompt = buildWorkerPrompt('# Task brief', undefined, 'Try using the v2 API instead.');
    expect(prompt).toContain('# Task brief');
    expect(prompt).toContain('Try using the v2 API instead.');
    expect(prompt).toContain('left this note for you');
  });

  it('ignores the human note once a correction is in progress', () => {
    const prompt = buildWorkerPrompt(
      '# Task brief',
      'Handle the negative-number case too.',
      'Try using the v2 API instead.',
    );
    expect(prompt).not.toContain('Try using the v2 API instead.');
    expect(prompt).not.toContain('left this note for you');
  });

  it('says nothing about checks when the task has none', () => {
    const prompt = buildWorkerPrompt('# Task brief');
    expect(prompt).not.toContain('validated by running');
  });

  it('embeds the exact check commands so the worker can run them itself before finishing', () => {
    const prompt = buildWorkerPrompt('# Task brief', undefined, undefined, 'review', [
      { name: 'build', command: 'pnpm', args: ['--filter', 'some-app', 'build'] },
    ]);
    expect(prompt).toContain('- build: pnpm --filter some-app build');
    expect(prompt).toContain('mistake in this task');
  });

  it('embeds check commands in a correction prompt too', () => {
    const prompt = buildWorkerPrompt(
      '# Task brief',
      'The build check failed.',
      undefined,
      'checks',
      [{ name: 'test', command: 'pnpm', args: ['test'] }],
    );
    expect(prompt).toContain('- test: pnpm test');
  });
});
