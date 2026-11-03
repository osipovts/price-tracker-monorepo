import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  HandbookFetchRequestInterface,
  JobQueuePort,
} from '../../job/application/job-queue.port.js';
import { ScheduleJobUseCase } from '../../job/application/schedule-job.use-case.js';
import { InMemoryJobRepositoryAdapter } from '../../job/infrastructure/in-memory-job-repository.adapter.js';
import { ListBestProxyServersUseCase } from '../../proxy/application/list-best-proxy-servers.use-case.js';
import { ProxyEntity } from '../../proxy/domain/proxy.entity.js';
import { InMemoryProxyRepositoryAdapter } from '../../proxy/infrastructure/in-memory-proxy-repository.adapter.js';
import { InMemoryProxyReputationRepositoryAdapter } from '../../proxy/infrastructure/in-memory-proxy-reputation-repository.adapter.js';
import { systemClock } from '../../shared/application/clock.port.js';
import { NoProxiesAvailableError } from '../../shared/application/no-proxies-available.error.js';
import { RefreshHandbookUseCase } from './refresh-handbook.use-case.js';

const checkedAt = new Date('2026-11-01T10:00:00Z');
const proxy = (server: string, checksAlive: number): ProxyEntity =>
  new ProxyEntity({
    server,
    source: 'proxifly',
    country: 'RU',
    exitIp: null,
    alive: true,
    latencyMs: 100,
    checksTotal: 4,
    checksAlive,
    lastCheckedAt: checkedAt,
    lastSeenAt: checkedAt,
    disabledAt: null,
    credentials: null,
  });

async function setup(
  proxies: ProxyEntity[],
  count = 5,
): Promise<{
  refresh: RefreshHandbookUseCase;
  requests: HandbookFetchRequestInterface[];
  jobs: InMemoryJobRepositoryAdapter;
}> {
  const repository = new InMemoryProxyRepositoryAdapter();
  await repository.saveMany(proxies);
  const requests: HandbookFetchRequestInterface[] = [];
  const jobs = new InMemoryJobRepositoryAdapter();
  const queue: JobQueuePort = {
    enqueueProxyFetch: (): Promise<void> => Promise.resolve(),
    enqueuePriceFetch: (): Promise<void> => Promise.resolve(),
    enqueueHandbookFetch: (request): Promise<void> => {
      requests.push(request);

      return Promise.resolve();
    },
  };

  return {
    refresh: new RefreshHandbookUseCase(
      new ListBestProxyServersUseCase(
        repository,
        new InMemoryProxyReputationRepositoryAdapter(),
        systemClock,
        (): number => 0.25,
      ),
      new ScheduleJobUseCase(queue, jobs),
      count,
    ),
    requests,
    jobs,
  };
}

void test('queues the read through the best proxies, the manual ones with their credentials', async (): Promise<void> => {
  const manual = ProxyEntity.manual(
    'http://217.71.230.9:3128',
    { username: 'user', password: 'secret' },
    checkedAt,
  );
  const { refresh, requests, jobs } = await setup([
    proxy('socks5://217.71.230.1:1080', 2),
    proxy('socks5://217.71.230.2:1080', 4),
    manual,
  ]);

  const { jobId } = await refresh.execute('dns-cities', null);

  assert.deepEqual(requests, [
    {
      jobId,
      handbook: 'dns-cities',
      proxies: [
        'http://user:secret@217.71.230.9:3128/',
        'socks5://217.71.230.2:1080',
        'socks5://217.71.230.1:1080',
      ],
    },
  ]);
  const job = await jobs.findById(jobId);
  assert.equal(job?.snapshot.kind, 'handbook_fetch');
  assert.equal(job.snapshot.subject, 'dns-cities');
});

void test('queues nothing when there is no proxy, and goes through as many proxies as asked for', async (): Promise<void> => {
  const none = await setup([]);
  await assert.rejects(none.refresh.execute('dns-cities', null), NoProxiesAvailableError);
  assert.deepEqual(none.requests, []);

  const limited = await setup(
    [proxy('socks5://217.71.230.1:1080', 4), proxy('socks5://217.71.230.2:1080', 3)],
    1,
  );
  await limited.refresh.execute('dns-cities', null);
  assert.deepEqual(limited.requests[0]?.proxies, ['socks5://217.71.230.1:1080']);
});
