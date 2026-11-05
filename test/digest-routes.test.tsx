import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function writeNight(contents: string): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), contents);
}

function run(at: string, job: string, status: 'ok' | 'retry' | 'fail', owner: string | null = 'rook', error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

describe('digest routes', () => {
  it('serves the same sorted digest fields as HTML and JSON', async () => {
    writeNight([
      run('2026-10-29T01:03:00+01:00', 'alpha', 'ok', null),
      run('2026-10-29T01:02:00+01:00', 'a.B', 'ok'),
      run('2026-10-29T01:00:00+01:00', 'Alpha', 'retry'),
      run('2026-10-29T01:01:00+01:00', 'a/b', 'ok'),
    ].join('\n'));

    const apiResponse = await app().request(`/api/digest/${night}`);
    const htmlResponse = await app().request(`/digest/${night}`);
    const digest = await apiResponse.json();
    const html = await htmlResponse.text();

    expect(apiResponse.status).toBe(200);
    expect(htmlResponse.status).toBe(200);
    expect(digest).toEqual({
      night,
      rows: [
        { job: 'Alpha', owner: 'rook', runs: 1, retries: 1, failures: 0, lastStatus: 'retry', lastError: null,
          firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T01:00:00+01:00' },
        { job: 'a.B', owner: 'rook', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:02:00+01:00', lastAt: '2026-10-29T01:02:00+01:00' },
        { job: 'a/b', owner: 'rook', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:01:00+01:00', lastAt: '2026-10-29T01:01:00+01:00' },
        { job: 'alpha', owner: null, runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:03:00+01:00', lastAt: '2026-10-29T01:03:00+01:00' },
      ],
      badLines: 0,
      counts: { ok: 3, retry: 1, fail: 0 },
    });

    const orderedJobs = ['Alpha', 'a.B', 'a/b', 'alpha'];
    let previous = -1;
    for (const job of orderedJobs) {
      const index = html.indexOf(job);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(html).toContain('rook');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-29T01:00:00+01:00');
    expect(html).toContain('2026-10-29T01:03:00+01:00');
  });

  it('returns 404 for missing and invalid nights on both routes', async () => {
    for (const path of ['/digest/2026-10-28', '/api/digest/2026-10-28', '/digest/2026-10-28%2F..%2Fsecret', '/api/digest/2026-10-28%2F..%2Fsecret']) {
      expect((await app().request(path)).status).toBe(404);
    }
  });

  it('renders an empty digest as nothing ran and returns empty JSON rows', async () => {
    writeNight('');
    const htmlResponse = await app().request(`/digest/${night}`);
    const apiResponse = await app().request(`/api/digest/${night}`);
    const html = await htmlResponse.text();

    expect(htmlResponse.status).toBe(200);
    expect(apiResponse.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(await apiResponse.json()).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed lines while retaining valid rows, null owners, and original timestamp offsets', async () => {
    writeNight([
      '{broken',
      run('2026-10-29T01:30:00+01:00', 'kept', 'ok', null),
      run('2026-10-29T02:30:00+02:00', 'kept', 'fail', null, 'failed once'),
    ].join('\n'));
    const apiResponse = await app().request(`/api/digest/${night}`);
    const htmlResponse = await app().request(`/digest/${night}`);
    const html = await htmlResponse.text();

    expect(apiResponse.status).toBe(200);
    expect(htmlResponse.status).toBe(200);
    expect(await apiResponse.json()).toEqual({
      night,
      rows: [{ job: 'kept', owner: null, runs: 2, retries: 0, failures: 1, lastStatus: 'fail', lastError: 'failed once',
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T02:30:00+02:00' }],
      badLines: 1,
      counts: { ok: 1, retry: 0, fail: 1 },
    });
    expect(html).toContain('1 bad line');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-29T01:30:00+01:00');
    expect(html).toContain('2026-10-29T02:30:00+02:00');
    expect(html).toContain('failed once');
  });

  it('highlights rows with at least three retries or a failure, and escapes log text', async () => {
    const unsafe = '<script>alert("x")</script>';
    writeNight([
      run('2026-10-28T23:00:00Z', 'many-retries', 'retry', 'rook'),
      run('2026-10-28T23:01:00Z', 'many-retries', 'retry', 'rook'),
      run('2026-10-28T23:02:00Z', 'many-retries', 'retry', 'rook'),
      run('2026-10-28T23:03:00Z', 'many-retries', 'ok', 'rook'),
      run('2026-10-28T23:03:30Z', 'recovered', 'fail', 'rook'),
      run('2026-10-28T23:03:45Z', 'recovered', 'ok', 'rook'),
      run('2026-10-28T23:04:00Z', 'failed', 'fail', 'rook', unsafe),
      run('2026-10-28T23:05:00Z', 'safe', 'ok', 'rook', unsafe),
    ].join('\n'));
    const htmlResponse = await app().request(`/digest/${night}`);
    const html = await htmlResponse.text();
    const apiResponse = await app().request(`/api/digest/${night}`);

    expect(htmlResponse.status).toBe(200);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('alert(&quot;x&quot;)');
    expect(await apiResponse.json()).toMatchObject({
      rows: [
        { job: 'failed', lastStatus: 'fail', lastError: unsafe },
        { job: 'many-retries', retries: 3, lastStatus: 'ok' },
        { job: 'recovered', failures: 1, lastStatus: 'ok' },
        { job: 'safe', lastError: unsafe },
      ],
    });

    const highlightedRows = [...html.matchAll(/<tr class="warn">([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
    expect(highlightedRows).toHaveLength(3);
    expect(highlightedRows.join('\n')).toContain('failed');
    expect(highlightedRows.join('\n')).toContain('many-retries');
    expect(highlightedRows.join('\n')).toContain('recovered');
    expect(highlightedRows.join('\n')).not.toContain('safe');
  });
});
