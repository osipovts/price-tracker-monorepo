import { z } from 'zod';

import { handbookSchema } from './handbook.type.js';
import { proxyServerSchema } from './proxy-server.type.js';

export const handbookFetchJobSchema = z.object({
  jobId: z.uuid(),
  handbook: handbookSchema,
  /** Routes in the order they are tried; a null server is a direct connection. */
  proxies: z.array(proxyServerSchema.nullable()).min(1),
});

export type HandbookFetchJobType = z.infer<typeof handbookFetchJobSchema>;
