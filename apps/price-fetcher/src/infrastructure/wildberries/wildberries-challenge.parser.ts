/** Recognizes the antibot check Wildberries answers with instead of its pages. */
export class WildberriesChallengeParser {
  /** The check answers HTTP 498; a browser that passes it is let through to the page with HTTP 200. */
  isChallenge(httpStatus: number): boolean {
    return httpStatus === 498;
  }
}
