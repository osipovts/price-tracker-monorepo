import type { Page } from 'playwright-core';

import type { SportmasterPageInterface } from './sportmaster-page.interface.js';

/** Reads the JSON-LD of a Sportmaster page after its browser check lets the product through. */
export class SportmasterPageParser {
  async parse(browserPage: Page): Promise<SportmasterPageInterface> {
    // The first answer may be a Qrator check that reloads the page after validating the browser.
    await browserPage
      .locator('script[type="application/ld+json"]')
      .first()
      .waitFor({ state: 'attached' })
      .catch((): void => {
        /* Inspect a challenge or an error page on timeout as well. */
      });

    return browserPage.evaluate((): SportmasterPageInterface => {
      const scripts = Array.from(window.document.scripts);

      const analytics = scripts.find((script): boolean =>
        /^\s*dataLayer\s*=\s*\[/.test(script.textContent),
      );
      const cityId = /"cityId"\s*:\s*"(\d+)"/.exec(analytics?.textContent ?? '')?.[1] ?? null;

      return {
        cityId,
        url: window.location.href,
        structuredData: Array.from(
          window.document.querySelectorAll('script[type="application/ld+json"]'),
        ).map((element): string => element.textContent),
        hasChallenge:
          scripts.some((script): boolean => script.src.includes('/__qrator/')) ||
          window.document.getElementById('captcha-img') !== null,
      };
    });
  }
}
