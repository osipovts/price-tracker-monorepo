import { parseLogLevel } from 'logger';
import { z } from 'zod';

import type { AppConfigInterface } from '../application/app-config.interface.js';

/** Both the id and the secret of the OAuth app, or neither: half of them is a mistake to report. */
const oauthClientSchema = z
  .object({ clientId: z.string().min(1), clientSecret: z.string().min(1) })
  .nullable();

/** The S3 service is on when it has an endpoint; then the keys are needed, and the rest has defaults. */
const s3Schema = z
  .object({
    endpoint: z.url(),
    publicUrl: z.url(),
    region: z.string().min(1),
    bucket: z.string().min(3),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
  })
  .nullable();

/** A setting that is not given, or is empty, takes its default. */
function given(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value;
}

function s3Settings(env: NodeJS.ProcessEnv): Record<string, string | undefined> | null {
  const endpoint = env['S3_ENDPOINT'];
  if (endpoint === undefined || endpoint === '') return null;

  return {
    endpoint,
    publicUrl: given(env['S3_PUBLIC_URL'], endpoint),
    region: given(env['S3_REGION'], 'us-east-1'),
    bucket: given(env['S3_BUCKET'], 'thumbnails'),
    accessKeyId: env['S3_ACCESS_KEY_ID'],
    secretAccessKey: env['S3_SECRET_ACCESS_KEY'],
  };
}

function oauthClient(
  env: NodeJS.ProcessEnv,
  idName: string,
  secretName: string,
): { clientId?: string; clientSecret?: string } | null {
  const clientId = env[idName];
  const clientSecret = env[secretName];
  if ((clientId ?? '') === '' && (clientSecret ?? '') === '') return null;

  return {
    ...(clientId === undefined ? {} : { clientId }),
    ...(clientSecret === undefined ? {} : { clientSecret }),
  };
}

const configSchema = z.object({
  databaseUrl: z.string().min(1),
  redisUrl: z.string().min(1).default('redis://localhost:6379'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  priceProxyCount: z.coerce.number().int().min(1).max(20).default(5),
  priceTimeoutMs: z.coerce.number().int().min(1000).max(60000).default(30000),
  linkExpandTimeoutMs: z.coerce.number().int().min(1000).max(60000).default(15000),
  priceRefreshAfterMs: z.coerce
    .number()
    .int()
    .min(0)
    .default(50 * 60_000),
  priceRefreshPollMs: z.coerce.number().int().min(1000).default(60_000),
  priceProxyLagMs: z.coerce.number().int().min(0).default(30_000),
  priceRefreshBatchSize: z.coerce.number().int().min(1).max(5000).default(200),
  proxyRefreshPauseMinutes: z.coerce.number().int().min(0).default(10),
  proxyRefreshMaxCandidates: z.coerce.number().int().min(1).max(5000).default(200),
  proxyRefreshProbeTimeoutMs: z.coerce.number().int().min(1000).max(60000).default(10000),
  authSessionIdleTtlMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(14 * 24 * 3_600_000),
  authSessionAbsoluteTtlMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(30 * 24 * 3_600_000),
  smtpUrl: z.url({ protocol: /^smtps?$/ }).nullable(),
  mailFrom: z.string().min(3).default('Price Tracker <no-reply@localhost>'),
  emailVerificationTtlMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(24 * 60 * 60_000),
  authVerificationResendMaxAttempts: z.coerce.number().int().min(1).default(3),
  productsPerUserMax: z.coerce.number().int().min(1).default(100),
  productGroupItemsMax: z.coerce.number().int().min(1).default(5),
  productAddMaxAttempts: z.coerce.number().int().min(1).default(30),
  productAddWindowMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60 * 60_000),
  authSessionPurgeIntervalMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60 * 60_000),
  authRateLimitWindowMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60_000),
  authLoginMaxAttempts: z.coerce.number().int().min(1).default(10),
  authLoginMaxAttemptsPerEmail: z.coerce.number().int().min(1).default(100),
  authLoginMaxAttemptsPerIp: z.coerce.number().int().min(1).default(50),
  authRegisterMaxAttempts: z.coerce.number().int().min(1).default(5),
  trustProxy: z.coerce.number().int().min(0).max(10).default(0),
  publicUrl: z
    .url({ protocol: /^https?$/ })
    .default('http://localhost:3000')
    .transform((value): string => value.replace(/\/+$/, '')),
  // Origins, as a browser writes them in a header: a scheme, a host and maybe a port, no path.
  authAllowedOrigins: z
    .string()
    .default('')
    .transform((value): string[] =>
      value
        .split(',')
        .map((origin): string => origin.trim())
        .filter((origin): boolean => origin !== ''),
    )
    .pipe(
      z.array(
        z
          .url({ protocol: /^https?$/ })
          .refine((origin): boolean => new URL(origin).origin === origin),
      ),
    ),
  // A path of the hub: a full URL would let a login be sent anywhere.
  authSuccessRedirect: z
    .string()
    // Not `//host`, nor `/\host`: a browser reads a backslash as a slash.
    .regex(/^\/(?![/\\])/)
    .default('/auth/me'),
  authFailureRedirect: z
    .string()
    .regex(/^\/(?![/\\])/)
    .nullable(),
  googleOauth: oauthClientSchema,
  githubOauth: oauthClientSchema,
  adminEmails: z
    .string()
    .default('')
    .transform((value): string[] =>
      value
        .split(',')
        .map((email): string => email.trim().toLowerCase())
        .filter((email): boolean => email !== ''),
    )
    .pipe(z.array(z.email())),
  s3: s3Schema,
  adminUiDir: z.string().min(1).nullable(),
  clientUiDir: z.string().min(1).nullable(),
  operatorApiKey: z.string().min(16).nullable(),
  authCookieSecure: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value): boolean => value === 'true'),
});

export class AppConfigParser {
  parse(env: NodeJS.ProcessEnv): AppConfigInterface {
    return {
      ...configSchema.parse({
        databaseUrl: env['DATABASE_URL'],
        redisUrl: env['REDIS_URL'],
        port: env['PORT'],
        priceProxyCount: env['PRICE_PROXY_COUNT'],
        priceTimeoutMs: env['PRICE_TIMEOUT_MS'],
        linkExpandTimeoutMs: env['LINK_EXPAND_TIMEOUT_MS'],
        priceRefreshAfterMs: env['PRICE_REFRESH_AFTER_MS'],
        priceRefreshPollMs: env['PRICE_REFRESH_POLL_MS'],
        priceProxyLagMs: env['PRICE_PROXY_LAG_MS'],
        priceRefreshBatchSize: env['PRICE_REFRESH_BATCH_SIZE'],
        proxyRefreshPauseMinutes: env['PROXY_REFRESH_PAUSE_MINUTES'],
        proxyRefreshMaxCandidates: env['PROXY_REFRESH_MAX_CANDIDATES'],
        proxyRefreshProbeTimeoutMs: env['PROXY_REFRESH_PROBE_TIMEOUT_MS'],
        authSessionIdleTtlMs: env['AUTH_SESSION_IDLE_TTL_MS'],
        authSessionAbsoluteTtlMs: env['AUTH_SESSION_ABSOLUTE_TTL_MS'],
        authCookieSecure: env['AUTH_COOKIE_SECURE'],
        smtpUrl: env['SMTP_URL'] === '' ? null : (env['SMTP_URL'] ?? null),
        mailFrom: env['MAIL_FROM'],
        emailVerificationTtlMs: env['EMAIL_VERIFICATION_TTL_MS'],
        authVerificationResendMaxAttempts: env['AUTH_VERIFICATION_RESEND_MAX_ATTEMPTS'],
        productsPerUserMax: env['PRODUCTS_PER_USER_MAX'],
        productGroupItemsMax: env['PRODUCT_GROUP_ITEMS_MAX'],
        productAddMaxAttempts: env['PRODUCT_ADD_MAX_ATTEMPTS'],
        productAddWindowMs: env['PRODUCT_ADD_WINDOW_MS'],
        authSessionPurgeIntervalMs: env['AUTH_SESSION_PURGE_INTERVAL_MS'],
        authRateLimitWindowMs: env['AUTH_RATE_LIMIT_WINDOW_MS'],
        authLoginMaxAttempts: env['AUTH_LOGIN_MAX_ATTEMPTS'],
        authLoginMaxAttemptsPerEmail: env['AUTH_LOGIN_MAX_ATTEMPTS_PER_EMAIL'],
        authLoginMaxAttemptsPerIp: env['AUTH_LOGIN_MAX_ATTEMPTS_PER_IP'],
        authRegisterMaxAttempts: env['AUTH_REGISTER_MAX_ATTEMPTS'],
        trustProxy: env['TRUST_PROXY'],
        publicUrl: env['PUBLIC_URL'],
        authAllowedOrigins: env['AUTH_ALLOWED_ORIGINS'],
        authSuccessRedirect: env['AUTH_SUCCESS_REDIRECT'],
        authFailureRedirect:
          env['AUTH_FAILURE_REDIRECT'] === undefined || env['AUTH_FAILURE_REDIRECT'] === ''
            ? null
            : env['AUTH_FAILURE_REDIRECT'],
        googleOauth: oauthClient(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
        githubOauth: oauthClient(env, 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'),
        adminEmails: env['ADMIN_EMAILS'],
        s3: s3Settings(env),
        adminUiDir: env['ADMIN_UI_DIR'] === '' ? null : (env['ADMIN_UI_DIR'] ?? null),
        clientUiDir: env['CLIENT_UI_DIR'] === '' ? null : (env['CLIENT_UI_DIR'] ?? null),
        operatorApiKey: env['HUB_API_KEY'] === '' ? null : (env['HUB_API_KEY'] ?? null),
      }),
      logLevel: parseLogLevel(env['LOG_LEVEL'], 'verbose'),
    };
  }
}
