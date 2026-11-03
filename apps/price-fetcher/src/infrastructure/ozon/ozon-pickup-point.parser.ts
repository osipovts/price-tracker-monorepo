/** The first pickup point of a list Ozon answers with for the place asked: the links of its cards name the points. */
export class OzonPickupPointParser {
  /** Null when the answer names no point. */
  parse(answer: string): string | null {
    return /pp(?:=|%3D)(\d{5,})/.exec(answer)?.[1] ?? null;
  }
}
