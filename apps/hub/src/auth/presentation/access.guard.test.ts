import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Req } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';

import { GetAccountUseCase } from '../../account/application/get-account.use-case.js';
import { UserEntity } from '../../account/domain/user.entity.js';
import { InMemoryUserRepositoryAdapter } from '../../account/infrastructure/in-memory-user-repository.adapter.js';
import { ResolveAuthSessionUseCase } from '../../auth-session/application/resolve-auth-session.use-case.js';
import { StartAuthSessionUseCase } from '../../auth-session/application/start-auth-session.use-case.js';
import { InMemoryAuthSessionRepositoryAdapter } from '../../auth-session/infrastructure/in-memory-auth-session-repository.adapter.js';
import {
  APP_CONFIG,
  type AppConfigInterface,
} from '../../shared/application/app-config.interface.js';
import { ApplicationErrorFilter } from '../../shared/presentation/application-error.filter.js';
import { requireIdentity } from '../../shared/presentation/request-identity.type.js';
import { routeAccess } from '../../shared/presentation/route-access.type.js';
import { AccessGuard } from './access.guard.js';
import { SessionCookieParser } from './session-cookie.parser.js';

@Controller('probe')
class ProbeController {
  @Get('public')
  @routeAccess('public')
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('user')
  user(@Req() request: Request): { userId: string } {
    return { userId: requireIdentity(request).userId };
  }

  @Get('admin')
  @routeAccess('admin')
  admin(@Req() request: Request): { userId: string } {
    return { userId: requireIdentity(request).userId };
  }

  @Get('operator')
  @routeAccess('operator')
  operator(): { ok: true } {
    return { ok: true };
  }
}

const apiKey = 'operator-key-of-at-least-16-chars';
const userId = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';
const adminId = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11';
const unprovenAdminId = '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33';
const at = new Date('2026-10-31T10:00:00Z');
const users = new InMemoryUserRepositoryAdapter();
await users.add(UserEntity.register(userId, 'user@example.com', at));
await users.add(UserEntity.registerVerified(adminId, 'boss@example.com', at));
// Signed up with the email of an administrator, which nobody has proven to be theirs.
await users.add(UserEntity.register(unprovenAdminId, 'second@example.com', at));

function configWith(operatorApiKey: string | null): AppConfigInterface {
  return {
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
    authCookieSecure: false,
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
    publicUrl: 'http://localhost:3000',
    authAllowedOrigins: [],
    authSuccessRedirect: '/auth/me',
    authFailureRedirect: null,
    googleOauth: null,
    githubOauth: null,
    adminEmails: ['boss@example.com', 'second@example.com'],
    adminUiDir: null,
    s3: null,
    clientUiDir: null,
    operatorApiKey,
    logLevel: 'error',
  };
}

async function start(
  operatorApiKey: string | null,
  sessions: InMemoryAuthSessionRepositoryAdapter,
): Promise<{ app: INestApplication; baseUrl: string }> {
  const policy = { idleTtlMs: 60_000, absoluteTtlMs: 120_000 };
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [
      { provide: APP_FILTER, useClass: ApplicationErrorFilter },
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_CONFIG, useValue: configWith(operatorApiKey) },
      {
        provide: ResolveAuthSessionUseCase,
        useValue: new ResolveAuthSessionUseCase(sessions, policy),
      },
      { provide: GetAccountUseCase, useValue: new GetAccountUseCase(users) },
      SessionCookieParser,
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);

  return { app, baseUrl: await app.getUrl() };
}

const sessions = new InMemoryAuthSessionRepositoryAdapter();
let app: INestApplication;
let baseUrl: string;
let cookie = '';
let adminCookie = '';
let unprovenAdminCookie = '';

before(async (): Promise<void> => {
  ({ app, baseUrl } = await start(apiKey, sessions));
  const begin = new StartAuthSessionUseCase(sessions, {
    idleTtlMs: 60_000,
    absoluteTtlMs: 120_000,
  });
  const cookieOf = async (id: string): Promise<string> =>
    `session=${(await begin.execute({ userId: id, userAgent: null, ip: null })).token}`;
  [cookie, adminCookie, unprovenAdminCookie] = [
    await cookieOf(userId),
    await cookieOf(adminId),
    await cookieOf(unprovenAdminId),
  ];
});

after(async (): Promise<void> => {
  await app.close();
});

async function status(path: string, headers: Record<string, string> = {}): Promise<number> {
  return (await fetch(`${baseUrl}${path}`, { headers })).status;
}

void test('a public route is open to everyone', async (): Promise<void> => {
  assert.equal(await status('/probe/public'), 200);
});

void test('a route is for a signed-in user unless marked otherwise, and the key does not open it', async (): Promise<void> => {
  assert.equal(await status('/probe/user'), 401);
  assert.equal(await status('/probe/user', { cookie: 'session=forged' }), 401);
  assert.equal(await status('/probe/user', { authorization: `Bearer ${apiKey}` }), 401);

  const response = await fetch(`${baseUrl}/probe/user`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userId });
});

void test('an admin route is for an administrator signed in: not for a user, nor for the API key', async (): Promise<void> => {
  const response = await fetch(`${baseUrl}/probe/admin`, { headers: { cookie: adminCookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userId: adminId });

  assert.equal(await status('/probe/admin'), 401);
  assert.equal(await status('/probe/admin', { cookie: 'session=forged' }), 401);
  assert.equal(await status('/probe/admin', { authorization: `Bearer ${apiKey}` }), 401);
  assert.equal(await status('/probe/admin', { cookie }), 403);
});

void test('an email of the list that nobody has proven makes no administrator', async (): Promise<void> => {
  assert.equal(await status('/probe/admin', { cookie: unprovenAdminCookie }), 403);
  assert.equal(await status('/probe/operator', { cookie: unprovenAdminCookie }), 403);
});

void test('an operator route takes the API key, or an administrator signed in: a user is not an operator', async (): Promise<void> => {
  assert.equal(await status('/probe/operator', { authorization: `Bearer ${apiKey}` }), 200);
  assert.equal(await status('/probe/operator', { cookie: adminCookie }), 200);

  assert.equal(await status('/probe/operator'), 401);
  assert.equal(await status('/probe/operator', { cookie }), 403);
  assert.equal(await status('/probe/operator', { cookie: 'session=forged' }), 401);
  assert.equal(await status('/probe/operator', { authorization: 'Bearer wrong-key' }), 401);
  assert.equal(await status('/probe/operator', { authorization: apiKey }), 401);
  assert.equal(await status('/probe/operator', { authorization: `Basic ${apiKey}` }), 401);
  // A wrong key is no key, whatever cookie comes with it: the administrator does not get in by the cookie then.
  assert.equal(
    await status('/probe/operator', { authorization: 'Bearer wrong-key', cookie: adminCookie }),
    401,
  );
});

void test('without a configured key the operator routes stay closed to everyone', async (): Promise<void> => {
  const closed = await start(null, sessions);
  try {
    const response = await fetch(`${closed.baseUrl}/probe/operator`, {
      headers: { authorization: 'Bearer ' },
    });
    assert.equal(response.status, 401);
    assert.equal(
      (
        await fetch(`${closed.baseUrl}/probe/operator`, {
          headers: { authorization: 'Bearer null' },
        })
      ).status,
      401,
    );
  } finally {
    await closed.app.close();
  }
});
