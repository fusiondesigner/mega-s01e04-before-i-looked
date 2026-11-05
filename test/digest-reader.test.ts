import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
let runsDir: string;
beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeLines(lines: unknown[]): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
}

describe('readNight', () => {
  it('reads the real night without losing the null owner or recovered errors', () => {
    const digest = readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows[2].runs).toBe(8);
    expect(digest?.rows[3].lastStatus).toBe('fail');
    expect(digest?.rows[4].lastError).toBeNull();
  });

  it('returns an empty digest for an empty file and ignores whitespace separators', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    writeFileSync(join(runsDir, `${night}.jsonl`), '\r\n \t\r\n');
    expect(readNight(runsDir, night)?.badLines).toBe(0);
  });

  it('counts malformed JSON and invalid entry shapes, then continues reading', () => {
    const valid = { at: '2026-10-28T23:00:00+01:00', job: 'valid', status: 'ok', owner: null };
    writeFileSync(join(runsDir, `${night}.jsonl`), '{broken\n' +
      [null, [], 1, {}, { ...valid, status: 'unknown' }, { ...valid, owner: 5 },
        { ...valid, error: {} }, { ...valid, at: 'yesterday' },
        { ...valid, at: '2026-02-30T23:00:00Z' }, { ...valid, job: '' }, valid]
        .map((line) => JSON.stringify(line)).join('\n'));
    expect(readNight(runsDir, night)).toMatchObject({ badLines: 11, counts: { ok: 1, retry: 0, fail: 0 }, rows: [{ job: 'valid' }] });
  });

  it('uses chronological first/last entries across offsets and retains the latest error', () => {
    writeLines([
      { at: '2026-10-29T01:00:00Z', job: 'job', status: 'ok', owner: null },
      { at: '2026-10-29T02:30:00+02:00', job: 'job', status: 'retry', owner: 'new', error: 'latest' },
      { at: '2026-10-28T23:00:00Z', job: 'job', status: 'fail', owner: 'old', error: 'older' },
    ]);
    expect(readNight(runsDir, night)?.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest',
      firstAt: '2026-10-28T23:00:00Z', lastAt: '2026-10-29T01:00:00Z',
    }]);
  });

  it('uses the later line for equal times and treats absent owners as missing', () => {
    writeLines([
      { at: '2026-10-28T23:00:00Z', job: 'job', status: 'retry', owner: 'old', error: 'old' },
      { at: '2026-10-28T23:00:00Z', job: 'job', status: 'fail', error: 'new' },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toMatchObject({ owner: null, lastStatus: 'fail', lastError: 'new' });
  });

  it('returns null for missing nights and rejects traversal and impossible dates', () => {
    expect(readNight(runsDir, night)).toBeNull();
    for (const invalid of ['../2026-10-28', '2026-10-28/../../secret', '2026-02-30', '2026-13-01', '2026-1-1']) {
      expect(readNight(runsDir, invalid)).toBeNull();
    }
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
    expect(readNight(runsDir, '2024-02-29')).not.toBeNull();
  });

  it('does not disguise other filesystem failures as missing nights', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
