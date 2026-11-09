import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppConfigParser } from './app-config.parser.js';

const parser = new AppConfigParser();

/** An environment with the database and the given variables, as pairs: their names are not ours to case. */
function env(...entries: Array<[string, string]>): NodeJS.ProcessEnv {
  return Object.fromEntries([['DATABASE_URL', 'postgresql://localhost:5432/hub'], ...entries]);
}

void test('defaults to a hub on localhost that logs in to /auth/me and has no provider set up', (): void => {
  const config = parser.parse(env());

  assert.equal(config.publicUrl, 'http://localhost:3000');
  assert.equal(config.authSuccessRedirect, '/auth/me');
  assert.equal(config.googleOauth, null);
  assert.equal(config.githubOauth, null);
  assert.equal(config.operatorApiKey, null);
});

void test('sets a provider up with both the id and the secret of its OAuth app, and treats empty values as unset', (): void => {
  const config = parser.parse(
    env(
      ['GOOGLE_CLIENT_ID', 'google-id'],
      ['GOOGLE_CLIENT_SECRET', 'google-secret'],
      ['GITHUB_CLIENT_ID', ''],
      ['GITHUB_CLIENT_SECRET', ''],
    ),
  );

  assert.deepEqual(config.googleOauth, { clientId: 'google-id', clientSecret: 'google-secret' });
  assert.equal(config.githubOauth, null);
});

void test('reports half of an OAuth app instead of silently leaving the login off', (): void => {
  assert.throws(() => parser.parse(env(['GITHUB_CLIENT_ID', 'github-id'])));
  assert.throws(() => parser.parse(env(['GITHUB_CLIENT_SECRET', 'github-secret'])));
});

void test('builds the callbacks from the public URL without a trailing slash', (): void => {
  assert.equal(
    parser.parse(env(['PUBLIC_URL', 'https://hub.example.com/'])).publicUrl,
    'https://hub.example.com',
  );
  assert.throws(() => parser.parse(env(['PUBLIC_URL', 'ftp://hub.example.com'])));
});

void test('lands the user on a path of the hub only: a login must not be sent anywhere else', (): void => {
  assert.equal(parser.parse(env(['AUTH_SUCCESS_REDIRECT', '/docs'])).authSuccessRedirect, '/docs');

  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example', 'docs']) {
    assert.throws(() => parser.parse(env(['AUTH_SUCCESS_REDIRECT', target])), target);
  }
});

void test('takes the origins that may write to the hub besides itself, as a browser writes them', (): void => {
  assert.deepEqual(parser.parse(env()).authAllowedOrigins, []);
  assert.deepEqual(
    parser.parse(env(['AUTH_ALLOWED_ORIGINS', 'https://app.example.com, http://localhost:5173']))
      .authAllowedOrigins,
    ['https://app.example.com', 'http://localhost:5173'],
  );

  for (const origin of [
    'app.example.com',
    'https://app.example.com/',
    'https://app.example.com/path',
    '*',
  ]) {
    assert.throws(() => parser.parse(env(['AUTH_ALLOWED_ORIGINS', origin])), origin);
  }
});

void test('trusts no proxy unless told how many stand in front of the hub', (): void => {
  assert.equal(parser.parse(env()).trustProxy, 0);
  assert.equal(parser.parse(env(['TRUST_PROXY', '1'])).trustProxy, 1);
  assert.throws(() => parser.parse(env(['TRUST_PROXY', 'true'])));
  assert.throws(() => parser.parse(env(['TRUST_PROXY', '-1'])));
});

void test('sends mail through the SMTP service it is given, and writes it to the log with none', (): void => {
  assert.equal(parser.parse(env()).smtpUrl, null);
  assert.equal(parser.parse(env(['SMTP_URL', ''])).smtpUrl, null);
  assert.equal(
    parser.parse(env(['SMTP_URL', 'smtp://user:secret@mail.example.com:587'])).smtpUrl,
    'smtp://user:secret@mail.example.com:587',
  );
  assert.throws(() => parser.parse(env(['SMTP_URL', 'http://mail.example.com'])));
  assert.equal(parser.parse(env()).emailVerificationTtlMs, 86_400_000);
});

void test('reads a price again 50 minutes after its last read, looking every minute, and 0 turns it off', (): void => {
  const config = parser.parse(env());

  assert.equal(config.priceRefreshAfterMs, 50 * 60_000);
  assert.equal(config.priceRefreshPollMs, 60_000);
  assert.equal(config.priceRefreshBatchSize, 200);
  assert.equal(config.priceRefreshCohortMs, 10 * 60_000);
  assert.equal(
    parser.parse(env(['PRICE_REFRESH_AFTER_MS', '900000'])).priceRefreshAfterMs,
    900_000,
  );
  assert.equal(parser.parse(env(['PRICE_REFRESH_AFTER_MS', '0'])).priceRefreshAfterMs, 0);
  assert.equal(parser.parse(env(['PRICE_REFRESH_POLL_MS', '5000'])).priceRefreshPollMs, 5000);
  assert.throws(() => parser.parse(env(['PRICE_REFRESH_AFTER_MS', '-1'])));
  assert.throws(() => parser.parse(env(['PRICE_REFRESH_POLL_MS', '10'])));
});

void test('starts the jobs of one proxy 30 seconds apart, which can be changed', (): void => {
  assert.equal(parser.parse(env()).priceProxyLagMs, 30_000);
  assert.equal(parser.parse(env(['PRICE_PROXY_LAG_MS', '5000'])).priceProxyLagMs, 5000);
  assert.throws(() => parser.parse(env(['PRICE_PROXY_LAG_MS', '-1'])));
});

void test('refreshes the proxies 10 minutes after the last refresh ended, of 200 candidates a source, and 0 turns it off', (): void => {
  const config = parser.parse(env());

  assert.equal(config.proxyRefreshPauseMinutes, 10);
  assert.equal(config.proxyRefreshMaxCandidates, 200);
  assert.equal(config.proxyRefreshProbeTimeoutMs, 10000);
  assert.equal(
    parser.parse(env(['PROXY_REFRESH_PAUSE_MINUTES', '15'])).proxyRefreshPauseMinutes,
    15,
  );
  assert.equal(parser.parse(env(['PROXY_REFRESH_PAUSE_MINUTES', '0'])).proxyRefreshPauseMinutes, 0);
  assert.throws(() => parser.parse(env(['PROXY_REFRESH_PAUSE_MINUTES', '-1'])));
});

void test('takes the administrators of the hub from a list of emails, normalized', (): void => {
  assert.deepEqual(parser.parse(env()).adminEmails, []);
  assert.deepEqual(
    parser.parse(env(['ADMIN_EMAILS', ' Boss@Example.com , second@example.com,'])).adminEmails,
    ['boss@example.com', 'second@example.com'],
  );
  assert.throws(() => parser.parse(env(['ADMIN_EMAILS', 'not an email'])));
});

void test('serves no admin panel unless a directory of the built one is given', (): void => {
  assert.equal(parser.parse(env()).adminUiDir, null);
  assert.equal(parser.parse(env(['ADMIN_UI_DIR', ''])).adminUiDir, null);
  assert.equal(parser.parse(env(['ADMIN_UI_DIR', '/app/panel'])).adminUiDir, '/app/panel');
  assert.equal(parser.parse(env()).clientUiDir, null);
  assert.equal(parser.parse(env(['CLIENT_UI_DIR', '/app/client'])).clientUiDir, '/app/client');
});

void test('keeps the pictures in S3 when it has an endpoint and keys, with defaults for the rest', (): void => {
  assert.equal(parser.parse(env()).s3, null);

  const config = parser.parse(
    env(
      ['S3_ENDPOINT', 'http://minio:9000'],
      ['S3_ACCESS_KEY_ID', 'key'],
      ['S3_SECRET_ACCESS_KEY', 'secret'],
    ),
  );
  assert.deepEqual(config.s3, {
    endpoint: 'http://minio:9000',
    publicUrl: 'http://minio:9000',
    region: 'us-east-1',
    bucket: 'thumbnails',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });

  const custom = parser.parse(
    env(
      ['S3_ENDPOINT', 'http://minio:9000'],
      ['S3_PUBLIC_URL', 'https://files.example.com'],
      ['S3_BUCKET', 'pictures'],
      ['S3_REGION', 'ru-central1'],
      ['S3_ACCESS_KEY_ID', 'key'],
      ['S3_SECRET_ACCESS_KEY', 'secret'],
    ),
  );
  const { s3 } = custom;
  assert.ok(s3);
  assert.equal(s3.publicUrl, 'https://files.example.com');
  assert.equal(s3.bucket, 'pictures');
  assert.equal(s3.region, 'ru-central1');

  // An endpoint without keys is a mistake to report.
  assert.throws(() => parser.parse(env(['S3_ENDPOINT', 'http://minio:9000'])));
});

void test('sends a user whose login through a provider failed to a page of the app, when it is told which', (): void => {
  assert.equal(parser.parse(env()).authFailureRedirect, null);
  assert.equal(parser.parse(env(['AUTH_FAILURE_REDIRECT', ''])).authFailureRedirect, null);
  assert.equal(
    parser.parse(env(['AUTH_FAILURE_REDIRECT', '/app/login'])).authFailureRedirect,
    '/app/login',
  );
  // A page of the hub, not another host.
  assert.throws(() => parser.parse(env(['AUTH_FAILURE_REDIRECT', '//evil.example'])));
  assert.throws(() => parser.parse(env(['AUTH_FAILURE_REDIRECT', 'https://evil.example/'])));
});
