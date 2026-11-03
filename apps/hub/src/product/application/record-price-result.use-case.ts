import { randomUUID } from 'node:crypto';

import { errorMessage, type LoggerPort, silentLogger } from 'logger';

import type {
  ProxyAttemptInterface,
  RecordProxyAttemptsUseCase,
} from '../../proxy/application/index.js';
import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import type { PriceObservationInterface } from '../domain/price-observation.interface.js';
import type { PriceObservationRepositoryPort } from './price-observation-repository.port.js';
import type { StoreProductThumbnailUseCase } from './store-product-thumbnail.use-case.js';
import type { TrackedProductRepositoryPort } from './tracked-product-repository.port.js';

export interface PriceResultInterface {
  jobId: string;
  trackedProductId: string;
  status: string;
  /** Present when a fetch attempt read the product card. */
  observation: Omit<PriceObservationInterface, 'id' | 'trackedProductId' | 'jobId'> | null;
  /** The picture of the product the worker saw on its page, when it saw one. */
  imageUrl?: string | null;
  /** What each route the worker tried came to, in the order of trying. */
  attempts: PriceAttemptInterface[];
}

export interface PriceAttemptInterface {
  /** Proxy URL without credentials; null for an attempt without a proxy. */
  proxy: string | null;
  status: ProxyAttemptInterface['status'];
  httpStatus: number | null;
}

export class RecordPriceResultUseCase {
  constructor(
    private readonly products: TrackedProductRepositoryPort,
    private readonly observations: PriceObservationRepositoryPort,
    private readonly thumbnails: Pick<StoreProductThumbnailUseCase, 'execute'>,
    private readonly proxyAttempts: Pick<RecordProxyAttemptsUseCase, 'execute'>,
    private readonly logger: LoggerPort = silentLogger,
    private readonly clock: ClockPort = systemClock,
  ) {}

  async execute(result: PriceResultInterface): Promise<void> {
    // The product may have been deleted while the job was running.
    const product = await this.products.findById(result.trackedProductId);
    if (product === null) {
      this.logger.warn(`Ignoring a result of the unknown product ${result.trackedProductId}`);

      return;
    }

    if (result.observation !== null) {
      await this.observations.saveIfAbsent({
        ...result.observation,
        id: randomUUID(),
        trackedProductId: result.trackedProductId,
        jobId: result.jobId,
      });
    }

    await this.products.markChecked(result.trackedProductId, result.status, new Date());
    await this.recordAttempts(product.snapshot.marketplace, result.attempts);
    // Last: the first write to a storage can take a while, and the price must not wait for the picture.
    await this.thumbnails.execute(result.trackedProductId, result.imageUrl ?? null);
    this.logger.info(
      `Product ${result.trackedProductId}: ${result.status}${result.observation === null ? ', no price recorded' : `, ${String(result.observation.prices.length)} prices recorded`} (job ${result.jobId})`,
    );
  }

  /** The proxies learn from what the routes came to; a failure to keep it must not hold up the price. */
  private async recordAttempts(
    marketplace: ProxyAttemptInterface['marketplace'],
    attempts: PriceAttemptInterface[],
  ): Promise<void> {
    const attemptedAt = this.clock.now();
    try {
      await this.proxyAttempts.execute(
        attempts.flatMap(({ proxy, status, httpStatus }): ProxyAttemptInterface[] =>
          proxy === null ? [] : [{ server: proxy, marketplace, status, httpStatus, attemptedAt }],
        ),
      );
    } catch (error: unknown) {
      this.logger.warn(
        `The attempts through the proxies were not recorded: ${errorMessage(error)}`,
      );
    }
  }
}
