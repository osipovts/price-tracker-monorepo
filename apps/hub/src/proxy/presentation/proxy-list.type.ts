import { marketplaces } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';
import { proxyServerSchema } from 'queue-contract';
import { z } from 'zod';

import {
  pageResponseSchema,
  paginationQuerySchema,
} from '../../shared/presentation/pagination-query.type.js';
import { proxyOutcomes } from '../domain/proxy-reputation.entity.js';

export const proxyListQuerySchema = paginationQuerySchema.extend({
  /** Only the alive ones (`true`) or only the dead (`false`); both when omitted. */
  alive: z.enum(['true', 'false']).optional(),
  /** Only the proxies an administrator turned off (`true`), or only those that are on (`false`). */
  disabled: z.enum(['true', 'false']).optional(),
  /** ISO 3166-1 alpha-2 code of the exit country. */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});

export type ProxyListQueryType = z.infer<typeof proxyListQuerySchema>;

export const proxyReputationSchema = z.object({
  marketplace: z.enum(marketplaces),
  /** Reads through the proxy, faded with time: an attempt weighs half as much after a day. */
  successes: z.number(),
  /** Failures through the proxy, faded the same way. */
  failures: z.number(),
  /** Failures in a row since the last read. */
  failureStreak: z.number().int(),
  /** What the last attempt told of the proxy. */
  lastOutcome: z.enum(proxyOutcomes),
  lastAttemptAt: z.iso.datetime(),
  /** The proxy is not given for the marketplace until then; null when it does not rest. */
  cooldownUntil: z.iso.datetime().nullable(),
});

export const proxyItemSchema = z.object({
  server: z.string(),
  source: z.string(),
  country: z.string().nullable(),
  exitIp: z.string().nullable(),
  alive: z.boolean(),
  /** Latency of the last successful check, in milliseconds. */
  latencyMs: z.number().int().nullable(),
  /** Share of successful checks, from 0 to 1. */
  successRate: z.number(),
  checksTotal: z.number().int(),
  lastCheckedAt: z.iso.datetime(),
  /** Turned off by an administrator: the workers are not given it. */
  disabled: z.boolean(),
  /** How the proxy has done reading each marketplace it was tried on. */
  reputations: z.array(proxyReputationSchema),
});

export const proxyListResponseSchema = pageResponseSchema(proxyItemSchema);

export type ProxyListResponseType = z.infer<typeof proxyListResponseSchema>;

export const proxyServerQuerySchema = z.object({
  /** The proxy URL as the list shows it, without credentials. */
  server: proxyServerSchema,
});

export type ProxyServerQueryType = z.infer<typeof proxyServerQuerySchema>;

export const proxyAddBodySchema = z.object({
  /** HTTP(S) or SOCKS5 proxy URL with a public IPv4; an HTTP(S) one may carry `user:password@`. */
  server: proxyServerSchema.refine(
    (server): boolean => {
      try {
        new ProxyEndpointEntity(server);

        return true;
      } catch {
        return false;
      }
    },
    {
      error:
        'Proxy must use HTTP(S) or SOCKS5 with a public IPv4 and port; SOCKS5 authentication is unsupported',
    },
  ),
});

export type ProxyAddBodyType = z.infer<typeof proxyAddBodySchema>;

export const proxyDisabledBodySchema = z.object({ disabled: z.boolean() });

export type ProxyDisabledBodyType = z.infer<typeof proxyDisabledBodySchema>;
