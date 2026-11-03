import type { Page } from 'playwright-core';

import type { WildberriesPageInterface } from './wildberries-page.interface.js';

/** How long the gallery is waited for after the card: a product may have no pictures. */
const pictureTimeoutMs = 5_000;

/** Reads the parts of a rendered Wildberries page that the product parser needs. */
export class WildberriesPageParser {
  /** The card is the answer of the card service the page asks once it has loaded. */
  async parse(browserPage: Page, card: Promise<string>): Promise<WildberriesPageInterface> {
    const cardText = await card;
    // The page names the picture of the whole site in `og:image`: the product has its own in the gallery.
    await browserPage
      .locator('img[src*="/images/"]')
      .first()
      .waitFor({ state: 'attached', timeout: pictureTimeoutMs })
      .catch((): void => {
        /* Read the page without a picture as well. */
      });

    const document = await browserPage.evaluate((): Omit<WildberriesPageInterface, 'card'> => ({
      url: window.location.href,
      imageUrls: Array.from(
        window.document.querySelectorAll<HTMLImageElement>('img[src*="/images/"]'),
      ).map((image): string => image.src),
    }));

    return { ...document, card: cardText };
  }
}
