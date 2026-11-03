export interface CitilinkPageInterface {
  /** The final URL after redirects. */
  url: string;
  /** The state the server rendered the page from (`__NEXT_DATA__`), as text; empty when the page has none. */
  state: string;
}
