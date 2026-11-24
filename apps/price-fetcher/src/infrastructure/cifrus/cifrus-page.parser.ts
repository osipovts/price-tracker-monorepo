import type { Page } from 'playwright-core';

import type { CifrusPageInterface } from './cifrus-page.interface.js';

/** Reads the product markup, selected city, and challenge markers from a Cifrus page. */
export class CifrusPageParser {
  parse(browserPage: Page): Promise<CifrusPageInterface> {
    return browserPage.evaluate((): CifrusPageInterface => {
      const scripts = Array.from(window.document.scripts);
      const hasChallenge =
        window.document.querySelector('.g-recaptcha') !== null ||
        scripts.some(
          (script): boolean =>
            script.src.includes('google.com/recaptcha') ||
            script.textContent.includes('/unlock.php'),
        );

      let cityId: string | null = null;
      for (const script of scripts) {
        const match = /\bCIFRUS_CITY\s*=\s*\{[\s\S]*?\bid\s*:\s*['"]?([1-9]\d*)['"]?/.exec(
          script.textContent,
        );
        if (match?.[1] !== undefined) {
          cityId = match[1];
          break;
        }
      }

      const productRoot =
        window.document.querySelector(
          '#content [itemscope][itemtype="https://schema.org/Product"]:not([itemprop="itemListElement"])',
        ) ??
        window.document.querySelector(
          '[itemscope][itemtype="https://schema.org/Product"]:not([itemprop="itemListElement"])',
        );
      const offer = productRoot?.querySelector('[itemprop="offers"]') ?? null;
      const rawImage =
        productRoot?.querySelector('link[itemprop="image"]')?.getAttribute('href') ??
        productRoot?.querySelector('img[itemprop="image"]')?.getAttribute('src') ??
        window.document.querySelector('meta[property="og:image"]')?.getAttribute('content') ??
        '';
      const trimmedImage = rawImage.trim();

      return {
        url: window.location.href,
        cityId,
        heading: productRoot?.querySelector('h1')?.textContent.trim() ?? '',
        offerPrice:
          offer?.querySelector('meta[itemprop="price"]')?.getAttribute('content')?.trim() ?? '',
        offerCurrency:
          offer?.querySelector('meta[itemprop="priceCurrency"]')?.getAttribute('content')?.trim() ??
          '',
        offerAvailability:
          offer?.querySelector('[itemprop="availability"]')?.getAttribute('href')?.trim() ??
          offer?.querySelector('[itemprop="availability"]')?.getAttribute('content')?.trim() ??
          '',
        displayedPriceText:
          productRoot?.querySelector('.product-price .new-price')?.textContent.trim() ??
          productRoot?.querySelector('.product-price')?.textContent.trim() ??
          '',
        hasOutOfStockBadge: productRoot?.querySelector('.outstock') !== null,
        hasBuyButton:
          productRoot?.querySelector('#cart1 [onclick*="buy("], #cart_fly [onclick*="buy("]') !==
          null,
        imageUrl:
          trimmedImage === '' ? '' : (URL.parse(trimmedImage, window.location.origin)?.href ?? ''),
        hasChallenge,
      };
    });
  }
}
