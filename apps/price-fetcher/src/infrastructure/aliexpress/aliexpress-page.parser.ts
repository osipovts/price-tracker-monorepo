import type { Page } from 'playwright-core';

import type { AliexpressPageInterface } from './aliexpress-page.interface.js';

const aerCityPattern =
  /"userGeoInfo"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*"city"\s*:\s*\{"code"\s*:\s*"(\d+)"/;
const productDataCityPattern = /"to"\s*:\s*\{[^{}]*"city"\s*:\s*"(\d+)"/;

/** Reads the AliExpress product page and the JSON answer of `productData`. */
export class AliexpressPageParser {
  async parse(browserPage: Page, productData: Promise<string>): Promise<AliexpressPageInterface> {
    await browserPage
      .locator('script#__AER_DATA__, #nocaptcha, #baxia-punish')
      .first()
      .waitFor({ state: 'attached' })
      .catch((): void => {
        /* Inspect a challenge or an error page on timeout as well. */
      });

    const pageState = await browserPage.evaluate(
      (): {
        url: string;
        aerData: string;
        hasChallenge: boolean;
      } => ({
        url: window.location.href,
        aerData: window.document.getElementById('__AER_DATA__')?.textContent ?? '',
        hasChallenge:
          window.location.pathname.includes('/_____tmd_____/punish') ||
          window.document.getElementById('nocaptcha') !== null ||
          window.document.getElementById('baxia-punish') !== null,
      }),
    );

    const productDataText = pageState.hasChallenge ? '' : await productData;
    const hasChallenge =
      pageState.hasChallenge ||
      productDataText.includes('/_____tmd_____/punish') ||
      productDataText.includes('"rgv587_flag"');
    const cityId =
      aerCityPattern.exec(pageState.aerData)?.[1] ??
      productDataCityPattern.exec(productDataText)?.[1] ??
      null;

    return {
      url: pageState.url,
      cityId,
      productData: productDataText,
      hasChallenge,
    };
  }
}
