import type { Page } from 'playwright-core';
import { z } from 'zod';

import type { AptekaPageInterface } from './apteka-page.interface.js';

const initialStatePattern = /__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/;
const selectedCitySchema = z.object({
  selectedCity: z
    .object({
      url: z.string().min(1),
    })
    .nullish(),
});

interface DomStateInterface {
  url: string;
  hasChallenge: boolean;
  hasProductMarkup: boolean;
}

/** Reads the raw SSR HTML `__INITIAL_STATE__` of an Apteka.ru page before Vue hydration removes it. */
export class AptekaPageParser {
  async parse(browserPage: Page, readBody: () => Promise<string>): Promise<AptekaPageInterface> {
    await browserPage.waitForLoadState('domcontentloaded').catch((): void => {
      /* Inspect a challenge or an error page even when navigation is interrupted. */
    });

    let domState = await this.readDomState(browserPage);
    if (domState === null || (domState.hasChallenge && !domState.hasProductMarkup)) {
      await browserPage
        .locator('script[type="application/ld+json"]')
        .first()
        .waitFor({ state: 'attached' })
        .catch((): void => {
          /* Inspect a persistent challenge or error page on timeout as well. */
        });
      domState = (await this.readDomState(browserPage)) ?? {
        url: browserPage.url(),
        hasChallenge: true,
        hasProductMarkup: false,
      };
    }

    const html = await readBody();
    const initialState = initialStatePattern.exec(html)?.[1] ?? '';

    return {
      url: domState.url,
      cityId: this.readCityId(initialState),
      initialState,
      hasChallenge:
        domState.hasChallenge || html.includes('/__qrator/') || html.includes('id="captcha-img"'),
    };
  }

  private async readDomState(browserPage: Page): Promise<DomStateInterface | null> {
    try {
      return await browserPage.evaluate((): DomStateInterface => {
        const scripts = Array.from(window.document.scripts);

        return {
          url: window.location.href,
          hasChallenge:
            scripts.some((script): boolean => script.src.includes('/__qrator/')) ||
            window.document.getElementById('captcha-img') !== null,
          hasProductMarkup:
            window.document.querySelector('script[type="application/ld+json"]') !== null,
        };
      });
    } catch {
      return null;
    }
  }

  private readCityId(initialState: string): string | null {
    if (initialState === '') return null;

    try {
      const parsed = selectedCitySchema.safeParse(JSON.parse(initialState));

      return parsed.success ? (parsed.data.selectedCity?.url ?? null) : null;
    } catch {
      return null;
    }
  }
}
