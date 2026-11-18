import type { LaunchOptions } from 'camoufox-js';
import type { BrowserContextOptions } from 'playwright-core';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

export interface CamoufoxLaunchSettingsInterface {
  headed: boolean;
  executablePath?: string;
}

/** Browser settings shared by the workers: Camoufox gives every launch its own fingerprint, so no session is kept. */
export class CamoufoxOptionsFactory {
  /** A Russian visitor: the language is set in the browser itself, and the time zone and the place follow the address it comes from. */
  launch(settings: CamoufoxLaunchSettingsInterface): LaunchOptions {
    return {
      headless: !settings.headed,
      humanize: true,
      locale: ['ru-RU'],
      geoip: true,
      ...(settings.executablePath === undefined
        ? {}
        : // The option is named so by camoufox-js.
          // eslint-disable-next-line @typescript-eslint/naming-convention
          { executable_path: settings.executablePath }),
    };
  }

  /** The route of a context; a null proxy is a direct connection. */
  context(proxy: ProxyEndpointEntity | null): BrowserContextOptions {
    return proxy === null
      ? {}
      : {
          proxy: {
            server: proxy.server,
            ...(proxy.username === ''
              ? {}
              : { username: proxy.username, password: proxy.password }),
          },
        };
  }
}
