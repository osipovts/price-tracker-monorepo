import type { StatsPeriodType } from '../domain/stats-period.type.js';
import type { ProductGroupPreferenceRepositoryPort } from './product-group-preference-repository.port.js';

export class SetStatsPeriodUseCase {
  constructor(private readonly preferences: ProductGroupPreferenceRepositoryPort) {}

  execute(userId: string, period: StatsPeriodType): Promise<void> {
    return this.preferences.setStatsPeriod(userId, period);
  }
}
