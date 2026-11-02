import { marketplaceColor } from './marketplace-name.component.js';

export interface SeriesProductInterface {
  id: string;
  marketplace: string;
  cityName: string | null;
}

export interface SeriesStyleInterface {
  id: string;
  /** What the legend and the tooltip call the line of the product. */
  label: string;
  /** A colour of the Mantine palette. */
  color: string;
}

/** Colours for the second and the following product of one marketplace, which cannot all have its own. */
const spareColors = ['teal', 'grape', 'pink', 'cyan', 'lime'];

/**
 * The line of a product has the colour of its marketplace; a second product of the same marketplace
 * takes a colour of its own, and its name tells it from the first by the city or the number.
 */
export function styleSeries(products: readonly SeriesProductInterface[]): SeriesStyleInterface[] {
  const used = new Set<string>();
  let spare = 0;

  return products.map((product): SeriesStyleInterface => {
    let color = marketplaceColor(product.marketplace);
    if (used.has(color)) {
      color = spareColors[spare % spareColors.length] ?? 'gray';
      spare += 1;
    }
    used.add(color);

    const sameMarketplace = products.filter(
      (other): boolean => other.marketplace === product.marketplace,
    );
    const city = product.cityName === null ? '' : `, ${product.cityName}`;
    const number =
      sameMarketplace.length > 1 && product.cityName === null
        ? ` #${String(sameMarketplace.indexOf(product) + 1)}`
        : '';

    return { id: product.id, label: `${product.marketplace}${city}${number}`, color };
  });
}
