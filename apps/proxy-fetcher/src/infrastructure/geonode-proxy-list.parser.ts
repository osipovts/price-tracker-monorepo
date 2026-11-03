import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import { ProxyListParser } from './proxy-list.parser.js';

const listSchema = z.object({
  data: z.array(
    z.object({
      ip: z.string(),
      port: z.union([z.string(), z.number()]),
      protocols: z.array(z.string()),
    }),
  ),
});

/** Reads the answer of the API of Geonode: a proxy is listed once with all the protocols it speaks. */
export class GeonodeProxyListParser {
  constructor(private readonly lines: ProxyListParser = new ProxyListParser()) {}

  /** Unique usable candidates; none when the answer is not a list of proxies. */
  parse(text: string): ProxyEndpointEntity[] {
    const list = listSchema.safeParse(this.parseJson(text));
    if (!list.success) return [];

    return this.lines.parse(
      list.data.data
        .flatMap(({ ip, port, protocols }): string[] =>
          protocols.map((protocol): string => `${protocol}://${ip}:${String(port)}`),
        )
        .join('\n'),
    );
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
