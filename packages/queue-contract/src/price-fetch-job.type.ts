import { z } from 'zod';

import { proxyServerSchema } from './proxy-server.type.js';

export const priceFetchRouteSchema = z.object({
  server: proxyServerSchema.nullable(),
});

export const priceFetchJobSchema = z.object({
  jobId: z.uuid(),
  /** Routes in the order they are tried; a null server is a direct connection. */
  proxies: z.array(priceFetchRouteSchema).min(1),
  products: z
    .array(
      z.object({
        trackedProductId: z.uuid(),
        url: z.url(),
        /** The city whose price is read, by the id of the marketplace; none where it has no cities. */
        cityId: z.string().min(1).optional(),
        cityName: z.string().min(1).optional(),
        /** Set by the worker when a try read the product: the next try leaves it alone. */
        read: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50),
  timeoutMs: z.number().int().min(1000).max(60000),
});

export type PriceFetchJobType = z.infer<typeof priceFetchJobSchema>;
