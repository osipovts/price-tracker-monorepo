/** The kopecks are shown only when there are some: a whole price reads faster without ",00". */
const rubles = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  trailingZeroDisplay: 'stripIfInteger',
});

/** Amounts of the hub are in kopecks. */
export function formatPrice(amountMinor: number): string {
  return rubles.format(amountMinor / 100);
}

const wholeRubles = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

/** For the axis of a chart, where the kopecks only take the room of the line. */
export function formatPriceShort(amountMinor: number): string {
  return wholeRubles.format(amountMinor / 100);
}
