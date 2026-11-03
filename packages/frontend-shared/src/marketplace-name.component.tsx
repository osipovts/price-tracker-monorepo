import { type MantineSize, Text } from '@mantine/core';
import type { ReactElement } from 'react';

/** The colour of each marketplace; one the app does not know yet is grey. */
const marketplaceColors: Record<string, string> = {
  ozon: 'blue',
  dns: 'orange',
  wildberries: 'grape',
  citilink: 'red',
};

/** The short names of the marketplaces whose own is long; the others are shown by their own. */
const marketplaceShortNames: Record<string, string> = { wildberries: 'wb' };

export function marketplaceColor(marketplace: string): string {
  return marketplaceColors[marketplace] ?? 'gray';
}

/** The name the apps show for a marketplace. */
export function marketplaceName(marketplace: string): string {
  return marketplaceShortNames[marketplace] ?? marketplace;
}

/** The name of a marketplace as a word in its colour. */
export function MarketplaceName({
  marketplace,
  size = 'xs',
}: {
  marketplace: string;
  size?: MantineSize;
}): ReactElement {
  return (
    <Text component="span" size={size} fw={500} c={marketplaceColor(marketplace)}>
      {marketplaceName(marketplace)}
    </Text>
  );
}
