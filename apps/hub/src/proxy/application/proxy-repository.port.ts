import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { ProxyEntity } from '../domain/proxy.entity.js';

export const PROXY_REPOSITORY = Symbol('ProxyRepositoryPort');

export interface ProxyFilterInterface {
  alive?: boolean;
  country?: string;
  /** Only the proxies that are turned off (`true`), or only those that are on (`false`). */
  disabled?: boolean;
  /** Only the proxies added by hand (`true`), or only the found ones (`false`). */
  manual?: boolean;
  /** Only the proxies of the source; `manual` for the ones added by hand. */
  source?: string;
}

/** How many proxies a source gave, and how many of them are alive and turned off. */
export interface ProxySourceStatsInterface {
  source: string;
  total: number;
  alive: number;
  disabled: number;
}

export interface StoredProxyStatsInterface {
  total: number;
  alive: number;
  /** Turned off by an administrator. */
  disabled: number;
  /** Of the alive ones; null if none is alive. */
  averageLatencyMs: number | null;
  lastCheckedAt: Date | null;
  /** By the source, in the order of the names. */
  bySource: ProxySourceStatsInterface[];
}

export interface ProxyRepositoryPort {
  stats(): Promise<StoredProxyStatsInterface>;
  findByServers(servers: string[]): Promise<ProxyEntity[]>;
  saveMany(proxies: ProxyEntity[]): Promise<void>;
  /**
   * Saves the proxies as the checks left them. What an administrator sets meanwhile, the time a proxy
   * was turned off and its credentials, stays as it is in the store: a batch read before it must not undo it.
   */
  saveChecked(proxies: ProxyEntity[]): Promise<void>;
  /** The found proxies no list has named since the time, the longest unchecked first. */
  listUnseen(since: Date, limit: number): Promise<ProxyEntity[]>;
  /** Deletes the proxies; returns how many there were. */
  deleteMany(servers: string[]): Promise<number>;
  /** Best first: alive, then the success rate, then the latency. */
  list(
    filter: ProxyFilterInterface,
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProxyEntity>>;
}
