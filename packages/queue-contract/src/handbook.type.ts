import { z } from 'zod';

/** The reference data the hub keeps of the marketplaces, by the name of the fetcher that reads it. */
export const handbookSchema = z.enum(['dns-cities', 'wildberries-cities']);

export type HandbookType = z.infer<typeof handbookSchema>;
