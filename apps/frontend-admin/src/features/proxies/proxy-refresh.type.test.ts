import { expect, test } from 'vitest';

import type { JobRecordType } from '../jobs/use-job-records.hook.js';
import { activeJobIds, hasEnded, latestJobsBySource } from './proxy-refresh.type.js';

function job(
  id: string,
  subject: string,
  status: JobRecordType['status'],
  lost = false,
): JobRecordType {
  return {
    id,
    kind: 'proxy_fetch',
    subject,
    status,
    percent: 0,
    processed: 0,
    total: null,
    succeeded: 0,
    error: null,
    createdAt: '2026-11-10T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    lost,
    product: null,
  };
}

test('takes the newest job of each source', () => {
  const latest = latestJobsBySource([
    job('3', 'proxifly', 'running'),
    job('2', 'geonode', 'completed'),
    job('1', 'proxifly', 'failed'),
  ]);

  expect([...latest].map(([source, { id }]): string => `${source}:${id}`)).toEqual([
    'proxifly:3',
    'geonode:2',
  ]);
});

test('tells the jobs on their way, leaving out the lost ones, and notices one that ended', () => {
  const before = activeJobIds([
    job('1', 'proxifly', 'running'),
    job('2', 'geonode', 'queued'),
    job('3', 'monosans', 'queued', true),
  ]);
  expect([...before]).toEqual(['1', '2']);

  expect(hasEnded(before, new Set(['1', '2']))).toBe(false);
  expect(hasEnded(before, new Set(['2']))).toBe(true);
});
