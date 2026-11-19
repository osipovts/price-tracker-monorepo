import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Page, Response } from 'playwright';

import type { OauthProvidersType } from '../../auth/application/oauth-provider.port.js';
import { OAUTH_PROVIDERS } from '../../auth/auth.module.js';
import { AppModule } from '../../composition/app.module.js';
import { configureApplication } from '../../composition/configure-application.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import {
  IMAGE_DOWNLOADER,
  type ImageDownloaderPort,
} from '../../product/application/image-downloader.port.js';
import { ProxyEntity } from '../../proxy/domain/proxy.entity.js';
import { PrismaProxyRepositoryAdapter } from '../../proxy/infrastructure/prisma-proxy-repository.adapter.js';
import { type DockerStackInterface, freePort } from './docker-stack.adapter.js';
import { HttpClientAdapter } from './http-client.adapter.js';

export const operatorApiKey = 'e2e-operator-key-0123456789abcdef';

export interface HubOptionsInterface {
  stack: DockerStackInterface;
  /** The mail service the hub sends through; without one its mails go to its log. */
  smtpUrl?: string;
  /** The providers of the login, as adapters of the hub pointed at a provider the test runs. */
  oauthProviders?: OauthProvidersType;
  /** Downloads the pictures of products; the hub keeps to the open internet over HTTPS, which a marketplace run by a test is not. */
  imageDownloader?: ImageDownloaderPort;
  /** Settings of the hub on top of the defaults of the test. */
  env?: Record<string, string>;
}

export interface RunningHubInterface {
  baseUrl: string;
  /** A new browser: its own cookies. */
  browser: () => HttpClientAdapter;
  stop: () => Promise<void>;
}

/** The whole hub, as `index.ts` makes it, listening on a port of its own against the real Postgres and Redis. */
export async function startHub(options: HubOptionsInterface): Promise<RunningHubInterface> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;

  Object.assign(process.env, {
    DATABASE_URL: options.stack.databaseUrl,
    REDIS_URL: options.stack.redisUrl,
    PORT: String(port),
    PUBLIC_URL: baseUrl,
    HUB_API_KEY: operatorApiKey,
    // The tests speak plain HTTP: a Secure cookie would not come back.
    AUTH_COOKIE_SECURE: 'false',
    LOG_LEVEL: 'error',
    MAIL_FROM: 'Price Tracker <no-reply@hub.test>',
    // Off, unless a test asks for it: a refresh in the background would answer for what a test does.
    PRICE_REFRESH_AFTER_MS: '0',
    PROXY_REFRESH_PAUSE_MINUTES: '0',
    ...(options.smtpUrl === undefined ? {} : { SMTP_URL: options.smtpUrl }),
    ...(options.stack.s3 === undefined
      ? {}
      : {
          S3_ENDPOINT: options.stack.s3.endpoint,
          S3_ACCESS_KEY_ID: options.stack.s3.accessKeyId,
          S3_SECRET_ACCESS_KEY: options.stack.s3.secretAccessKey,
        }),
    ...options.env,
  });

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.oauthProviders !== undefined) {
    builder.overrideProvider(OAUTH_PROVIDERS).useValue(options.oauthProviders);
  }
  if (options.imageDownloader !== undefined) {
    builder.overrideProvider(IMAGE_DOWNLOADER).useValue(options.imageDownloader);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApplication(app);
  await app.listen(port, '127.0.0.1');

  return {
    baseUrl,
    browser: (): HttpClientAdapter => new HttpClientAdapter(baseUrl),
    stop: (): Promise<void> => app.close(),
  };
}

/** A connection to the database of the stack, for what a test sets up or looks at behind the hub's back. */
export function connectDatabase(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** Proxies that were found alive in Russia, as the proxy checker would leave them, with the real repository. */
export async function seedProxies(prisma: PrismaClient, servers: string[]): Promise<void> {
  await new PrismaProxyRepositoryAdapter(prisma).saveMany(
    servers.map(
      (server): ProxyEntity =>
        new ProxyEntity({
          server,
          source: 'github-free-proxy-list',
          country: 'RU',
          exitIp: null,
          alive: true,
          latencyMs: 120,
          checksTotal: 3,
          checksAlive: 3,
          lastCheckedAt: new Date(),
          lastSeenAt: new Date(),
          disabledAt: null,
          credentials: null,
        }),
    ),
  );
}

/** Polls until the check returns a value; throws what it last threw, or says it never did. */
export async function eventually<ResultType>(
  check: () => Promise<ResultType | null | undefined | false>,
  what: string,
  timeoutMs = 15_000,
): Promise<ResultType> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result !== null && result !== undefined && result !== false) return result;
    } catch (error: unknown) {
      last = error instanceof Error ? error.message : 'something was thrown';
    }
    await new Promise((resolve): void => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`Never saw ${what} in ${String(timeoutMs)} ms${last === '' ? '' : `: ${last}`}`);
}

/** Navigates to a URL, retrying if Chromium hits a transient Linux/Docker network-change notification. */
export async function openPage(
  page: Page,
  url: string,
  options?: Parameters<Page['goto']>[1],
): Promise<Response | null> {
  const attempts = 3;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await page.goto(url, options);

      return response;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('ERR_NETWORK_CHANGED') && attempt < attempts) {
        await new Promise((resolve): void => {
          setTimeout(resolve, 200 * attempt);
        });

        continue;
      }

      throw error;
    }
  }

  return null;
}
