import { type MantineSize, Text } from '@mantine/core';
import type { ReactElement } from 'react';

/** The colour of each marketplace; one the app does not know yet is grey. */
const marketplaceColors: Record<string, string> = { ozon: 'blue', dns: 'orange', wildberries: 'grape' };

export function marketplaceColor(marketplace: string): string {
  return marketplaceColors[marketplace] ?? 'gray';
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
      {marketplace}
    </Text>
  );
}
