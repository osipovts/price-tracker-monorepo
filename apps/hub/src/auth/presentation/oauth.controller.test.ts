import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { AuthenticateWithPasswordUseCase } from '../../account/application/authenticate-with-password.use-case.js';
import { ChangeAccountPasswordUseCase } from '../../account/application/change-account-password.use-case.js';
import { GetAccountUseCase } from '../../account/application/get-account.use-case.js';
import { NotifyExistingAccountUseCase } from '../../account/application/notify-existing-account.use-case.js';
import { RegisterAccountUseCase } from '../../account/application/register-account.use-case.js';
import { ResolveOauthAccountUseCase } from '../../account/application/resolve-oauth-account.use-case.js';
import { SendEmailVerificationUseCase } from '../../account/application/send-email-verification.use-case.js';
import { Argon2idPasswordHasherAdapter } from '../../account/infrastructure/argon2id-password-hasher.adapter.js';
import { InMemoryAccountRegistrationAdapter } from '../../account/infrastructure/in-memory-account-registration.adapter.js';
import { InMemoryCredentialRepositoryAdapter } from '../../account/infrastructure/in-memory-credential-repository.adapter.js';
import { InMemoryEmailVerificationRepositoryAdapter } from '../../account/infrastructure/in-memory-email-verification-repository.adapter.js';
import { InMemoryLinkedIdentityRepositoryAdapter } from '../../account/infrastructure/in-memory-linked-identity-repository.adapter.js';
import { InMemoryUserRepositoryAdapter } from '../../account/infrastructure/in-memory-user-repository.adapter.js';
import { EndAuthSessionUseCase } from '../../auth-session/application/end-auth-session.use-case.js';
import { ResolveAuthSessionUseCase } from '../../auth-session/application/resolve-auth-session.use-case.js';
import { RevokeOtherAuthSessionsUseCase } from '../../auth-session/application/revoke-other-auth-sessions.use-case.js';
import { StartAuthSessionUseCase } from '../../auth-session/application/start-auth-session.use-case.js';
import { InMemoryAuthSessionRepositoryAdapter } from '../../auth-session/infrastructure/in-memory-auth-session-repository.adapter.js';
import {
  APP_CONFIG,
  type AppConfigInterface,
} from '../../shared/application/app-config.interface.js';
import { InMemoryMailerAdapter } from '../../shared/infrastructure/in-memory-mailer.adapter.js';
import { InMemoryRateLimiterAdapter } from '../../shared/infrastructure/in-memory-rate-limiter.adapter.js';
import { ApplicationErrorFilter } from '../../shared/presentation/application-error.filter.js';
import { ChangePasswordUseCase } from '../application/change-password.use-case.js';
import { CompleteOauthLoginUseCase } from '../application/complete-oauth-login.use-case.js';
import { ListOauthProvidersUseCase } from '../application/list-oauth-providers.use-case.js';
import { LogInUseCase } from '../application/log-in.use-case.js';
import type { OauthProvidersType } from '../application/oauth-provider.port.js';
import { SignUpUseCase } from '../application/sign-up.use-case.js';
import { StartOauthLoginUseCase } from '../application/start-oauth-login.use-case.js';
import { FakeOauthProviderAdapter } from '../infrastructure/fake-oauth-provider.adapter.js';
import { AccessGuard } from './access.guard.js';
import { AuthController } from './auth.controller.js';
import { authResponseSchema } from './auth.type.js';
import { OauthController } from './oauth.controller.js';
import { OauthLoginCookieParser } from './oauth-login-cookie.parser.js';
import { SessionCookieParser } from './session-cookie.parser.js';

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
  proxyRefreshPauseMinutes: 10,
  proxyRefreshMaxCandidates: 200,
  proxyRefreshProbeTimeoutMs: 10000,
  authSessionIdleTtlMs: 60_000,
  authSessionAbsoluteTtlMs: 120_000,
  authCookieSecure: true,
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
  publicUrl: 'http://hub.test',
  authAllowedOrigins: [],
  authSuccessRedirect: '/auth/me',
  authFailureRedirect: null,
  googleOauth: null,
  githubOauth: null,
  adminEmails: [],
  adminUiDir: null,
  s3: null,
  clientUiDir: null,
  operatorApiKey: null,
  logLevel: 'error',
};

const google = new FakeOauthProviderAdapter();
let app: INestApplication;
let baseUrl: string;

before(async (): Promise<void> => {
  const users = new InMemoryUserRepositoryAdapter();
  const credentials = new InMemoryCredentialRepositoryAdapter();
  const identities = new InMemoryLinkedIdentityRepositoryAdapter();
  const sessions = new InMemoryAuthSessionRepositoryAdapter();
  const policy = { idleTtlMs: 60_000, absoluteTtlMs: 120_000 };
  const hasher = new Argon2idPasswordHasherAdapter({ memoryKib: 64, passes: 1, parallelism: 1 });
  const registration = new InMemoryAccountRegistrationAdapter(users, credentials, identities);
  const startSession = new StartAuthSessionUseCase(sessions, policy);
  const limiter = new InMemoryRateLimiterAdapter();
  const mailer = new InMemoryMailerAdapter();
  const verifications = new InMemoryEmailVerificationRepositoryAdapter();
  const providers: OauthProvidersType = new Map([['google', google]]);

  const moduleRef = await Test.createTestingModule({
    controllers: [OauthController, AuthController],
    providers: [
      { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
      { provide: APP_FILTER, useClass: ApplicationErrorFilter },
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_CONFIG, useValue: config },
      {
        provide: ListOauthProvidersUseCase,
        useValue: new ListOauthProvidersUseCase(providers),
      },
      {
        provide: StartOauthLoginUseCase,
        useValue: new StartOauthLoginUseCase(providers),
      },
      {
        provide: CompleteOauthLoginUseCase,
        useValue: new CompleteOauthLoginUseCase(
          providers,
          new ResolveOauthAccountUseCase(users, identities, registration),
          startSession,
          new RevokeOtherAuthSessionsUseCase(sessions),
        ),
      },
      {
        provide: SignUpUseCase,
        useValue: new SignUpUseCase(
          new RegisterAccountUseCase(registration, hasher),
          new SendEmailVerificationUseCase(users, verifications, mailer, {
            linkBase: 'http://localhost:3000',
            ttlMs: 60_000,
          }),
          new NotifyExistingAccountUseCase(mailer),
          limiter,
          {
            register: { limit: 1000, windowMs: 60_000 },
            notice: { limit: 1000, windowMs: 60_000 },
          },
        ),
      },
      {
        provide: LogInUseCase,
        useValue: new LogInUseCase(
          new AuthenticateWithPasswordUseCase(users, credentials, hasher),
          startSession,
          limiter,
          {
            perEmailAndIp: { limit: 1000, windowMs: 60_000 },
            perEmail: { limit: 1000, windowMs: 60_000 },
            perIp: { limit: 1000, windowMs: 60_000 },
          },
        ),
      },
      { provide: EndAuthSessionUseCase, useValue: new EndAuthSessionUseCase(sessions) },
      {
        provide: ResolveAuthSessionUseCase,
        useValue: new ResolveAuthSessionUseCase(sessions, policy),
      },
      { provide: GetAccountUseCase, useValue: new GetAccountUseCase(users) },
      {
        provide: ChangePasswordUseCase,
        useValue: new ChangePasswordUseCase(
          new ChangeAccountPasswordUseCase(credentials, hasher),
          new RevokeOtherAuthSessionsUseCase(sessions),
          limiter,
          { limit: 1000, windowMs: 60_000 },
        ),
      },
      SessionCookieParser,
      OauthLoginCookieParser,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.listen(0);
  baseUrl = await app.getUrl();
});

after(async (): Promise<void> => {
  await app.close();
});

interface ReplyInterface {
  status: number;
  location: string | null;
  setCookie: string[];
  body: unknown;
}

async function call(path: string, cookie?: string): Promise<ReplyInterface> {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
  const text = await response.text();
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const body: unknown = isJson ? JSON.parse(text) : null;

  return {
    status: response.status,
    location: response.headers.get('location'),
    setCookie: response.headers.getSetCookie(),
    body,
  };
}

function pairOf(reply: ReplyInterface, name: string): string {
  const pair = reply.setCookie
    .map((cookie): string => cookie.split(';')[0] ?? '')
    .find((item): boolean => item.startsWith(`${name}=`));
  assert.ok(pair !== undefined, `no ${name} cookie`);

  return pair;
}

/** Starts a login and returns what the browser would send to the callback: the cookie and the state. */
async function startLogin(): Promise<{ cookie: string; state: string }> {
  const started = await call('/auth/oauth/google/start');
  assert.ok(started.location !== null);
  const state = new URL(started.location).searchParams.get('state');
  assert.ok(state !== null);

  return { cookie: pairOf(started, 'oauth_login'), state };
}

void test('sends the user to the provider and keeps the secret of the login in a short-lived cookie of the callback only', async (): Promise<void> => {
  const reply = await call('/auth/oauth/google/start');

  assert.equal(reply.status, 302);
  assert.ok(reply.location?.startsWith('https://provider.test/authorize?state=') === true);
  const attributes = reply.setCookie[0]?.split('; ') ?? [];
  assert.match(attributes[0] ?? '', /^oauth_login=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.ok(attributes.includes('HttpOnly'));
  assert.ok(attributes.includes('Secure'));
  assert.ok(attributes.includes('SameSite=Lax'));
  assert.ok(attributes.includes('Path=/auth/oauth'));
  assert.ok(attributes.includes('Max-Age=600'));
});

void test('logs the user in when the provider sends them back: a session cookie, the secret one cleared, the user landed', async (): Promise<void> => {
  const { cookie, state } = await startLogin();

  const reply = await call(`/auth/oauth/google/callback?code=good-code&state=${state}`, cookie);

  assert.equal(reply.status, 302);
  assert.equal(reply.location, '/auth/me');
  assert.match(pairOf(reply, 'session'), /^session=[A-Za-z0-9_-]{43}$/);
  assert.match(
    reply.setCookie.find((item): boolean => item.startsWith('oauth_login=;')) ?? '',
    /Path=\/auth\/oauth/,
  );

  const me = await call('/auth/me', pairOf(reply, 'session'));
  assert.equal(me.status, 200);
  assert.equal(authResponseSchema.parse(me.body).user.email, 'jane@example.com');
});

void test('refuses a callback that does not answer a login of this browser, and starts no session', async (): Promise<void> => {
  const { cookie, state } = await startLogin();
  const answers: Array<[string, string | undefined]> = [
    [`/auth/oauth/google/callback?code=good-code&state=forged`, cookie],
    [`/auth/oauth/google/callback?code=good-code&state=${state}`, undefined],
    [`/auth/oauth/google/callback?code=good-code&state=${state}`, 'oauth_login=garbage'],
    [`/auth/oauth/google/callback?state=${state}`, cookie],
    [`/auth/oauth/google/callback?error=access_denied&state=${state}`, cookie],
    [`/auth/oauth/google/callback?code=bad-code&state=${state}`, cookie],
  ];

  for (const [path, sent] of answers) {
    const reply = await call(path, sent);
    assert.equal(reply.status, 401, path);
    assert.ok(!reply.setCookie.some((item): boolean => item.startsWith('session=')), path);
  }
});

void test('knows only the providers that are set up', async (): Promise<void> => {
  assert.equal((await call('/auth/oauth/github/start')).status, 404);
  assert.equal((await call('/auth/oauth/facebook/start')).status, 400);
});

void test('names the providers that are set up, to everybody', async (): Promise<void> => {
  const reply = await call('/auth/oauth/providers');

  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, { providers: ['google'] });
});

void test('sends a user whose login failed back to the page of the app when there is one, and shows the error when there is none', async (): Promise<void> => {
  const { cookie, state } = await startLogin();
  const failing = `/auth/oauth/google/callback?error=access_denied&state=${state}`;

  config.authFailureRedirect = '/app/login';
  try {
    const reply = await call(failing, cookie);

    assert.equal(reply.status, 302);
    assert.equal(reply.location, '/app/login?error=oauth');
    assert.ok(!reply.setCookie.some((item): boolean => item.startsWith('session=')));
  } finally {
    config.authFailureRedirect = null;
  }

  // The error of a request that did not come from a login of this browser is an error still, for an API.
  assert.equal((await call(failing, cookie)).status, 401);
});

void test('gives a password account of an email to the provider that proves it, and ends the way in of whoever signed up with it', async (): Promise<void> => {
  const credentials = JSON.stringify({ email: 'sam@example.com', password: 'squatter-pass' });
  const headers = { 'content-type': 'application/json' };
  await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers, body: credentials });
  const loggedIn = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers,
    body: credentials,
  });
  const squatterCookie = loggedIn.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  assert.equal((await call('/auth/me', squatterCookie)).status, 200);
  google.profile = { subject: '2002', email: 'sam@example.com', emailVerified: true };
  const { cookie, state } = await startLogin();

  const reply = await call(`/auth/oauth/google/callback?code=good-code&state=${state}`, cookie);

  assert.equal(reply.status, 302);
  assert.equal((await call('/auth/me', squatterCookie)).status, 401);
  const owner = await call('/auth/me', pairOf(reply, 'session'));
  assert.equal(authResponseSchema.parse(owner.body).user.email, 'sam@example.com');

  const password = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'sam@example.com', password: 'squatter-pass' }),
  });
  assert.equal(password.status, 401);
});

void test('refuses a provider that does not vouch for the email', async (): Promise<void> => {
  google.profile = { subject: '3003', email: 'new@example.com', emailVerified: false };
  const { cookie, state } = await startLogin();

  const reply = await call(`/auth/oauth/google/callback?code=good-code&state=${state}`, cookie);

  assert.equal(reply.status, 401);
});
