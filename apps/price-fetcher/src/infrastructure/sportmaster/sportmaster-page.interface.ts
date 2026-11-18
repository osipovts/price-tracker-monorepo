export interface SportmasterPageInterface {
  /** The final URL after redirects. */
  url: string;
  /** The JSON-LD blocks of the page, as text. */
  structuredData: string[];
  /** The city reported by the rendered page. */
  cityId: string | null;
  /** Whether Qrator serves its browser check instead of the product. */
  hasChallenge: boolean;
}
