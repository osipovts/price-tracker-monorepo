import type { LogLevelType } from 'logger';

export const APP_CONFIG = Symbol('AppConfig');

export interface OauthClientConfigInterface {
  clientId: string;
  clientSecret: string;
}

export interface ObjectStorageConfigInterface {
  /** Where the hub reaches the S3 service. */
  endpoint: string;
  /** Where a browser reaches it: the addresses of the files it is given are signed for this one. */
  publicUrl: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface AppConfigInterface {
  databaseUrl: string;
  redisUrl: string;
  port: number;
  /** How many of the best proxies a price fetch job may try. */
  priceProxyCount: number;
  priceTimeoutMs: number;
  /** How long each route may take to expand a short link; a person waits for it. */
  linkExpandTimeoutMs: number;
  /** A session that is not used for this long ends. */
  authSessionIdleTtlMs: number;
  /** A session ends this long after the login however active it is. */
  authSessionAbsoluteTtlMs: number;
  /** Whether the session cookie goes over HTTPS only. */
  authCookieSecure: boolean;
  /** How many products a user may track. */
  productsPerUserMax: number;
  /** How many products one group may hold. */
  productGroupItemsMax: number;
  /** How many products a user may add per window, whatever the products. */
  productAddMaxAttempts: number;
  productAddWindowMs: number;
  /** The mail service, `smtp://user:password@host:587`; without one the mails are written to the log. */
  smtpUrl: string | null;
  /** The sender of the mails of the hub. */
  mailFrom: string;
  /** How long the link to confirm an email works. */
  emailVerificationTtlMs: number;
  /** Mails of the link to confirm an email, that a user may ask for per window. */
  authVerificationResendMaxAttempts: number;
  /** A product is read again once its last read or request is this old; 0 turns the refresh off. */
  priceRefreshAfterMs: number;
  /** How often the hub looks for the products that are due. */
  priceRefreshPollMs: number;
  /** The jobs that read one marketplace through one proxy start at least this far apart. */
  priceProxyLagMs: number;
  /** How many products one run of the refresh queues at most. */
  priceRefreshBatchSize: number;
  /** A price that would be due this much later is read with the due ones of its marketplace and city. */
  priceRefreshCohortMs: number;
  /** The pause, in minutes, between the end of a refresh of the proxies and the start of the next; 0 turns it off. */
  proxyRefreshPauseMinutes: number;
  /** Upper bound of the candidates a refresh takes from a source. */
  proxyRefreshMaxCandidates: number;
  /** Timeout of a single proxy check of a refresh, in milliseconds. */
  proxyRefreshProbeTimeoutMs: number;
  /** How often the sessions that ended are deleted. */
  authSessionPurgeIntervalMs: number;
  /** The window the attempts of logging in and signing up are counted in. */
  authRateLimitWindowMs: number;
  /** Logins of one email from one address per window; also the password changes of a user. */
  authLoginMaxAttempts: number;
  /** Logins of one email per window from all the addresses together: generous, against a lockout. */
  authLoginMaxAttemptsPerEmail: number;
  /** Logins from one address per window, of any emails: wider, as an address may be shared. */
  authLoginMaxAttemptsPerIp: number;
  /** Sign-ups from one address per window. */
  authRegisterMaxAttempts: number;
  /**
   * How many reverse proxies stand in front of the hub: 0 when clients reach it directly. Behind
   * one, the address of a client is read from X-Forwarded-For, which only a hop count can trust.
   */
  trustProxy: number;
  /** Where the hub is reached from outside: the providers send the user back here. */
  publicUrl: string;
  /** Origins besides the hub itself that may write to it, e.g. a frontend of another origin. */
  authAllowedOrigins: string[];
  /** Where the user lands after a login through a provider: a path of the hub. */
  authSuccessRedirect: string;
  /** Where the user lands when a login through a provider fails, with `?error=oauth`; the error is shown as it is without one. */
  authFailureRedirect: string | null;
  /** The OAuth app of Google; the login through it is off without one. */
  googleOauth: OauthClientConfigInterface | null;
  githubOauth: OauthClientConfigInterface | null;
  /** The emails of the administrators; one is an administrator once the email is proven to be theirs. */
  adminEmails: string[];
  /** The S3 service that keeps the pictures of the products; there are none without one. */
  s3: ObjectStorageConfigInterface | null;
  /** The built admin panel, served at `/panel`; there is no panel without one. */
  adminUiDir: string | null;
  /** The built client app, served at `/app`; there is no app without one. */
  clientUiDir: string | null;
  /** The key of the operator routes; without one they stay closed. */
  operatorApiKey: string | null;
  /** error, warn, info, debug or verbose. */
  logLevel: LogLevelType;
}
