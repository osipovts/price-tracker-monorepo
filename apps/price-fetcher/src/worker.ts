import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import { ConsoleLoggerAdapter, parseLogLevel } from 'logger';
import {
  CitilinkReferenceParser,
  DnsReferenceParser,
  OzonReferenceParser,
  OzonShortLinkParser,
  ResolveProductReferenceUseCase,
  WildberriesReferenceParser,
} from 'product-reference';
import { type PriceFetchResultType, queueNames } from 'queue-contract';
import { JobLifecycleReporter, QueueMessageParser, QueueWorkerRunner } from 'queue-worker';
import { z } from 'zod';

import { ExpandLinkUseCase } from './application/link/expand-link.use-case.js';
import { FetchPricesUseCase } from './application/product/fetch-prices.use-case.js';
import { CitilinkPageParser } from './infrastructure/citilink/citilink-page.parser.js';
import { CitilinkPlaywrightProductReaderAdapter } from './infrastructure/citilink/citilink-playwright-product-reader.adapter.js';
import { CitilinkProductParser } from './infrastructure/citilink/citilink-product.parser.js';
import { CitilinkStateParser } from './infrastructure/citilink/citilink-state.parser.js';
import { DnsCityCookieParser } from './infrastructure/dns/dns-city-cookie.parser.js';
import { DnsPageParser } from './infrastructure/dns/dns-page.parser.js';
import { DnsPlaywrightProductReaderAdapter } from './infrastructure/dns/dns-playwright-product-reader.adapter.js';
import { DnsProductParser } from './infrastructure/dns/dns-product.parser.js';
import { OzonChallengeParser } from './infrastructure/ozon/ozon-challenge.parser.js';
import { OzonPageParser } from './infrastructure/ozon/ozon-page.parser.js';
import { OzonPickupPointParser } from './infrastructure/ozon/ozon-pickup-point.parser.js';
import { OzonPlaywrightLinkExpanderAdapter } from './infrastructure/ozon/ozon-playwright-link-expander.adapter.js';
import {
  OzonPlaywrightProductReaderAdapter,
  type OzonReaderParsersInterface,
} from './infrastructure/ozon/ozon-playwright-product-reader.adapter.js';
import { OzonProductParser } from './infrastructure/ozon/ozon-product.parser.js';
import { MarketplaceProductReaderAdapter } from './infrastructure/product/marketplace-product-reader.adapter.js';
import { GeoIpPageParser } from './infrastructure/shared/geo-ip-page.parser.js';
import { ProxyExitChecker } from './infrastructure/shared/proxy-exit.checker.js';
import { TlsRouteProbeAdapter } from './infrastructure/shared/tls-route-probe.adapter.js';
import { WildberriesChallengeParser } from './infrastructure/wildberries/wildberries-challenge.parser.js';
import { WildberriesPageParser } from './infrastructure/wildberries/wildberries-page.parser.js';
import { WildberriesPlaywrightProductReaderAdapter } from './infrastructure/wildberries/wildberries-playwright-product-reader.adapter.js';
import { WildberriesProductParser } from './infrastructure/wildberries/wildberries-product.parser.js';
import { LinkExpandController } from './presentation/link/link-expand.controller.js';
import { PriceFetchController } from './presentation/product/price-fetch.controller.js';

const env = z
  .object({
    redisUrl: z.string().default('redis://localhost:6379'),
    headed: z.stringbool().default(true),
    browserPath: z.string().min(1).optional(),
    jobConcurrency: z.coerce.number().int().min(1).max(5).default(1),
    routeProbeTimeoutMs: z.coerce.number().int().min(1000).max(30_000).default(6000),
    wildberriesBatchLimit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .parse({
    redisUrl: process.env['REDIS_URL'],
    headed: process.env['HEADED'],
    browserPath: process.env['BROWSER_PATH'],
    jobConcurrency: process.env['JOB_CONCURRENCY'],
    routeProbeTimeoutMs: process.env['ROUTE_PROBE_TIMEOUT_MS'],
    wildberriesBatchLimit: process.env['WILDBERRIES_BATCH_LIMIT'],
  });

const logger = new ConsoleLoggerAdapter(
  parseLogLevel(process.env['LOG_LEVEL'], 'verbose'),
  'price-fetcher',
);

const options = new CamoufoxOptionsFactory();
logger.info(`Launching Camoufox (${env.headed ? 'with a window' : 'headless'})`);
const browser = await Camoufox({
  ...options.launch({
    headed: env.headed,
    ...(env.browserPath === undefined ? {} : { executablePath: env.browserPath }),
  }),
  // The runner closes the browser on a signal, after the job in progress.
  handleSIGINT: false,
  handleSIGTERM: false,
});
logger.info(`Firefox ${browser.version()} is running`);

let stopping = false;
browser.on('disconnected', (): void => {
  // Let the supervisor restart the worker instead of failing every job.
  if (stopping) return;

  logger.error('The browser disconnected; exiting');
  process.exit(1);
});

const runner = new QueueWorkerRunner<PriceFetchResultType>(
  {
    redisUrl: env.redisUrl,
    jobsQueue: queueNames.priceFetchJobs,
    resultsQueue: queueNames.priceFetchResults,
    concurrency: env.jobConcurrency,
  },
  logger,
);
const publish = (message: PriceFetchResultType): Promise<void> => runner.publish(message);

const expandRunner = new QueueWorkerRunner<never>(
  { redisUrl: env.redisUrl, jobsQueue: queueNames.linkExpandJobs, concurrency: env.jobConcurrency },
  logger,
);

const references = new OzonReferenceParser();
const dnsReferences = new DnsReferenceParser();
const wildberriesReferences = new WildberriesReferenceParser();
const citilinkReferences = new CitilinkReferenceParser();
const citilinkStates = new CitilinkStateParser();
// The exit of a proxy is checked once in a while for all the jobs, not by every job again.
const exits = new ProxyExitChecker(30 * 60_000);
const parsers: OzonReaderParsersInterface = {
  geoIp: new GeoIpPageParser(),
  pages: new OzonPageParser(),
  challenges: new OzonChallengeParser(),
  products: new OzonProductParser(references),
  pickupPoints: new OzonPickupPointParser(),
};
const controller = new PriceFetchController(
  new FetchPricesUseCase(
    new ResolveProductReferenceUseCase([
      references,
      dnsReferences,
      wildberriesReferences,
      citilinkReferences,
    ]),
    (timeoutMs): MarketplaceProductReaderAdapter => {
      const wildberries = new WildberriesPlaywrightProductReaderAdapter(
        browser,
        options,
        {
          geoIp: parsers.geoIp,
          pages: new WildberriesPageParser(),
          challenges: new WildberriesChallengeParser(),
          products: new WildberriesProductParser(wildberriesReferences),
        },
        timeoutMs,
        logger.child('wildberries'),
        exits,
      );

      return new MarketplaceProductReaderAdapter(
        {
          ozon: new OzonPlaywrightProductReaderAdapter(
            browser,
            options,
            parsers,
            timeoutMs,
            logger.child('ozon'),
            exits,
          ),
          dns: new DnsPlaywrightProductReaderAdapter(
            browser,
            options,
            {
              geoIp: parsers.geoIp,
              pages: new DnsPageParser(),
              products: new DnsProductParser(dnsReferences),
              cities: new DnsCityCookieParser(),
            },
            timeoutMs,
            logger.child('dns'),
            exits,
          ),
          wildberries,
          citilink: new CitilinkPlaywrightProductReaderAdapter(
            browser,
            options,
            {
              geoIp: parsers.geoIp,
              pages: new CitilinkPageParser(),
              states: citilinkStates,
              products: new CitilinkProductParser(citilinkReferences, citilinkStates),
            },
            timeoutMs,
            logger.child('citilink'),
            exits,
          ),
        },
        { wildberries },
      );
    },
    logger.child('prices'),
    {
      probe: new TlsRouteProbeAdapter(env.routeProbeTimeoutMs, logger.child('routes')),
      batchLimits: { wildberries: env.wildberriesBatchLimit },
    },
  ),
  new QueueMessageParser(logger.child('controller')),
  new JobLifecycleReporter(publish, logger.child('controller')),
  publish,
  logger.child('controller'),
);

const expandController = new LinkExpandController(
  new ExpandLinkUseCase(
    new OzonShortLinkParser(),
    new ResolveProductReferenceUseCase([references]),
    (timeoutMs): OzonPlaywrightLinkExpanderAdapter =>
      new OzonPlaywrightLinkExpanderAdapter(browser, options, timeoutMs, logger.child('ozon')),
    logger.child('links'),
  ),
  new QueueMessageParser(logger.child('links')),
  logger.child('links'),
);

expandRunner.start((data, signal): Promise<unknown> => expandController.handle(data, signal));
runner.start((data, signal, willRetry, retryWith): Promise<void> =>
  controller.handle(data, signal, willRetry, retryWith),
);
runner.stopOnSignals(async (): Promise<void> => {
  stopping = true;
  await expandRunner.close();
  await browser.close();
});
