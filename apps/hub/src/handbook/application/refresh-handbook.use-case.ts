import type { MarketplaceType } from 'product-reference';
import type { HandbookType } from 'queue-contract';

import type { ScheduleJobUseCase } from '../../job/application/index.js';
import type { ListBestProxyServersUseCase } from '../../proxy/application/index.js';
import { NoProxiesAvailableError } from '../../shared/application/no-proxies-available.error.js';

/** The marketplace a handbook is read from: the proxies are chosen for it. */
const handbookMarketplaces: Readonly<Record<HandbookType, MarketplaceType>> = {
  'dns-cities': 'dns',
};

/** Queues the read of a handbook by a worker, through the best proxies. */
export class RefreshHandbookUseCase {
  constructor(
    private readonly proxyServers: ListBestProxyServersUseCase,
    private readonly scheduleJob: ScheduleJobUseCase,
    /** How many of the best proxies a job may try. */
    private readonly proxyCount: number,
  ) {}

  /** `requestedBy` is the administrator who asked, who follows the job; null for the schedule and the operator. */
  async execute(handbook: HandbookType, requestedBy: string | null): Promise<{ jobId: string }> {
    const servers = await this.proxyServers.execute({
      marketplace: handbookMarketplaces[handbook],
      limit: this.proxyCount,
    });
    if (servers.length === 0) throw new NoProxiesAvailableError();

    // The workers connect with the credentials of a proxy, which the hub keeps apart from its server.
    const urls = await this.proxyServers.urlsOf(servers);

    return this.scheduleJob.execute({
      kind: 'handbook_fetch',
      requestedBy,
      handbook,
      proxies: servers.map((server): string => urls.get(server) ?? server),
    });
  }
}
