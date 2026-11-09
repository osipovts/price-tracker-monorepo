import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import {
  APP_CONFIG,
  type AppConfigInterface,
} from '../../shared/application/app-config.interface.js';
import { ApplicationErrorFilter } from '../../shared/presentation/application-error.filter.js';
import { OriginGuard } from './origin.guard.js';

@Controller('probe')
class ProbeController {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }

  @Post()
  write(): { ok: true } {
    return { ok: true };
  }
}

const config: AppConfigInterface = {
  databaseUrl: 'postgresql://localhost:5432/hub',
  redisUrl: 'redis://localhost:6379',
  port: 3000,
  priceProxyCount: 5,
  priceTimeoutMs: 60000,
  linkExpandTimeoutMs: 15000,
  priceRefreshAfterMs: 0,
  priceRefreshPollMs: 60_000,
  priceProxyLagMs: 30_000,
  priceRefreshBatchSize: 200,
  priceRefreshCohortMs: 600_000,
  proxyRefreshPauseMinutes: 10,
  proxyRefreshMaxCandidates: 200,
  proxyRefreshProbeTimeoutMs: 10000,
  authSessionIdleTtlMs: 60_000,
  authSessionAbsoluteTtlMs: 120_000,
  smtpUrl: null,
  mailFrom: 'hub@example.com',
  emailVerificationTtlMs: 86_400_000,
  authVerificationResendMaxAttempts: 1000,
  productsPerUserMax: 100,
  productGroupItemsMax: 5,
  productAddMaxAttempts: 1000,
  productAddWindowMs: 60_000,
  authSessionPurgeIntervalMs: 60_000,
  authRateLimitWindowMs: 60_000,
  authLoginMaxAttempts: 1000,
  authLoginMaxAttemptsPerEmail: 1000,
  authLoginMaxAttemptsPerIp: 1000,
  authRegisterMaxAttempts: 1000,
  trustProxy: 0,
  publicUrl: 'https://hub.example.com',
  authSuccessRedirect: '/auth/me',
  authFailureRedirect: null,
  authAllowedOrigins: ['https://app.example.com'],
  googleOauth: null,
  githubOauth: null,
  adminEmails: [],
  adminUiDir: null,
  s3: null,
  clientUiDir: null,
  operatorApiKey: null,
  authCookieSecure: true,
  logLevel: 'error',
};

let app: INestApplication;
let baseUrl: string;

before(async (): Promise<void> => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [
      { provide: APP_FILTER, useClass: ApplicationErrorFilter },
      { provide: APP_GUARD, useClass: OriginGuard },
      { provide: APP_CONFIG, useValue: config },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  baseUrl = await app.getUrl();
});

after(async (): Promise<void> => {
  await app.close();
});

async function status(method: string, headers: Record<string, string> = {}): Promise<number> {
  return (await fetch(`${baseUrl}/probe`, { method, headers })).status;
}

void test('lets a write through from the hub itself, from an origin it was told of, and from a client that is no browser', async (): Promise<void> => {
  assert.equal(await status('POST', { origin: 'https://hub.example.com' }), 201);
  assert.equal(await status('POST', { origin: 'https://app.example.com' }), 201);
  assert.equal(await status('POST'), 201);
  assert.equal(await status('POST', { 'sec-fetch-site': 'same-origin' }), 201);
});

void test('refuses a write that comes from another origin, a sibling one and a null one included', async (): Promise<void> => {
  for (const origin of [
    'https://evil.example',
    'https://other.hub.example.com',
    'http://hub.example.com',
    'https://hub.example.com:8443',
    'null',
  ]) {
    assert.equal(await status('POST', { origin }), 403, origin);
  }
});

void test('refuses a browser write that tells no origin but is not from the hub', async (): Promise<void> => {
  assert.equal(await status('POST', { 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await status('POST', { 'sec-fetch-site': 'same-site' }), 403);
});

void test('reads are no concern of the origin', async (): Promise<void> => {
  assert.equal(await status('GET', { origin: 'https://evil.example' }), 200);
});

void test('says why, in the shape of the other errors', async (): Promise<void> => {
  const response = await fetch(`${baseUrl}/probe`, {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
  });

  assert.deepEqual(await response.json(), {
    statusCode: 403,
    message: 'The request comes from an origin this hub does not serve',
  });
});
