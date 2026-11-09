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
import { SendEmailVerificationUseCase } from '../../account/application/send-email-verification.use-case.js';
import { VerifyEmailUseCase } from '../../account/application/verify-email.use-case.js';
import { Argon2idPasswordHasherAdapter } from '../../account/infrastructure/argon2id-password-hasher.adapter.js';
import { InMemoryAccountRegistrationAdapter } from '../../account/infrastructure/in-memory-account-registration.adapter.js';
import { InMemoryCredentialRepositoryAdapter } from '../../account/infrastructure/in-memory-credential-repository.adapter.js';
import { InMemoryEmailVerificationRepositoryAdapter } from '../../account/infrastructure/in-memory-email-verification-repository.adapter.js';
import { InMemoryUserRepositoryAdapter } from '../../account/infrastructure/in-memory-user-repository.adapter.js';
import { EndAuthSessionUseCase } from '../../auth-session/application/end-auth-session.use-case.js';
import { ListAuthSessionsUseCase } from '../../auth-session/application/list-auth-sessions.use-case.js';
import { ResolveAuthSessionUseCase } from '../../auth-session/application/resolve-auth-session.use-case.js';
import { RevokeAuthSessionUseCase } from '../../auth-session/application/revoke-auth-session.use-case.js';
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
import { LogInUseCase } from '../application/log-in.use-case.js';
import { ResendEmailVerificationUseCase } from '../application/resend-email-verification.use-case.js';
import { SignUpUseCase } from '../application/sign-up.use-case.js';
import { AccessGuard } from './access.guard.js';
import { AuthController } from './auth.controller.js';
import { authResponseSchema, authSessionsResponseSchema } from './auth.type.js';
import { AuthSessionsController } from './auth-sessions.controller.js';
import { EmailVerificationController } from './email-verification.controller.js';
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
  publicUrl: 'http://localhost:3000',
  authAllowedOrigins: [],
  authSuccessRedirect: '/auth/me',
  authFailureRedirect: null,
  googleOauth: null,
  githubOauth: null,
  adminEmails: ['boss@example.com'],
  adminUiDir: null,
  s3: null,
  clientUiDir: null,
  operatorApiKey: null,
  authCookieSecure: true,
  logLevel: 'error',
};

/** Every mail the hubs of these tests send. */
const mailbox = new InMemoryMailerAdapter();

let app: INestApplication;
let baseUrl: string;

/** The hub with the given limits of the logins and the sign-ups of one address. */
async function createApp(attempts: number): Promise<INestApplication> {
  const users = new InMemoryUserRepositoryAdapter();
  const credentials = new InMemoryCredentialRepositoryAdapter();
  const sessions = new InMemoryAuthSessionRepositoryAdapter();
  const policy = { idleTtlMs: 60_000, absoluteTtlMs: 120_000 };
  // The cheapest cost argon2 allows: the tests are about the flow, not the hardness.
  const hasher = new Argon2idPasswordHasherAdapter({ memoryKib: 64, passes: 1, parallelism: 1 });
  const startSession = new StartAuthSessionUseCase(sessions, policy);
  const limiter = new InMemoryRateLimiterAdapter();
  const mailer = mailbox;
  const verifications = new InMemoryEmailVerificationRepositoryAdapter();
  const register = new RegisterAccountUseCase(
    new InMemoryAccountRegistrationAdapter(users, credentials),
    hasher,
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController, AuthSessionsController, EmailVerificationController],
    providers: [
      { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
      { provide: APP_FILTER, useClass: ApplicationErrorFilter },
      { provide: APP_CONFIG, useValue: config },
      {
        provide: SignUpUseCase,
        useValue: new SignUpUseCase(
          register,
          new SendEmailVerificationUseCase(users, verifications, mailer, {
            linkBase: 'http://localhost:3000',
            ttlMs: 60_000,
          }),
          new NotifyExistingAccountUseCase(mailer),
          limiter,
          {
            register: { limit: attempts, windowMs: 60_000 },
            notice: { limit: attempts, windowMs: 60_000 },
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
            perEmailAndIp: { limit: attempts, windowMs: 60_000 },
            perEmail: { limit: attempts, windowMs: 60_000 },
            perIp: { limit: attempts, windowMs: 60_000 },
          },
        ),
      },
      { provide: EndAuthSessionUseCase, useValue: new EndAuthSessionUseCase(sessions) },
      { provide: ListAuthSessionsUseCase, useValue: new ListAuthSessionsUseCase(sessions) },
      { provide: RevokeAuthSessionUseCase, useValue: new RevokeAuthSessionUseCase(sessions) },
      {
        provide: RevokeOtherAuthSessionsUseCase,
        useValue: new RevokeOtherAuthSessionsUseCase(sessions),
      },
      {
        provide: ResolveAuthSessionUseCase,
        useValue: new ResolveAuthSessionUseCase(sessions, policy),
      },
      { provide: GetAccountUseCase, useValue: new GetAccountUseCase(users) },
      { provide: VerifyEmailUseCase, useValue: new VerifyEmailUseCase(users, verifications) },
      {
        provide: ResendEmailVerificationUseCase,
        useValue: new ResendEmailVerificationUseCase(
          new SendEmailVerificationUseCase(users, verifications, mailer, {
            linkBase: 'http://localhost:3000',
            ttlMs: 60_000,
          }),
          limiter,
          { limit: 3, windowMs: 60_000 },
        ),
      },
      {
        provide: ChangePasswordUseCase,
        useValue: new ChangePasswordUseCase(
          new ChangeAccountPasswordUseCase(credentials, hasher),
          new RevokeOtherAuthSessionsUseCase(sessions),
          limiter,
          { limit: attempts, windowMs: 60_000 },
        ),
      },
      SessionCookieParser,
      { provide: APP_GUARD, useClass: AccessGuard },
    ],
  }).compile();

  const created = moduleRef.createNestApplication();
  await created.listen(0);

  return created;
}

before(async (): Promise<void> => {
  app = await createApp(1000);
  baseUrl = await app.getUrl();
});

after(async (): Promise<void> => {
  await app.close();
});

interface ReplyInterface {
  status: number;
  body: unknown;
  setCookie: string[];
}

async function call(path: string, init: RequestInit = {}): Promise<ReplyInterface> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  const body: unknown = text === '' ? null : JSON.parse(text);

  return { status: response.status, body, setCookie: response.headers.getSetCookie() };
}

function post(path: string, body: unknown, cookie?: string): Promise<ReplyInterface> {
  return call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify(body),
  });
}

function me(cookie?: string): Promise<ReplyInterface> {
  return call('/auth/me', cookie === undefined ? {} : { headers: { cookie } });
}

/** The `name=value` pair of the cookie a reply sets, to send it back. */
function cookieOf(reply: ReplyInterface): string {
  const pair = reply.setCookie[0]?.split(';')[0];
  assert.ok(pair !== undefined);

  return pair;
}

/** Signs a user up and logs them in: a sign-up gives no session, the login after it does. */
async function signUp(email: string, password = 'secret-pass'): Promise<string> {
  const registered = await post('/auth/register', { email, password });
  assert.equal(registered.status, 202);

  return login(email, 'Firefox', password);
}

const jane = { email: 'Jane@Example.com', password: 'secret-pass' };
const notSignedIn = { statusCode: 401, message: 'Sign in first' };
const wrongLogin = { statusCode: 401, message: 'The email or the password is wrong' };

void test('accepts a sign-up without a session: the user logs in after it, into a hardened cookie', async (): Promise<void> => {
  const reply = await post('/auth/register', jane);

  assert.equal(reply.status, 202);
  assert.deepEqual(reply.body, { accepted: true });
  assert.equal(reply.setCookie.length, 0);

  const loggedIn = await post('/auth/login', jane);
  assert.equal(loggedIn.status, 200);
  const { user } = authResponseSchema.parse(loggedIn.body);
  assert.equal(user.email, 'jane@example.com');

  assert.equal(loggedIn.setCookie.length, 1);
  const attributes = loggedIn.setCookie[0]?.split('; ') ?? [];
  assert.match(attributes[0] ?? '', /^session=[A-Za-z0-9_-]{43}$/);
  assert.ok(attributes.includes('HttpOnly'));
  assert.ok(attributes.includes('Secure'));
  assert.ok(attributes.includes('SameSite=Lax'));
  assert.ok(attributes.includes('Path=/'));
  assert.ok(attributes.some((attribute): boolean => attribute.startsWith('Expires=')));
});

void test('answers a sign-up with a taken email exactly as one with a free email, and keeps the first password', async (): Promise<void> => {
  const free = await post('/auth/register', { email: 'twin@example.com', password: 'first-pass' });
  const taken = await post('/auth/register', {
    email: 'TWIN@example.com',
    password: 'second-pass',
  });

  assert.equal(taken.status, free.status);
  assert.deepEqual(taken.body, free.body);
  assert.equal(taken.setCookie.length, 0);
  assert.equal(free.setCookie.length, 0);

  assert.equal(
    (await post('/auth/login', { email: 'twin@example.com', password: 'first-pass' })).status,
    200,
  );
  assert.equal(
    (await post('/auth/login', { email: 'twin@example.com', password: 'second-pass' })).status,
    401,
  );
});

void test('refuses a bad email and a short password', async (): Promise<void> => {
  assert.equal((await post('/auth/register', { ...jane, email: 'nope' })).status, 400);
  assert.equal((await post('/auth/register', { ...jane, password: 'short' })).status, 400);
});

void test('answers who the session cookie belongs to, and 401 without a live one', async (): Promise<void> => {
  const cookie = await signUp('sam@example.com');

  const own = await me(cookie);
  assert.equal(own.status, 200);
  assert.equal(authResponseSchema.parse(own.body).user.email, 'sam@example.com');

  const anonymous = await me();
  assert.equal(anonymous.status, 401);
  assert.deepEqual(anonymous.body, notSignedIn);

  const forged = await me('session=not-a-session');
  assert.equal(forged.status, 401);
  assert.deepEqual(forged.body, notSignedIn);
});

void test('logs in with the password into a new session; a wrong login tells nothing about why', async (): Promise<void> => {
  await signUp('ann@example.com');

  const first = await post('/auth/login', { email: 'ANN@example.com', password: 'secret-pass' });
  const second = await post('/auth/login', { email: 'ann@example.com', password: 'secret-pass' });
  assert.equal(first.status, 200);
  assert.equal(authResponseSchema.parse(first.body).user.email, 'ann@example.com');
  assert.notEqual(cookieOf(first), cookieOf(second));
  assert.equal((await me(cookieOf(first))).status, 200);
  assert.equal((await me(cookieOf(second))).status, 200);

  const wrongPassword = await post('/auth/login', {
    email: 'ann@example.com',
    password: 'wrong-pass',
  });
  const unknownEmail = await post('/auth/login', {
    email: 'nobody@example.com',
    password: 'secret-pass',
  });
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(wrongPassword.body, wrongLogin);
  assert.deepEqual(unknownEmail.body, wrongLogin);
  assert.equal(wrongPassword.setCookie.length, 0);
});

void test('logs out: the session is gone and the cookie is cleared; logging out twice is harmless', async (): Promise<void> => {
  const cookie = await signUp('bob@example.com');

  const first = await post('/auth/logout', {}, cookie);
  assert.equal(first.status, 204);
  assert.match(first.setCookie[0] ?? '', /^session=;/);
  assert.match(first.setCookie[0] ?? '', /Expires=Thu, 01 Jan 1970/);

  assert.equal((await me(cookie)).status, 401);
  assert.equal((await post('/auth/logout', {}, cookie)).status, 204);
  assert.equal((await post('/auth/logout', {})).status, 204);
});

void test('answers 429 with the time to wait once an address tries too often', async (): Promise<void> => {
  const limited = await createApp(2);
  try {
    const url = `${await limited.getUrl()}/auth/login`;
    const login = (): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'secret-pass' }),
      });

    assert.equal((await login()).status, 401);
    assert.equal((await login()).status, 401);

    const refused = await login();
    assert.equal(refused.status, 429);
    assert.match(refused.headers.get('retry-after') ?? '', /^[1-9]\d*$/);
    assert.deepEqual(await refused.json(), {
      statusCode: 429,
      message: 'Too many attempts: try again later',
    });
  } finally {
    await limited.close();
  }
});

async function login(email: string, userAgent: string, password = 'secret-pass'): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': userAgent },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const pair = response.headers.getSetCookie()[0]?.split(';')[0];
  assert.ok(pair !== undefined);

  return pair;
}

async function sessionsOf(cookie: string): Promise<ReplyInterface> {
  return call('/auth/sessions', { headers: { cookie } });
}

void test('lists the sessions of the user with where they come from, and marks the one asking', async (): Promise<void> => {
  const laptop = await signUp('dan@example.com');
  const phone = await login('dan@example.com', 'Safari Mobile');

  const reply = await sessionsOf(phone);

  assert.equal(reply.status, 200);
  const { sessions } = authSessionsResponseSchema.parse(reply.body);
  assert.equal(sessions.length, 2);
  assert.deepEqual(
    sessions.map((session): [string | null, boolean] => [session.userAgent, session.current]),
    [
      ['Safari Mobile', true],
      [sessions[1]?.userAgent ?? null, false],
    ],
  );
  assert.equal((await sessionsOf(laptop)).status, 200);
  assert.equal((await call('/auth/sessions')).status, 401);
});

void test('ends one session of the user by its id, the one asking included', async (): Promise<void> => {
  const laptop = await signUp('eve@example.com');
  const phone = await login('eve@example.com', 'Safari Mobile');
  const { sessions } = authSessionsResponseSchema.parse((await sessionsOf(laptop)).body);
  const other = sessions.find((session): boolean => !session.current);
  assert.ok(other !== undefined);

  const revoke = (id: string, cookie: string): Promise<Response> =>
    fetch(`${baseUrl}/auth/sessions/${id}`, { method: 'DELETE', headers: { cookie } });

  assert.equal((await revoke(other.id, laptop)).status, 204);
  assert.equal((await me(phone)).status, 401);
  assert.equal((await revoke(other.id, laptop)).status, 404);
  assert.equal((await revoke('not-an-id', laptop)).status, 400);

  const own = authSessionsResponseSchema.parse((await sessionsOf(laptop)).body).sessions[0];
  assert.ok(own !== undefined);
  assert.equal((await revoke(own.id, laptop)).status, 204);
  assert.equal((await me(laptop)).status, 401);
});

void test('does not end the session of somebody else', async (): Promise<void> => {
  const kim = await signUp('kim@example.com', 'secret-pass');
  const lee = await signUp('lee@example.com', 'secret-pass');
  const kimSession = authSessionsResponseSchema.parse((await sessionsOf(kim)).body).sessions[0];
  assert.ok(kimSession !== undefined);

  const response = await fetch(`${baseUrl}/auth/sessions/${kimSession.id}`, {
    method: 'DELETE',
    headers: { cookie: lee },
  });

  assert.equal(response.status, 404);
  assert.equal((await me(kim)).status, 200);
});

void test('ends every session but the one asking, and says how many', async (): Promise<void> => {
  const laptop = await signUp('zoe@example.com', 'secret-pass');
  const phone = await login('zoe@example.com', 'Safari Mobile');
  const tablet = await login('zoe@example.com', 'iPad');

  const response = await fetch(`${baseUrl}/auth/sessions`, {
    method: 'DELETE',
    headers: { cookie: laptop },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: 2 });
  assert.equal((await me(laptop)).status, 200);
  assert.equal((await me(phone)).status, 401);
  assert.equal((await me(tablet)).status, 401);
});

void test('changes the password with the current one, and signs out the other devices only', async (): Promise<void> => {
  const laptop = await signUp('ray@example.com', 'old-password');
  const phone = await login('ray@example.com', 'Safari Mobile', 'old-password');

  const changed = await post(
    '/auth/password',
    { currentPassword: 'old-password', newPassword: 'new-password' },
    laptop,
  );

  assert.equal(changed.status, 204);
  assert.equal((await me(laptop)).status, 200);
  assert.equal((await me(phone)).status, 401);
  assert.equal(
    (await post('/auth/login', { email: 'ray@example.com', password: 'old-password' })).status,
    401,
  );
  assert.equal(
    (await post('/auth/login', { email: 'ray@example.com', password: 'new-password' })).status,
    200,
  );
});

void test('does not change the password on a wrong current one or a weak new one, nor for the anonymous', async (): Promise<void> => {
  const cookie = await signUp('ivy@example.com', 'old-password');

  const wrong = await post(
    '/auth/password',
    { currentPassword: 'guess', newPassword: 'new-password' },
    cookie,
  );
  assert.equal(wrong.status, 400);
  assert.deepEqual(wrong.body, { statusCode: 400, message: 'The current password is wrong' });

  assert.equal(
    (
      await post(
        '/auth/password',
        { currentPassword: 'old-password', newPassword: 'short' },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await post('/auth/password', { currentPassword: 'old-password', newPassword: 'new-password' }))
      .status,
    401,
  );
  assert.equal(
    (await post('/auth/login', { email: 'ivy@example.com', password: 'old-password' })).status,
    200,
  );
});

/** The path of the link in the last mail to the address, as the user would follow it. */
function linkTo(email: string): string {
  const mail = mailbox.sent.findLast((message): boolean => message.to === email);
  assert.ok(mail, `no mail to ${email}`);
  const link = /https?:\/\/[^/\s]+(\/auth\/verify-email\?token=[A-Za-z0-9_-]+)/.exec(
    mail.text,
  )?.[1];
  assert.ok(link !== undefined, 'no link in the mail');

  return link;
}

void test('confirms the email through the link mailed at sign-up, and says so on the user', async (): Promise<void> => {
  const cookie = await signUp('vera@example.com');
  assert.equal(authResponseSchema.parse((await me(cookie)).body).user.emailVerified, false);

  const confirmed = await call(linkTo('vera@example.com'), { headers: { cookie } });

  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmed.body, { verified: true });
  assert.equal(authResponseSchema.parse((await me(cookie)).body).user.emailVerified, true);
  // A mail scanner may have opened the link first: opening it again is no error.
  assert.equal((await call(linkTo('vera@example.com'), { headers: { cookie } })).status, 200);
});

void test('does not confirm the email for whoever opens the link without the account: the mailbox is not the password', async (): Promise<void> => {
  const cookie = await signUp('ursula@example.com');
  const other = await signUp('victor@example.com');
  const link = linkTo('ursula@example.com');

  assert.equal((await call(link)).status, 401);
  assert.equal((await call(link, { headers: { cookie: other } })).status, 400);
  assert.equal(authResponseSchema.parse((await me(cookie)).body).user.emailVerified, false);
});

void test('sends whoever opens the link without a session to the login page, which finishes the confirmation', async (): Promise<void> => {
  await signUp('nora@example.com');
  const link = linkTo('nora@example.com');
  const token = new URL(link, baseUrl).searchParams.get('token') ?? '';

  config.authFailureRedirect = '/app/login';
  try {
    const reply = await fetch(`${baseUrl}${link}`, { redirect: 'manual' });

    assert.equal(reply.status, 302);
    assert.equal(reply.headers.get('location'), `/app/login?verify=${token}`);
  } finally {
    config.authFailureRedirect = null;
  }

  // Where the hub knows no login page, it says so as an API does.
  assert.equal((await call(link)).status, 401);
});

void test('refuses a link that is wrong', async (): Promise<void> => {
  const cookie = await signUp('rhea@example.com');

  assert.equal(
    (await call('/auth/verify-email?token=not-a-token', { headers: { cookie } })).status,
    400,
  );
  assert.equal((await call('/auth/verify-email', { headers: { cookie } })).status, 400);
});

void test('mails the link again to a signed-in user, the new link works and the old one does not', async (): Promise<void> => {
  const cookie = await signUp('wade@example.com');
  const oldLink = linkTo('wade@example.com');

  assert.equal((await post('/auth/verify-email/resend', {}, cookie)).status, 204);
  const newLink = linkTo('wade@example.com');

  assert.notEqual(newLink, oldLink);
  assert.equal((await call(oldLink, { headers: { cookie } })).status, 400);
  assert.equal((await call(newLink, { headers: { cookie } })).status, 200);
  assert.equal((await post('/auth/verify-email/resend', {})).status, 401);
});

void test('sends nothing more to an email that is confirmed, and does not let a user ask for mail without end', async (): Promise<void> => {
  const cookie = await signUp('xena@example.com');
  await call(linkTo('xena@example.com'), { headers: { cookie } });
  const before = mailbox.sent.length;

  assert.equal((await post('/auth/verify-email/resend', {}, cookie)).status, 204);
  assert.equal(mailbox.sent.length, before);

  const other = await signUp('yuri@example.com');
  for (let tries = 0; tries < 3; tries += 1) {
    assert.equal((await post('/auth/verify-email/resend', {}, other)).status, 204);
  }
  assert.equal((await post('/auth/verify-email/resend', {}, other)).status, 429);
});

void test('tells the holder of an email, not the one who signed up with it again', async (): Promise<void> => {
  await post('/auth/register', { email: 'zack@example.com', password: 'first-pass' });
  const before = mailbox.sent.length;

  const again = await post('/auth/register', {
    email: 'zack@example.com',
    password: 'second-pass',
  });

  assert.equal(again.status, 202);
  assert.deepEqual(again.body, { accepted: true });
  const notice = mailbox.sent.slice(before);
  assert.equal(notice.length, 1);
  const [mail] = notice;
  assert.ok(mail);
  assert.equal(mail.to, 'zack@example.com');
  assert.doesNotMatch(mail.text, /token=/);
});

void test('says that a user is an administrator only once their listed email is confirmed', async (): Promise<void> => {
  const cookie = await signUp('boss@example.com');
  const isAdmin = async (browserCookie: string): Promise<boolean> =>
    authResponseSchema.parse((await me(browserCookie)).body).user.isAdmin;

  assert.equal(await isAdmin(cookie), false);

  await call(linkTo('boss@example.com'), { headers: { cookie } });

  assert.equal(await isAdmin(cookie), true);
  assert.equal(
    authResponseSchema.parse((await me(await signUp('plain@example.com'))).body).user.isAdmin,
    false,
  );
});
