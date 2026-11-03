export interface WildberriesPageInterface {
  /** The final URL after redirects. */
  url: string;
  title: string;
  body: string;
  /** The picture the page names for sharing (`og:image`); empty when it names none. */
  imageUrl: string;
  /** What the card service answered the page about the product; empty when it gave no answer. */
  card: string;
}
