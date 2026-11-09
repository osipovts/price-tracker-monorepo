import { expect, test } from 'vitest';

import { createI18n } from '../../i18n/i18n.js';
import { jobKindLabel, jobStatusColor, jobStatusLabel } from './job-status-label.type.js';

const { t } = createI18n('en');

test('names the statuses the hub knows and a lost job, and shows another one as it is', () => {
  expect(jobStatusLabel('queued', t)).toBe('queued');
  expect(jobStatusLabel('running', t)).toBe('running');
  expect(jobStatusLabel('retrying', t)).toBe('retrying');
  expect(jobStatusLabel('completed', t)).toBe('completed');
  expect(jobStatusLabel('failed', t)).toBe('failed');
  expect(jobStatusLabel('lost', t)).toBe('lost');
  expect(jobStatusLabel('paused', t)).toBe('paused');
});

test('colours a status by how the job is doing', () => {
  expect(jobStatusColor('queued')).toBe('gray');
  expect(jobStatusColor('running')).toBe('accent');
  expect(jobStatusColor('failed')).toBe('red');
  expect(jobStatusColor('lost')).toBe('orange');
});

test('names the kinds of the jobs', () => {
  expect(jobKindLabel('price_fetch', t)).toBe('Price read');
  expect(jobKindLabel('proxy_fetch', t)).toBe('Proxy source');
  expect(jobKindLabel('handbook_fetch', t)).toBe('Handbook');
  expect(jobKindLabel('other', t)).toBe('other');
});
