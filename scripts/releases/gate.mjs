import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fullCommit } from './context.mjs';

export function trustedRun(event, config, eventName = 'workflow_run') {
  const run = event?.workflow_run;
  if (eventName !== 'workflow_run' || event.repository?.full_name !== config.repository
    || run?.head_repository?.full_name !== config.repository || run.event !== 'push'
    || run.head_branch !== config.sourceBranch || run.name !== 'CI'
    || run.status !== 'completed' || run.conclusion !== 'success' || !fullCommit(run.head_sha)
    || !Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) {
    throw new Error('Publication requires successful CI for an exact trusted main push.');
  }
  return run;
}

export async function qualifyCi(event, config, { eventName = 'workflow_run', request } = {}) {
  const trigger = trustedRun(event, config, eventName);
  if (!request) throw new Error('A GitHub evidence reader is required.');
  const prefix = `/repos/${config.repository}/actions/runs/${trigger.id}`;
  const run = await request(prefix);
  trustedRun({ repository: event.repository, workflow_run: run }, config, eventName);
  if (run.id !== trigger.id || run.head_sha !== trigger.head_sha || run.run_attempt !== trigger.run_attempt
    || run.path !== config.ciWorkflow) throw new Error('The triggering CI revision, attempt or workflow changed.');
  const jobs = [];
  for (let page = 1; page <= 10; page++) {
    const response = await request(`${prefix}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
    if (!Array.isArray(response.jobs) || !Number.isSafeInteger(response.total_count) || response.total_count > 1000) throw new Error('Malformed CI job evidence.');
    jobs.push(...response.jobs);
    if (jobs.length >= response.total_count) break;
    if (page === 10 || !response.jobs.length) throw new Error('Incomplete CI job evidence.');
  }
  const required = jobs.filter(job => job.name === config.ciJob);
  if (required.length !== 1 || !jobs.length || jobs.some(job => job.status !== 'completed' || job.conclusion !== 'success')) {
    throw new Error('Every CI job, including the required gate, must succeed.');
  }
  return { schemaVersion: 'trading-lab-ci.0.1', repository: config.repository, sourceCommit: run.head_sha,
    workflow: config.ciWorkflow, runId: run.id, runAttempt: run.run_attempt,
    jobId: required[0].id, jobName: config.ciJob,
    url: `https://github.com/${config.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}` };
}

export function githubReader(token, { request = fetch } = {}) {
  if (!token) throw new Error('The workflow GitHub token is required for CI evidence.');
  return async path => {
    if (!path.startsWith('/repos/')) throw new Error('Invalid GitHub evidence path.');
    const response = await request(`https://api.github.com${path}`, { redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw new Error(`GitHub CI evidence unavailable: HTTP ${response.status}.`);
    return response.json();
  };
}

export async function environmentEvidence(config, env = process.env) {
  if (env.GITHUB_REPOSITORY !== config.repository || !env.GITHUB_EVENT_PATH) throw new Error('Publication must run in the configured repository workflow.');
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  return qualifyCi(event, config, { eventName: env.GITHUB_EVENT_NAME, request: githubReader(env.GH_TOKEN) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync('distribution/release-publisher.json', 'utf8'));
  const evidence = await environmentEvidence(config);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${evidence.sourceCommit}\n`);
  if (process.env.VALIDATION_OUTPUT) writeFileSync(process.env.VALIDATION_OUTPUT, JSON.stringify(evidence) + '\n');
  console.log(`Qualified CI run ${evidence.runId}, attempt ${evidence.runAttempt}, source ${evidence.sourceCommit}.`);
}
