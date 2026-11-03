import type { Page } from 'playwright-core';

import type { CitilinkPageInterface } from './citilink-page.interface.js';

/** Reads the parts of a Citilink page that the product parser needs: the server renders the card with its state in it. */
export class CitilinkPageParser {
  parse(browserPage: Page): Promise<CitilinkPageInterface> {
    return browserPage.evaluate((): CitilinkPageInterface => ({
      url: window.location.href,
      state: window.document.getElementById('__NEXT_DATA__')?.textContent ?? '',
    }));
  }
}
