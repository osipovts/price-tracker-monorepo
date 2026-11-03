/** Recognizes the antibot check Wildberries shows instead of its pages. */
export class WildberriesChallengeParser {
  isChallenge(title: string, body: string): boolean {
    return /antibot|captcha|почти готово|проверяем браузер|подозрительн|доступ ограничен/i.test(
      `${title}\n${body.slice(0, 4000)}`,
    );
  }
}
