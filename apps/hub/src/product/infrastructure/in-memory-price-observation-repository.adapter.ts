import {
  type PageInterface,
  pageOf,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { PriceObservationRepositoryPort } from '../application/price-observation-repository.port.js';
import type { PriceObservationInterface } from '../domain/price-observation.interface.js';

export class InMemoryPriceObservationRepositoryAdapter implements PriceObservationRepositoryPort {
  private readonly observations: PriceObservationInterface[] = [];

  saveIfAbsent(observation: PriceObservationInterface): Promise<void> {
    const duplicate = this.observations.some(
      (saved): boolean =>
        saved.jobId === observation.jobId &&
        saved.trackedProductId === observation.trackedProductId,
    );
    if (!duplicate) this.observations.push(observation);

    return Promise.resolve();
  }

  findLatestByProducts(trackedProductIds: readonly string[]): Promise<PriceObservationInterface[]> {
    return Promise.resolve(
      trackedProductIds.flatMap((id): PriceObservationInterface[] => {
        const [latest] = this.observations
          .filter((observation): boolean => observation.trackedProductId === id)
          .toSorted((a, b): number => b.observedAt.getTime() - a.observedAt.getTime());

        return latest === undefined ? [] : [latest];
      }),
    );
  }

  listSince(
    trackedProductIds: readonly string[],
    since: Date,
  ): Promise<PriceObservationInterface[]> {
    return Promise.resolve(
      this.observations
        .filter(
          (observation): boolean =>
            trackedProductIds.includes(observation.trackedProductId) &&
            observation.observedAt >= since,
        )
        .toSorted((a, b): number => a.observedAt.getTime() - b.observedAt.getTime()),
    );
  }

  listByProduct(
    trackedProductId: string,
    pagination: PaginationInterface,
  ): Promise<PageInterface<PriceObservationInterface>> {
    const matching = this.observations
      .filter((observation): boolean => observation.trackedProductId === trackedProductId)
      .toSorted((a, b): number => b.observedAt.getTime() - a.observedAt.getTime());

    return Promise.resolve(pageOf(matching, pagination));
  }
}
