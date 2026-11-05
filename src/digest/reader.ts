import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type Run = {
  at: string;
  job: string;
  owner: string | null;
  status: RunStatus;
  error: string | null;
};

function parseRun(line: string): Run | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(record.at) ||
    !validNight(record.at.slice(0, 10)) ||
    !Number.isFinite(Date.parse(record.at)) ||
    typeof record.job !== 'string' || record.job.trim() === '' ||
    (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail') ||
    (record.owner !== undefined && record.owner !== null && typeof record.owner !== 'string') ||
    (record.error !== undefined && record.error !== null && typeof record.error !== 'string')
  ) return null;
  return {
    at: record.at,
    job: record.job,
    owner: typeof record.owner === 'string' && record.owner.trim() !== '' ? record.owner : null,
    status: record.status,
    error: typeof record.error === 'string' && record.error.trim() !== '' ? record.error : null,
  };
}

function validNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const date = new Date(`${night}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}

export const readNight: ReadNight = (runsDir, night) => {
  // Validate before joining: a route parameter must never escape the runs directory.
  if (!validNight(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, { row: DigestRow; errorAt: number }>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const run = parseRun(line);
    if (run === null) {
      badLines += 1;
      continue;
    }
    counts[run.status] += 1;
    const at = Date.parse(run.at);
    const existing = jobs.get(run.job);
    if (!existing) {
      jobs.set(run.job, {
        row: {
          job: run.job, owner: run.owner, runs: 1,
          retries: run.status === 'retry' ? 1 : 0,
          lastStatus: run.status, lastError: run.error,
          firstAt: run.at, lastAt: run.at,
        },
        errorAt: run.error === null ? -Infinity : at,
      });
      continue;
    }
    const { row } = existing;
    row.runs += 1;
    if (run.status === 'retry') row.retries += 1;
    if (at < Date.parse(row.firstAt)) row.firstAt = run.at;
    // Equal timestamps use the later log entry; compare instants, preserve display offsets.
    if (at >= Date.parse(row.lastAt)) {
      row.lastAt = run.at;
      row.lastStatus = run.status;
      row.owner = run.owner;
    }
    if (run.error !== null && at >= existing.errorAt) {
      row.lastError = run.error;
      existing.errorAt = at;
    }
  }
  const rows = [...jobs.values()].map(({ row }) => row)
    .sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return { night, rows, badLines, counts };
};
