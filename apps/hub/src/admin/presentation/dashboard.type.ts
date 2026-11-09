import { marketplaces } from 'product-reference';
import { z } from 'zod';

import { jobKinds } from '../../job/application/index.js';

const jobKindCountsSchema = z.strictObject({
  kind: z.enum(jobKinds),
  queued: z.number().int(),
  running: z.number().int(),
  retrying: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
});

const marketplaceSchema = z.enum(marketplaces);

export const dashboardResponseSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  users: z.strictObject({
    total: z.number().int(),
    /** With the email proven to be theirs. */
    verified: z.number().int(),
    joinedLastDay: z.number().int(),
  }),
  products: z.strictObject({
    products: z.number().int(),
    /** What users track in all: a product that two of them track counts twice. */
    trackings: z.number().int(),
    groups: z.number().int(),
    /** A product whose newest price is older than this is stale. */
    staleAfterMs: z.number().int(),
    /** How the prices of each marketplace are read, in the order of the marketplaces. */
    marketplaces: z.array(
      z.strictObject({
        marketplace: marketplaceSchema,
        /** The products somebody tracks. */
        products: z.number().int(),
        readsLastDay: z.number().int(),
        lastReadAt: z.iso.datetime().nullable(),
        /** The products read once whose newest price is older than `staleAfterMs`. */
        stale: z.number().int(),
        /** The products whose price was never read. */
        unread: z.number().int(),
      }),
    ),
    /** The reads of the last day by the hour and the marketplace, the oldest first; an hour with none is left out. */
    readsByHour: z.array(
      z.strictObject({
        hour: z.iso.datetime(),
        marketplace: marketplaceSchema,
        reads: z.number().int(),
      }),
    ),
  }),
  proxies: z.strictObject({
    total: z.number().int(),
    alive: z.number().int(),
    /** Turned off by an administrator. */
    disabled: z.number().int(),
    /** Of the alive ones, in milliseconds. */
    averageLatencyMs: z.number().int().nullable(),
    lastCheckedAt: z.iso.datetime().nullable(),
    bySource: z.array(
      z.strictObject({
        source: z.string(),
        total: z.number().int(),
        alive: z.number().int(),
        disabled: z.number().int(),
      }),
    ),
    /** The proxies a read of each marketplace may be given now. */
    usable: z.array(z.strictObject({ marketplace: marketplaceSchema, count: z.number().int() })),
  }),
  jobs: z.strictObject({
    /** The jobs created in the last day, by kind and status, in the order of the kinds. */
    lastDay: z.array(jobKindCountsSchema),
    /** The jobs not done now; `lost` are the ones not done an hour after they were queued. */
    unfinished: z.strictObject({
      queued: z.number().int(),
      running: z.number().int(),
      retrying: z.number().int(),
      lost: z.number().int(),
    }),
    /** The price reads that ended in each hour of the last day, the oldest first; an hour with none is left out. */
    priceJobsByHour: z.array(
      z.strictObject({
        hour: z.iso.datetime(),
        completed: z.number().int(),
        failed: z.number().int(),
      }),
    ),
  }),
});

export type DashboardResponseType = z.infer<typeof dashboardResponseSchema>;
