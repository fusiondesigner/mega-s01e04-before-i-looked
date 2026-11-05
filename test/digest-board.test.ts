import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest links on status board', () => {
  it('links each night and shows its ok, retry, and fail counts', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-board-'));
    tempDirs.push(runsDir);
    writeFileSync(
      join(runsDir, '2026-10-28.jsonl'),
      [
        JSON.stringify({ at: '2026-10-28T01:00:00Z', job: 'alpha', status: 'ok', owner: 'ada' }),
        JSON.stringify({ at: '2026-10-28T01:01:00Z', job: 'beta', status: 'retry', owner: 'ada' }),
        JSON.stringify({ at: '2026-10-28T01:02:00Z', job: 'beta', status: 'fail', owner: 'ada' }),
      ].join('\n'),
    );
    writeFileSync(
      join(runsDir, '2026-10-29.jsonl'),
      JSON.stringify({ at: '2026-10-29T01:00:00Z', job: 'gamma', status: 'ok', owner: null }),
    );

    const response = await createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    }).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-29">2026-10-29</a>');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok 1 · retry 0 · fail 0');
    expect(html).toContain('ok 1 · retry 1 · fail 1');
  });
});
