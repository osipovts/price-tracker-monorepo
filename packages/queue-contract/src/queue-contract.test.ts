import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handbookFetchJobSchema } from './handbook-fetch-job.type.js';
import { handbookFetchResultSchema } from './handbook-fetch-result.type.js';
import { priceFetchJobSchema } from './price-fetch-job.type.js';
import { priceFetchResultSchema } from './price-fetch-result.type.js';
import { proxyFetchJobSchema } from './proxy-fetch-job.type.js';
import { proxyFetchResultSchema } from './proxy-fetch-result.type.js';

const uuid = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11';
void test('accepts a price fetch job with proxies, and rejects a direct route', (): void => {
  const job = {
    jobId: uuid,
    proxies: [
      { server: 'socks5://203.0.113.10:1080' },
      { server: 'http://user:secret@203.0.113.11:8080' },
    ],
    products: [{ trackedProductId: uuid, url: 'https://www.ozon.ru/product/1/' }],
    timeoutMs: 15000,
  };
  assert.equal(priceFetchJobSchema.safeParse(job).success, true);
  assert.equal(
    priceFetchJobSchema.safeParse({ ...job, proxies: [...job.proxies, { server: null }] }).success,
    false,
  );
});

void test('accepts a product marked as read by an earlier try', (): void => {
  const job = {
    jobId: uuid,
    proxies: [{ server: 'socks5://203.0.113.10:1080' }],
    products: [{ trackedProductId: uuid, url: 'https://www.ozon.ru/product/1/', read: true }],
    timeoutMs: 15000,
  };
  const parsed = priceFetchJobSchema.parse(job);

  assert.equal(parsed.products[0]?.read, true);
});

void test('rejects empty and malformed price fetch jobs', (): void => {
  const valid = {
    jobId: uuid,
    proxies: [{ server: 'socks5://203.0.113.10:1080' }],
    products: [{ trackedProductId: uuid, url: 'https://www.ozon.ru/product/1/' }],
    timeoutMs: 15000,
  };
  for (const invalid of [
    { ...valid, proxies: [] },
    { ...valid, products: [] },
    { ...valid, jobId: 'not-a-uuid' },
    { ...valid, proxies: [{ server: 'ftp://203.0.113.10:21' }] },
    { ...valid, timeoutMs: 5 },
  ]) {
    assert.equal(priceFetchJobSchema.safeParse(invalid).success, false);
  }
});

void test('discriminates price fetch results by type', (): void => {
  assert.equal(
    priceFetchResultSchema.safeParse({
      type: 'product_result',
      jobId: uuid,
      trackedProductId: uuid,
      status: 'challenge_required',
      attempts: [
        {
          proxy: 'socks5://203.0.113.10:1080',
          result: { status: 'challenge_required' },
        },
      ],
    }).success,
    true,
  );
  assert.equal(priceFetchResultSchema.safeParse({ type: 'unknown' }).success, false);
});

void test('validates proxy fetch jobs and results', (): void => {
  assert.equal(
    proxyFetchJobSchema.safeParse({
      jobId: uuid,
      source: 'github-free-proxy-list',
      maxCandidates: 100,
      probeTimeoutMs: 10000,
    }).success,
    true,
  );
  assert.equal(
    proxyFetchJobSchema.safeParse({
      jobId: uuid,
      source: 'unknown',
      maxCandidates: 1,
      probeTimeoutMs: 1000,
    }).success,
    false,
  );
  assert.equal(
    proxyFetchResultSchema.safeParse({
      type: 'proxy_checks',
      jobId: uuid,
      source: 'github-free-proxy-list',
      checks: [
        {
          server: 'socks5://203.0.113.10:1080',
          alive: true,
          latencyMs: 420,
          country: 'RU',
          exitIp: '203.0.113.10',
          checkedAt: '2026-10-24T12:00:00.000Z',
        },
        {
          server: 'http://203.0.113.11:8080',
          alive: false,
          latencyMs: null,
          country: null,
          exitIp: null,
          checkedAt: '2026-10-24T12:00:00.000Z',
        },
      ],
    }).success,
    true,
  );
});

void test('validates job progress messages of both workers', (): void => {
  for (const message of [
    { type: 'job_started', jobId: uuid },
    { type: 'job_progress', jobId: uuid, processed: 1, total: 2, succeeded: 1 },
    { type: 'job_failed', jobId: uuid, reason: 'Browser crashed', willRetry: true },
    { type: 'job_done', jobId: uuid },
  ])
    assert.equal(priceFetchResultSchema.safeParse(message).success, true);

  for (const message of [
    { type: 'job_started', jobId: uuid },
    { type: 'job_progress', jobId: uuid, processed: 0, total: 20, succeeded: 0 },
    { type: 'job_done', jobId: uuid },
    { type: 'job_failed', jobId: uuid, reason: 'Source down', willRetry: false },
  ])
    assert.equal(proxyFetchResultSchema.safeParse(message).success, true);

  assert.equal(
    proxyFetchResultSchema.safeParse({
      type: 'proxy_checks',
      jobId: uuid,
      source: 'x',
      checks: [],
    }).success,
    false,
  );
});

void test('accepts the city of a product in a price fetch job, and no city', (): void => {
  const job = (product: Record<string, unknown>): unknown => ({
    jobId: uuid,
    proxies: [{ server: 'socks5://203.0.113.10:1080' }],
    products: [
      {
        trackedProductId: uuid,
        url: 'https://www.dns-shop.ru/product/0463bb2411a1d582/',
        ...product,
      },
    ],
    timeoutMs: 15000,
  });

  assert.equal(priceFetchJobSchema.safeParse(job({})).success, true);
  assert.equal(priceFetchJobSchema.safeParse(job({ cityId: uuid })).success, true);
  assert.equal(priceFetchJobSchema.safeParse(job({ cityId: '' })).success, false);
});

void test('validates handbook fetch jobs: the handbook and the routes it is read through', (): void => {
  const job = {
    jobId: uuid,
    handbook: 'dns-cities',
    proxies: ['socks5://203.0.113.10:1080'],
  };

  assert.equal(handbookFetchJobSchema.safeParse(job).success, true);
  assert.equal(handbookFetchJobSchema.safeParse({ ...job, proxies: [null] }).success, false);
  assert.equal(handbookFetchJobSchema.safeParse({ ...job, proxies: [] }).success, false);
  assert.equal(handbookFetchJobSchema.safeParse({ ...job, handbook: 'unknown' }).success, false);
});

void test('validates the results of a handbook fetch: the cities and the lifecycle', (): void => {
  const cities = {
    type: 'handbook_cities',
    jobId: uuid,
    handbook: 'dns-cities',
    cities: [
      { id: '30b7c1f1-03fb-11dc-95ee-00151716f9f5', name: 'Иркутск', region: 'Иркутская область' },
    ],
  };

  assert.equal(handbookFetchResultSchema.safeParse(cities).success, true);
  assert.equal(
    handbookFetchResultSchema.safeParse({
      ...cities,
      handbook: 'wildberries-cities',
      cities: [{ id: '-5827226', name: 'Иркутск', region: 'Иркутская обл.' }],
    }).success,
    true,
  );
  assert.equal(
    handbookFetchResultSchema.safeParse({ ...cities, handbook: 'unknown' }).success,
    false,
  );
  assert.equal(
    handbookFetchResultSchema.safeParse({
      ...cities,
      cities: [{ id: '', name: 'x', region: null }],
    }).success,
    false,
  );
  assert.equal(
    handbookFetchResultSchema.safeParse({ type: 'job_done', jobId: uuid }).success,
    true,
  );
  assert.equal(
    handbookFetchResultSchema.safeParse({
      type: 'job_progress',
      jobId: uuid,
      processed: 3,
      total: 33,
      succeeded: 3,
    }).success,
    true,
  );
});
