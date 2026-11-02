import { z } from 'zod';

import { priceObservationSchema } from './price-observation.type.js';

export const productIdParamSchema = z.uuid();

export const productCreateBodySchema = z.object({
  /** Product page URL of a supported marketplace; share links are canonicalized. */
  url: z.url(),
  /** The city whose price is read, by the id of the marketplace, for one whose prices depend on it; the default city when omitted, ignored where there are no cities. */
  cityId: z.string().min(1).max(100).optional(),
  /** The group of the user to add the product to; a new group is made for it when omitted. */
  groupId: z.uuid().optional(),
});

export type ProductCreateBodyType = z.infer<typeof productCreateBodySchema>;

export const productSchema = z.object({
  id: z.uuid(),
  marketplace: z.string(),
  /** The id of the product on the marketplace. */
  externalId: z.string(),
  /** Canonical link to the product page on the marketplace. */
  url: z.string(),
  /** The city whose price is read, by the id of the marketplace; null where it has no cities. */
  cityId: z.string().nullable(),
  /** The name of that city; null where the marketplace has no cities. */
  cityName: z.string().nullable(),
  /** Status of the last fetch, including failed ones. */
  lastStatus: z.string().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  /** About when the schedule reads the price again; a time that has passed means it is overdue and waits for the next look of the schedule. Null when the schedule is off. */
  nextCheckAt: z.iso.datetime().nullable(),
  /** Where a browser loads the picture of the product from, for a while; null when there is none yet. */
  thumbnailUrl: z.url().nullable(),
});

export type ProductType = z.infer<typeof productSchema>;

export const productAddedSchema = productSchema.extend({
  /** The job that reads the first price: follow it with `GET /jobs/{jobId}`. Null if there is nothing to read, or no way to now. */
  jobId: z.uuid().nullable(),
  /** The group of the user the product is in. */
  groupId: z.uuid(),
});

export type ProductAddedType = z.infer<typeof productAddedSchema>;

export const productListItemSchema = productSchema.extend({
  /** The newest price observation, null until the first one is recorded. */
  latest: priceObservationSchema.nullable(),
});

export type ProductListItemType = z.infer<typeof productListItemSchema>;
