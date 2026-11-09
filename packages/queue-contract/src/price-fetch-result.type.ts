import { z } from 'zod';

import { jobDoneSchema, jobFailedSchema, jobStartedSchema } from './job-lifecycle.type.js';
import { jobProgressSchema } from './job-progress.type.js';
import { readProductResultSchema } from './read-product-result.type.js';

export const priceFetchResultSchema = z.discriminatedUnion('type', [
  jobStartedSchema,
  jobProgressSchema,
  jobFailedSchema,
  jobDoneSchema,
  z.object({
    type: z.literal('product_result'),
    jobId: z.uuid(),
    trackedProductId: z.uuid(),
    status: z.enum([
      'success',
      'partial',
      'challenge_required',
      'network_error',
      'proxy_rejected',
      'parse_error',
      'http_error',
      'no_proxies',
      'invalid_url',
    ]),
    /** Proxy URLs here never carry credentials. */
    attempts: z.array(
      z.object({
        proxy: z.string().nullable(),
        result: readProductResultSchema,
        /** How long the attempt took, the check of the route included; absent from older workers. */
        durationMs: z.number().int().nonnegative().optional(),
        /**
         * The visit of the route was told of with another product of its batch already: the proxies do not learn
         * from it twice. Absent from older workers.
         */
        shared: z.boolean().optional(),
      }),
    ),
  }),
]);

export type PriceFetchResultType = z.infer<typeof priceFetchResultSchema>;
