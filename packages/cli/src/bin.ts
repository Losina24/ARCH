#!/usr/bin/env node
import { getArchPaths } from '@losina/config';
import { resolveRunCwd } from '@losina/core';
import { isDaemonAlive } from '@losina/daemon';
import { withClient } from '@losina/daemon-client';
import { Command } from 'commander';

interface CwdOption {
  cwd: string;
}

interface ConfigSetOptions extends CwdOption {
  architectModel?: string;
  tlModel?: string;
  workerModel?: string;
  maxConcurrency?: string;
  maxRetries?: string;
}

const program = new Command();
program.name('archctl').description('ARCH orchestration CLI').version('0.1.0');

// Every subcommand accepts --cwd, defaulting to process.cwd() — resolve it once, here, before
// any action runs. Without this, invoking archctl from outside a git repository (or from a
// subdirectory) silently threads a non-repo-root path through to createRun/getArchPaths,
// surfacing only later as an opaque "fatal: not a git repository" deep in the task pipeline.
// `resolveRunCwd` also accepts a plain folder containing several repos as immediate
// subdirectories (rather than being a repo itself) — each task then picks its own repo.
program.hook('preAction', async (_thisCommand, actionCommand) => {
  const opts = actionCommand.opts() as CwdOption;
  if (typeof opts.cwd === 'string') {
    opts.cwd = await resolveRunCwd(opts.cwd);
  }
});

program
  .command('run')
  .description('Start a new run from a prompt')
  .argument('<prompt>', 'task description')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (prompt: string, options: CwdOption) => {
    const run = await withClient(options.cwd, (client) =>
      client.createRun({ prompt, cwd: options.cwd }),
    );
    console.log(JSON.stringify(run, null, 2));
  });

program
  .command('list')
  .description('List runs')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (options: CwdOption) => {
    const runs = await withClient(options.cwd, (client) => client.listRuns());
    console.log(JSON.stringify(runs, null, 2));
  });

program
  .command('show')
  .description('Show a run by id')
  .argument('<runId>')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (runId: string, options: CwdOption) => {
    const run = await withClient(options.cwd, (client) => client.getRun({ runId }));
    console.log(JSON.stringify(run, null, 2));
  });

program
  .command('approve')
  .description('Approve the current phase of a run')
  .argument('<runId>')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (runId: string, options: CwdOption) => {
    const run = await withClient(options.cwd, (client) => client.approveRun({ runId }));
    console.log(JSON.stringify(run, null, 2));
  });

program
  .command('abort')
  .description('Abort a run')
  .argument('<runId>')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (runId: string, options: CwdOption) => {
    const run = await withClient(options.cwd, (client) => client.abortRun({ runId }));
    console.log(JSON.stringify(run, null, 2));
  });

program
  .command('refine')
  .description('Send feedback to the Architect to revise the current plan')
  .argument('<runId>')
  .argument('<feedback>', 'what should change in the plan')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (runId: string, feedback: string, options: CwdOption) => {
    const run = await withClient(options.cwd, (client) => client.refineRun({ runId, feedback }));
    console.log(JSON.stringify(run, null, 2));
  });

program
  .command('retry-task')
  .description('Retry a failed task on a blocked run, with a message for the worker')
  .argument('<runId>')
  .argument('<taskId>')
  .argument('<message>', 'note for the worker resuming this task')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (runId: string, taskId: string, message: string, options: CwdOption) => {
    const run = await withClient(options.cwd, (client) =>
      client.retryTask({ runId, taskId, message }),
    );
    console.log(JSON.stringify(run, null, 2));
  });

program
  .command('plan')
  .description('Show the plan produced by the Architect for a run, if ready')
  .argument('<runId>')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (runId: string, options: CwdOption) => {
    const plan = await withClient(options.cwd, (client) => client.getRunPlan({ runId }));
    console.log(plan ? JSON.stringify(plan, null, 2) : 'Plan not ready yet.');
  });

program
  .command('daemon-status')
  .description('Check whether the ARCH daemon is running for this directory')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (options: CwdOption) => {
    const { socketPath } = getArchPaths(options.cwd);
    console.log((await isDaemonAlive(socketPath)) ? 'running' : 'stopped');
  });

const config = program.command('config').description('Manage ARCH configuration');

config
  .command('get')
  .description('Print the current configuration')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (options: CwdOption) => {
    const current = await withClient(options.cwd, (client) => client.getConfig());
    console.log(JSON.stringify(current, null, 2));
  });

config
  .command('set')
  .description('Update the architect, TL, and/or worker model configuration')
  .option('--architect-model <model>', 'model used by the Architect agent')
  .option('--tl-model <model>', 'model used by the TL agent')
  .option('--worker-model <model>', 'model used by Worker agents')
  .option('--max-concurrency <n>', 'maximum concurrent workers')
  .option('--max-retries <n>', 'maximum correction retries per task')
  .option('--cwd <dir>', 'working directory', process.cwd())
  .action(async (options: ConfigSetOptions) => {
    const updated = await withClient(options.cwd, (client) =>
      client.setConfig({
        models: {
          ...(options.architectModel && { architectModel: options.architectModel }),
          ...(options.tlModel && { tlModel: options.tlModel }),
          ...(options.workerModel && { workerModel: options.workerModel }),
        },
        ...(options.maxConcurrency && { maxConcurrency: Number(options.maxConcurrency) }),
        ...(options.maxRetries && { maxRetries: Number(options.maxRetries) }),
      }),
    );
    console.log(JSON.stringify(updated, null, 2));
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
