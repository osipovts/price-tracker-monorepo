import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { dashboardResponseSchema } from '../admin/presentation/dashboard.type.js';
import { authResponseSchema, authSessionsResponseSchema } from '../auth/presentation/auth.type.js';
import { DockerStackAdapter, freePort } from './support/docker-stack.adapter.js';
import type { HttpClientAdapter } from './support/http-client.adapter.js';
import { type RunningHubInterface, startHub } from './support/hub-harness.js';
import { SmtpSinkAdapter, verificationLinkOf } from './support/smtp-sink.adapter.js';

/**
 * The hub as a person meets it: the whole application, a real Postgres and Redis, and the mail it sends
 * received over SMTP by a real server. Only the browser is a client of ours.
 */
const stack = new DockerStackAdapter();
const smtp = new SmtpSinkAdapter();
let hub: RunningHubInterface;

before(
  async (): Promise<void> => {
    const infrastructure = await stack.start();
    const smtpUrl = await smtp.start(await freePort());
    hub = await startHub({
      stack: infrastructure,
      smtpUrl,
      // Every test of this file signs up from the one address of the machine.
      env: { AUTH_REGISTER_MAX_ATTEMPTS: '100', ADMIN_EMAILS: 'boss@example.com' },
    });
  },
  { timeout: 120_000 },
);

after(
  async (): Promise<void> => {
    await hub.stop();
    await smtp.stop();
    await stack.stop();
  },
  { timeout: 60_000 },
);

async function signUpAndLogIn(
  browser: HttpClientAdapter,
  email: string,
  password = 'correct-horse',
): Promise<void> {
  assert.equal(
    (await browser.request('/auth/register', { json: { email, password } })).status,
    202,
  );
  assert.equal((await browser.request('/auth/login', { json: { email, password } })).status, 200);
}

async function me(
  browser: HttpClientAdapter,
): Promise<{ status: number; verified: boolean | null }> {
  const reply = await browser.request('/auth/me');

  return {
    status: reply.status,
    verified: reply.status === 200 ? authResponseSchema.parse(reply.body).user.emailVerified : null,
  };
}

void test('a user signs up, confirms the email from the mail that arrives, logs in and out', async (): Promise<void> => {
  const browser = hub.browser();

  const registered = await browser.request('/auth/register', {
    json: { email: 'jane@example.com', password: 'correct-horse' },
  });
  assert.equal(registered.status, 202);
  assert.deepEqual(registered.body, { accepted: true });
  assert.equal(browser.cookie('session'), undefined);

  const mail = await smtp.waitFor('jane@example.com');
  assert.equal(mail.subject, 'Confirm your email');

  await browser.request('/auth/login', {
    json: { email: 'jane@example.com', password: 'correct-horse' },
  });
  assert.notEqual(browser.cookie('session'), undefined);
  assert.deepEqual(await me(browser), { status: 200, verified: false });

  const confirmed = await browser.request(verificationLinkOf(mail));
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await me(browser), { status: 200, verified: true });

  assert.equal((await browser.request('/auth/logout', { method: 'POST', json: {} })).status, 204);
  assert.equal((await me(browser)).status, 401);
});

void test('signing up with a taken email looks the same to the one who does it, and tells the holder', async (): Promise<void> => {
  const holder = hub.browser();
  await signUpAndLogIn(holder, 'ann@example.com', 'first-pass-1');
  await smtp.waitFor('ann@example.com');

  const stranger = hub.browser();
  const again = await stranger.request('/auth/register', {
    json: { email: 'ANN@example.com', password: 'second-pass-2' },
  });
  assert.equal(again.status, 202);
  assert.deepEqual(again.body, { accepted: true });
  assert.equal(stranger.cookie('session'), undefined);

  const notice = await smtp.waitFor('ann@example.com', 1);
  assert.equal(notice.subject, 'Someone tried to sign up with your email');
  assert.doesNotMatch(notice.text, /token=/);

  // Again and again does not fill the mailbox of the holder.
  for (let tries = 0; tries < 3; tries += 1) {
    await stranger.request('/auth/register', {
      json: { email: 'ann@example.com', password: 'second-pass-2' },
    });
  }
  assert.equal(smtp.countTo('ann@example.com'), 2);

  // The account is as it was: the first password opens it, the stranger's does not.
  assert.equal(
    (
      await stranger.request('/auth/login', {
        json: { email: 'ann@example.com', password: 'second-pass-2' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await stranger.request('/auth/login', {
        json: { email: 'ann@example.com', password: 'first-pass-1' },
      })
    ).status,
    200,
  );
});

void test('a user sees the devices they are logged in on, and a changed password logs the others out', async (): Promise<void> => {
  const laptop = hub.browser();
  await signUpAndLogIn(laptop, 'dan@example.com', 'old-password-1');
  const phone = hub.browser();
  await phone.request('/auth/login', {
    json: { email: 'dan@example.com', password: 'old-password-1' },
    headers: { 'user-agent': 'Safari Mobile' },
  });

  const listed = authSessionsResponseSchema.parse((await laptop.request('/auth/sessions')).body);
  assert.equal(listed.sessions.length, 2);
  assert.equal(listed.sessions.filter((session): boolean => session.current).length, 1);

  const changed = await laptop.request('/auth/password', {
    json: { currentPassword: 'old-password-1', newPassword: 'new-password-2' },
  });
  assert.equal(changed.status, 204);

  assert.equal((await me(laptop)).status, 200);
  assert.equal((await me(phone)).status, 401);
  assert.equal(
    (
      await hub
        .browser()
        .request('/auth/login', { json: { email: 'dan@example.com', password: 'old-password-1' } })
    ).status,
    401,
  );
  assert.equal(
    (
      await hub
        .browser()
        .request('/auth/login', { json: { email: 'dan@example.com', password: 'new-password-2' } })
    ).status,
    200,
  );
});

void test('guessing a password stops after so many tries, which Redis counts for every instance of the hub', async (): Promise<void> => {
  await signUpAndLogIn(hub.browser(), 'eve@example.com', 'right-password-1');
  const attacker = hub.browser();
  const guess = (password: string): ReturnType<HttpClientAdapter['request']> =>
    attacker.request('/auth/login', { json: { email: 'eve@example.com', password } });

  for (let tries = 0; tries < 9; tries += 1) {
    assert.equal((await guess(`wrong-guess-${String(tries)}`)).status, 401);
  }

  // The login above and the nine wrong tries make ten: the next one is refused, even with the right password.
  const refused = await guess('right-password-1');
  assert.equal(refused.status, 429);
  assert.match(refused.headers.get('retry-after') ?? '', /^[1-9]\d*$/);
});

void test('a write that a browser makes from another origin is refused, a read is not', async (): Promise<void> => {
  const browser = hub.browser();
  await signUpAndLogIn(browser, 'fay@example.com');

  const foreign = await browser.request('/auth/password', {
    json: { currentPassword: 'correct-horse', newPassword: 'another-pass-1' },
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(foreign.status, 403);

  assert.equal(
    (
      await browser.request('/auth/login', {
        json: { email: 'fay@example.com', password: 'correct-horse' },
        headers: { origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal((await me(browser)).status, 200);
});

void test('an administrator of the list gets the operator routes once the email is confirmed by mail, a user never does', async (): Promise<void> => {
  const boss = hub.browser();
  await signUpAndLogIn(boss, 'boss@example.com');
  assert.deepEqual(await me(boss), { status: 200, verified: false });

  // Signed up with an email of the list, which nobody has proven yet: known, and forbidden.
  assert.equal((await boss.request('/proxies')).status, 403);

  await boss.request(verificationLinkOf(await smtp.waitFor('boss@example.com')));
  assert.equal((await boss.request('/proxies')).status, 200);
  assert.equal(authResponseSchema.parse((await boss.request('/auth/me')).body).user.isAdmin, true);

  // The dashboard is the figures of every context, read from the real database.
  const dashboard = dashboardResponseSchema.parse((await boss.request('/admin/dashboard')).body);
  assert.ok(dashboard.users.total >= 2);
  assert.equal(dashboard.users.verified >= 1, true);
  assert.deepEqual(dashboard.proxies, {
    total: 0,
    alive: 0,
    disabled: 0,
    averageLatencyMs: null,
    lastCheckedAt: null,
    bySource: [],
    usable: [
      { marketplace: 'ozon', count: 0 },
      { marketplace: 'dns', count: 0 },
      { marketplace: 'wildberries', count: 0 },
      { marketplace: 'citilink', count: 0 },
    ],
  });
  // Nothing is queued: the hub asks for the handbook of cities when it starts, but has no proxy to read it through.
  const none = { queued: 0, running: 0, retrying: 0, completed: 0, failed: 0 };
  assert.deepEqual(dashboard.jobs.lastDay, [
    { kind: 'proxy_fetch', ...none },
    { kind: 'price_fetch', ...none },
    { kind: 'handbook_fetch', ...none },
  ]);
  assert.deepEqual(dashboard.jobs.unfinished, { queued: 0, running: 0, retrying: 0, lost: 0 });
  assert.equal(dashboard.products.marketplaces.length, 4);

  const user = hub.browser();
  await signUpAndLogIn(user, 'plain@example.com');
  assert.equal((await user.request('/proxies')).status, 403);
  assert.equal((await user.request('/admin/dashboard')).status, 403);
  assert.equal((await hub.browser().request('/admin/dashboard')).status, 401);
  assert.equal(authResponseSchema.parse((await user.request('/auth/me')).body).user.isAdmin, false);
});
