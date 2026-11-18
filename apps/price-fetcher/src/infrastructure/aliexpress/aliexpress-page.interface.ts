export interface AliexpressPageInterface {
  /** The final URL after redirects. */
  url: string;
  /** The city reported by the rendered page. */
  cityId: string | null;
  /** What the product data service answered the page about the product; empty when it gave no answer. */
  productData: string;
  /** Whether the site served its antibot check instead of the product. */
  hasChallenge: boolean;
}
