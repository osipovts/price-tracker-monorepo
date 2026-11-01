import { Badge } from '@mantine/core';
import type { ReactElement } from 'react';

/** The colour of each marketplace; one the app does not know yet is grey. */
const marketplaceColors: Record<string, string> = { ozon: 'blue', dns: 'orange' };

export function marketplaceColor(marketplace: string): string {
  return marketplaceColors[marketplace] ?? 'gray';
}

/** The name of a marketplace in its colour; all the badges are as wide as one another. */
export function MarketplaceBadge({ marketplace }: { marketplace: string }): ReactElement {
  return (
    <Badge color={marketplaceColor(marketplace)} variant="filled" w={64} style={{ flexShrink: 0 }}>
      {marketplace}
    </Badge>
  );
}
