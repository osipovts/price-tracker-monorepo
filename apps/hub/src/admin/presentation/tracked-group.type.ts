import { z } from 'zod';

import {
  pageResponseSchema,
  paginationQuerySchema,
} from '../../shared/presentation/pagination-query.type.js';

export const trackedGroupListQuerySchema = paginationQuerySchema;

export type TrackedGroupListQueryType = z.infer<typeof trackedGroupListQuerySchema>;

export const trackedGroupSchema = z.object({
  id: z.uuid(),
  /** The title the user gave, else the one of the first product; null while the group has no product with one. */
  title: z.string().nullable(),
  /** Where a browser loads the picture of the group from; null when none of its products has one. */
  thumbnailUrl: z.url().nullable(),
  /** The email of the user who owns the group; null for a user gone meanwhile. */
  ownerEmail: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** The marketplaces of its products, in the order they were added. */
  marketplaces: z.array(z.string()),
  /** The newest read of the prices of its products; null while none was read. */
  lastCheck: z.object({ marketplace: z.string(), checkedAt: z.iso.datetime() }).nullable(),
  /** The cheapest of the newest reads of the products that are in stock; null when none is. */
  current: z
    .object({
      marketplace: z.string(),
      amountMinor: z.number().int(),
      observedAt: z.iso.datetime(),
    })
    .nullable(),
});

export type TrackedGroupType = z.infer<typeof trackedGroupSchema>;

export const trackedGroupListResponseSchema = pageResponseSchema(trackedGroupSchema);

export type TrackedGroupListResponseType = z.infer<typeof trackedGroupListResponseSchema>;
