import { type HandbookCityType, marketplaceSchema } from 'queue-contract';
import { z } from 'zod';

import {
  pageResponseSchema,
  paginationQuerySchema,
} from '../../shared/presentation/pagination-query.type.js';

export const cityMarketplaceParamSchema = marketplaceSchema;

export const citySearchQuerySchema = z.object({
  /** A part of the name of the city, in any case; the first cities by name when empty. */
  query: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CitySearchQueryType = z.infer<typeof citySearchQuerySchema>;

export const citySchema = z.object({
  /** The id the marketplace gives the city: what `POST /products` takes as `cityId`. */
  id: z.string(),
  name: z.string(),
  region: z.string().nullable(),
});

export type CityResponseType = z.infer<typeof citySchema>;

/** A city as the hub shows it: its aliases are the hub's own, for finding the products tracked in it. */
export function cityResponseOf({ id, name, region }: HandbookCityType): CityResponseType {
  return { id, name, region };
}

export const cityListResponseSchema = z.object({ items: z.array(citySchema) });

export type CityListResponseType = z.infer<typeof cityListResponseSchema>;

export const handbookCitiesQuerySchema = paginationQuerySchema.extend({
  /** A part of the name or of the region of the city, in any case. */
  query: z.string().max(100).default(''),
});

export type HandbookCitiesQueryType = z.infer<typeof handbookCitiesQuerySchema>;

export const handbookCitiesResponseSchema = pageResponseSchema(citySchema).extend({
  /** When the cities were read; null if they never were. */
  fetchedAt: z.iso.datetime().nullable(),
});

export type HandbookCitiesResponseType = z.infer<typeof handbookCitiesResponseSchema>;
