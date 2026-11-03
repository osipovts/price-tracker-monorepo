import { ConsoleLoggerAdapter, parseLogLevel } from 'logger';
import { type ProxyFetchResultType, queueNames } from 'queue-contract';
import { JobLifecycleReporter, QueueMessageParser, QueueWorkerRunner } from 'queue-worker';
import { z } from 'zod';

import type { ProxySourcePort } from './application/proxy-source.port.js';
import { RefreshProxySourceUseCase } from './application/refresh-proxy-source.use-case.js';
import { GeoIpProxyProbeAdapter } from './infrastructure/geo-ip-proxy-probe.adapter.js';
import { GeonodeProxyListParser } from './infrastructure/geonode-proxy-list.parser.js';
import { GeonodeSourceAdapter } from './infrastructure/geonode-source.adapter.js';
import { GithubFreeProxyListSourceAdapter } from './infrastructure/github-free-proxy-list-source.adapter.js';
import { MonosansProxyListParser } from './infrastructure/monosans-proxy-list.parser.js';
import { MonosansSourceAdapter } from './infrastructure/monosans-source.adapter.js';
import { ProxiflySourceAdapter } from './infrastructure/proxifly-source.adapter.js';
import { ProxyListParser } from './infrastructure/proxy-list.parser.js';
import { ProxyscrapeSourceAdapter } from './infrastructure/proxyscrape-source.adapter.js';
import { ProxyFetchController } from './presentation/proxy-fetch.controller.js';

const env = z
  .object({
    redisUrl: z.string().default('redis://localhost:6379'),
    probeConcurrency: z.coerce.number().int().min(1).max(500).default(50),
    resultBatchSize: z.coerce.number().int().min(1).max(500).default(100),
    jobConcurrency: z.coerce.number().int().min(1).max(10).default(1),
  })
  .parse({
    redisUrl: process.env['REDIS_URL'],
    probeConcurrency: process.env['PROBE_CONCURRENCY'],
    resultBatchSize: process.env['RESULT_BATCH_SIZE'],
    jobConcurrency: process.env['JOB_CONCURRENCY'],
  });
const logger = new ConsoleLoggerAdapter(
  parseLogLevel(process.env['LOG_LEVEL'], 'verbose'),
  'proxy-fetcher',
);

const runner = new QueueWorkerRunner<ProxyFetchResultType>(
  {
    redisUrl: env.redisUrl,
    jobsQueue: queueNames.proxyFetchJobs,
    resultsQueue: queueNames.proxyFetchResults,
    concurrency: env.jobConcurrency,
  },
  logger,
);
const publish = (message: ProxyFetchResultType): Promise<void> => runner.publish(message);

const proxyListParser = new ProxyListParser();
const probe = new GeoIpProxyProbeAdapter(undefined, logger.child('probe'));
const refreshSource = (source: ProxySourcePort): RefreshProxySourceUseCase =>
  new RefreshProxySourceUseCase(
    source,
    probe,
    env.probeConcurrency,
    env.resultBatchSize,
    logger.child('refresh'),
  );

const controller = new ProxyFetchController(
  {
    'github-free-proxy-list': refreshSource(
      new GithubFreeProxyListSourceAdapter(proxyListParser, logger.child('source')),
    ),
    proxifly: refreshSource(new ProxiflySourceAdapter(proxyListParser, logger.child('source'))),
    proxyscrape: refreshSource(
      new ProxyscrapeSourceAdapter(proxyListParser, logger.child('source')),
    ),
    geonode: refreshSource(
      new GeonodeSourceAdapter(new GeonodeProxyListParser(proxyListParser), logger.child('source')),
    ),
    monosans: refreshSource(
      new MonosansSourceAdapter(
        new MonosansProxyListParser(proxyListParser),
        logger.child('source'),
      ),
    ),
  },
  new QueueMessageParser(logger.child('controller')),
  new JobLifecycleReporter(publish, logger.child('controller')),
  publish,
  logger.child('controller'),
);

runner.start((data, signal, willRetry): Promise<void> =>
  controller.handle(data, signal, willRetry),
);
runner.stopOnSignals();
