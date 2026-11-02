import type { StatsPeriodType } from '../domain/stats-period.type.js';

export const PRODUCT_GROUP_PREFERENCE_REPOSITORY = Symbol('ProductGroupPreferenceRepositoryPort');

export interface ProductGroupPreferenceRepositoryPort {
  /** The period the user chose, the default one while they have not chosen. */
  getStatsPeriod(userId: string): Promise<StatsPeriodType>;
  setStatsPeriod(userId: string, period: StatsPeriodType): Promise<void>;
}
