import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import { ProxyListParser } from './proxy-list.parser.js';

const proxySchema = z.object({
  protocol: z.string(),
  host: z.string(),
  port: z.number(),
  geolocation: z
    .object({
      // The field is named so by the list.
      // eslint-disable-next-line @typescript-eslint/naming-convention
      country: z.object({ iso_code: z.string() }).nullish(),
    })
    .nullish(),
});

/**
 * Reads the list of monosans/proxy-list: the proxies of all the countries, each with the country of the address it
 * goes out from.
 */
export class MonosansProxyListParser {
  constructor(private readonly lines: ProxyListParser = new ProxyListParser()) {}

  /** Unique usable candidates of the country; none when the text is not a list of proxies. */
  parse(text: string, country: string): ProxyEndpointEntity[] {
    const list = z.array(z.unknown()).safeParse(this.parseJson(text));
    if (!list.success) return [];

    return this.lines.parse(
      list.data
        .flatMap((value): string[] => {
          const proxy = proxySchema.safeParse(value);

          return proxy.success && proxy.data.geolocation?.country?.iso_code === country
            ? [`${proxy.data.protocol}://${proxy.data.host}:${String(proxy.data.port)}`]
            : [];
        })
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
