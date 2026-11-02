import { z } from 'zod';

import { pageResponseSchema } from '../../shared/presentation/pagination-query.type.js';
import { statsPeriods } from '../domain/stats-period.type.js';
import { productListItemSchema } from './product.type.js';

export const productGroupIdParamSchema = z.uuid();

const titleSchema = z.string().trim().min(1).max(200);

export const productGroupCreateBodySchema = z.object({
  /** What to call the group; the group is called after its first product when omitted. */
  title: titleSchema.optional(),
});

export type ProductGroupCreateBodyType = z.infer<typeof productGroupCreateBodySchema>;

export const productGroupRenameBodySchema = z.object({ title: titleSchema });

export type ProductGroupRenameBodyType = z.infer<typeof productGroupRenameBodySchema>;

const statsPeriodSchema = z.enum(statsPeriods);

export const statsPeriodBodySchema = z.object({
  /** The period of the lowest and the highest price on the cards: 24h, 7d or 30d. */
  statsPeriod: statsPeriodSchema,
});

export type StatsPeriodBodyType = z.infer<typeof statsPeriodBodySchema>;

const groupPriceSchema = z.object({
  marketplace: z.string(),
  /** In kopecks. */
  amountMinor: z.number().int(),
  observedAt: z.iso.datetime(),
});

export const productGroupSchema = z.object({
  id: z.uuid(),
  /** The title the user gave, else the one of the first product; null while the group has no product with one. */
  title: z.string().nullable(),
  /** Where a browser loads the picture of the group from, the one of its first product that has one; null when none has. */
  thumbnailUrl: z.url().nullable(),
  createdAt: z.iso.datetime(),
  productCount: z.number().int(),
  /** The newest read of the prices of its products, with the marketplace it was on; null while none was read. */
  lastCheck: z.object({ marketplace: z.string(), checkedAt: z.iso.datetime() }).nullable(),
  /** The cheapest of the newest reads of the products that are in stock; null when none is. */
  current: groupPriceSchema.nullable(),
  /** The lowest and the highest price of the chosen period, not counting the newest read of each product. */
  min: groupPriceSchema.nullable(),
  max: groupPriceSchema.nullable(),
  /** The current price is not above the lowest of the period. */
  highlighted: z.boolean(),
});

export type ProductGroupType = z.infer<typeof productGroupSchema>;

export const productGroupListResponseSchema = pageResponseSchema(productGroupSchema).extend({
  statsPeriod: statsPeriodSchema,
});

export type ProductGroupListResponseType = z.infer<typeof productGroupListResponseSchema>;

export const productGroupDetailSchema = productGroupSchema.extend({
  statsPeriod: statsPeriodSchema,
  /** In the order they were added. */
  products: z.array(productListItemSchema),
});

export type ProductGroupDetailType = z.infer<typeof productGroupDetailSchema>;
