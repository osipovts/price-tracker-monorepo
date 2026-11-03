export interface WildberriesPageInterface {
  /** The final URL after redirects. */
  url: string;
  /** The pictures of products the page shows: the gallery of the product and those of others. */
  imageUrls: string[];
  /** What the card service answered the page about the product; empty when it gave no answer. */
  card: string;
}
