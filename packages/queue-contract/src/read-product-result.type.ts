import { z } from 'zod';

const priceObservationSchema = z.object({
  amountMinor: z.number().int(),
  currency: z.literal('RUB'),
});

const productSnapshotSchema = z.object({
  title: z.string(),
  observedAt: z.iso.datetime(),
  prices: z.array(priceObservationSchema),
  availability: z.enum(['in_stock', 'out_of_stock', 'unknown']),
  /** The picture of the product on its page: the hub keeps a copy of it. Absent from older workers. */
  imageUrl: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .optional(),
});

/**
 * Where an attempt failed: `preflight`, the route did not reach the site before a browser was opened; `exit`, the
 * check of the exit country of the route; `page`, the pages of the site.
 */
export const readStages = ['preflight', 'exit', 'page'] as const;

export type ReadStageType = (typeof readStages)[number];

export const readProductResultSchema = z.union([
  z.object({
    status: z.enum(['success', 'partial']),
    snapshot: productSnapshotSchema,
    exitIp: z.string().nullable(),
  }),
  z.object({
    status: z.enum([
      'challenge_required',
      'network_error',
      'proxy_rejected',
      'parse_error',
      'http_error',
    ]),
    httpStatus: z.number().int().optional(),
    /** Absent from older workers. */
    stage: z.enum(readStages).optional(),
  }),
]);
