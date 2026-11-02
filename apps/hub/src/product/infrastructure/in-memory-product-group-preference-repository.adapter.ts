import type { ProductGroupPreferenceRepositoryPort } from '../application/product-group-preference-repository.port.js';
import { defaultStatsPeriod, type StatsPeriodType } from '../domain/stats-period.type.js';

export class InMemoryProductGroupPreferenceRepositoryAdapter implements ProductGroupPreferenceRepositoryPort {
  private readonly periods = new Map<string, StatsPeriodType>();

  getStatsPeriod(userId: string): Promise<StatsPeriodType> {
    return Promise.resolve(this.periods.get(userId) ?? defaultStatsPeriod);
  }

  setStatsPeriod(userId: string, period: StatsPeriodType): Promise<void> {
    this.periods.set(userId, period);

    return Promise.resolve();
  }
}
