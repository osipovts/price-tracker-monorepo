import { marketplaceColor } from 'frontend-shared';

export type ChartSchemeType = 'light' | 'dark';

/**
 * The shade of each colour a chart draws with, in each scheme: checked for the lightness, the chroma, the
 * contrast with the page and the separation for the colour-blind (orange and red are deeper than the others).
 */
const chartShades: Record<string, Record<ChartSchemeType, number>> = {
  blue: { light: 6, dark: 5 },
  orange: { light: 8, dark: 8 },
  grape: { light: 6, dark: 5 },
  red: { light: 8, dark: 8 },
  gray: { light: 6, dark: 5 },
  green: { light: 7, dark: 6 },
};

/** A colour of Mantine at the shade a chart takes in the scheme. */
export function chartColor(color: string, scheme: ChartSchemeType): string {
  const shade = chartShades[color]?.[scheme] ?? 6;

  return `var(--mantine-color-${color}-${String(shade)})`;
}

/** The colour of a marketplace on a chart: the one the apps give it. */
export function marketplaceChartColor(marketplace: string, scheme: ChartSchemeType): string {
  return chartColor(marketplaceColor(marketplace), scheme);
}
