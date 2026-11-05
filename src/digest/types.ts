export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  /** All valid entries for this job, including retries. */
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Most recent recorded error, retained after a later successful run. */
  lastError: string | null;
  /** Original timestamps, including their offsets. */
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  /** Sorted by job, ascending. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid log entries by status, not final job statuses. */
  counts: Record<RunStatus, number>;
};

/** Synchronous reader; null means the night is invalid or its file is missing. */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
