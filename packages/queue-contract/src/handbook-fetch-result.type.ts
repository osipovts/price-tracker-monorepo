import { z } from 'zod';

import { handbookSchema } from './handbook.type.js';
import { jobDoneSchema, jobFailedSchema, jobStartedSchema } from './job-lifecycle.type.js';
import { jobProgressSchema } from './job-progress.type.js';

export const handbookCitySchema = z.object({
  /** The id the marketplace gives the city. */
  id: z.string().min(1),
  name: z.string().min(1),
  region: z.string().min(1).nullable(),
  /**
   * The other ids the marketplace gives the same city: a town of Wildberries is known by the region of each of
   * its pickup points. The hub keeps the ids a city has had in them as well.
   */
  aliases: z.array(z.string().min(1)).optional(),
});

export type HandbookCityType = z.infer<typeof handbookCitySchema>;

export const handbookFetchResultSchema = z.discriminatedUnion('type', [
  jobStartedSchema,
  jobProgressSchema,
  jobFailedSchema,
  jobDoneSchema,
  z.object({
    type: z.literal('handbook_cities'),
    jobId: z.uuid(),
    handbook: handbookSchema,
    /** All the cities at once: the hub replaces what it has with them. */
    cities: z.array(handbookCitySchema),
  }),
]);

export type HandbookFetchResultType = z.infer<typeof handbookFetchResultSchema>;
