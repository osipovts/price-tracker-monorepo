import type { RateLimitInterface } from '../../shared/application/rate-limiter.port.js';

/** What a user may do with products: how many they track, and how fast they add. */
export interface ProductLimitsInterface {
  maxProducts: number;
  /** How many products one group holds. */
  maxProductsPerGroup: number;
  add: RateLimitInterface;
}
