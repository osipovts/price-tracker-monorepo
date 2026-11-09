import { marketplaces } from 'product-reference';
import { z } from 'zod';

import { jobKinds, jobStatuses } from '../../job/application/index.js';
import {
  pageResponseSchema,
  paginationQuerySchema,
} from '../../shared/presentation/pagination-query.type.js';
import { jobStates } from '../application/list-job-records.use-case.js';

export const jobRecordListQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(jobKinds).optional(),
  /** `active`: queued, running or waiting for a retry; `completed`; `failed` for good. */
  state: z.enum(jobStates).optional(),
});

export type JobRecordListQueryType = z.infer<typeof jobRecordListQuerySchema>;

export const jobRecordSchema = z.object({
  id: z.uuid(),
  kind: z.enum(jobKinds),
  /** The proxy source, the handbook, the product id of a price read, or the marketplace of a batch of them. */
  subject: z.string(),
  status: z.enum(jobStatuses),
  /** Completion of the job, from 0 to 100. */
  percent: z.number().int().min(0).max(100),
  processed: z.number().int(),
  /** Null until the worker knows how much work there is. */
  total: z.number().int().nullable(),
  succeeded: z.number().int(),
  /** The reason of the last failure, including the ones that are retried. */
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  /** Not done an hour after it was queued: the worker that had it is likely gone. */
  lost: z.boolean(),
  /** The product a price job reads; null for the other jobs, for a batch, and for a product gone since. */
  product: z
    .object({
      id: z.uuid(),
      marketplace: z.enum(marketplaces),
      url: z.string(),
      cityName: z.string().nullable(),
      title: z.string().nullable(),
    })
    .nullable(),
});

export type JobRecordType = z.infer<typeof jobRecordSchema>;

export const jobRecordListResponseSchema = pageResponseSchema(jobRecordSchema);

export type JobRecordListResponseType = z.infer<typeof jobRecordListResponseSchema>;
