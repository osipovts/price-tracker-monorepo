import { type LoggerPort, silentLogger } from 'logger';

import type { ScheduleJobUseCase } from '../../job/application/index.js';
import { NoProxiesAvailableError } from '../../shared/application/no-proxies-available.error.js';
import type { ChoosePriceRoutesUseCase } from './choose-price-routes.use-case.js';
import { ProductNotFoundError } from './product-not-found.error.js';
import type { TrackedProductRepositoryPort } from './tracked-product-repository.port.js';

/** Queues a read of the fresh price of a tracked product; it ends up in the price history. */
export class RequestPriceObservationUseCase {
  constructor(
    private readonly products: TrackedProductRepositoryPort,
    private readonly chooseRoutes: Pick<ChoosePriceRoutesUseCase, 'execute'>,
    private readonly scheduleJob: ScheduleJobUseCase,
    private readonly timeoutMs: number,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  async execute(userId: string, productId: string): Promise<{ jobId: string }> {
    const found = await this.products.findSubscribed(userId, productId);
    if (found === null) throw new ProductNotFoundError(productId);

    const product = found.snapshot;

    const routes = await this.chooseRoutes.execute(product.marketplace);
    if (routes.length === 0) throw new NoProxiesAvailableError();

    const { jobId } = await this.scheduleJob.execute({
      kind: 'price_fetch',
      requestedBy: userId,
      subject: product.id,
      routes,
      products: [found.readRequest],
      timeoutMs: this.timeoutMs,
    });
    // The scheduled refresh leaves a product alone while a read of it is on its way.
    await this.products.markRequested([product.id], new Date());

    this.logger.info(
      `Queued price observation ${jobId} of ${product.marketplace} ${product.externalId} (product ${product.id}) via ${String(routes.length)} routes: ${routes
        .map((route): string => route.server ?? 'direct')
        .join(', ')}`,
    );

    return { jobId };
  }
}
