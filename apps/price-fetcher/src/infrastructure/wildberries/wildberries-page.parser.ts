import type { Page } from 'playwright-core';

import type { WildberriesPageInterface } from './wildberries-page.interface.js';

/** Reads the parts of a rendered Wildberries page that the product and challenge parsers need. */
export class WildberriesPageParser {
  /** The card is the answer of the card service the page asks once it has loaded. */
  async parse(browserPage: Page, card: Promise<string>): Promise<WildberriesPageInterface> {
    const cardText = await card;
    const document = await browserPage.evaluate((): Omit<WildberriesPageInterface, 'card'> => ({
      url: window.location.href,
      title: window.document.title,
      body: window.document.body.innerText.slice(0, 8000),
      imageUrl:
        window.document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
    }));

    return { ...document, card: cardText };
  }
}
