import { z } from 'zod';

import { priceFetchRouteSchema } from './price-fetch-job.type.js';

export const linkExpandJobSchema = z.object({
  /** A short link of a marketplace. */
  url: z.url(),
  /** Routes in the order they are tried; a null server is a direct connection. */
  proxies: z.array(priceFetchRouteSchema).min(1),
  timeoutMs: z.number().int().min(1000).max(60000),
});

export type LinkExpandJobType = z.infer<typeof linkExpandJobSchema>;

/** What the worker returns to the one who waits for the job. */
export const linkExpandResultSchema = z.object({
  /** The canonical address of the product the link leads to. */
  url: z.url(),
});

export type LinkExpandResultType = z.infer<typeof linkExpandResultSchema>;
