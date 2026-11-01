import { Badge, Group, Stack, Text } from '@mantine/core';
import { useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { MarketplaceBadge } from './marketplace-badge.component.js';
import { formatPrice } from './price-format.type.js';
import { formatPriceMoment } from './price-moment.type.js';
import type { ProductGroupType } from './use-product-groups.hook.js';

type PriceType = NonNullable<ProductGroupType['current']>;

/** A price with the marketplace it is on and the moment it was seen. */
function PriceLine({
  label,
  price,
  highlighted = false,
  large = false,
}: {
  label: string;
  price: PriceType | null;
  highlighted?: boolean;
  large?: boolean;
}): ReactElement {
  const locale = useLocale();

  return (
    <Group gap="xs" wrap="wrap" align="center" data-testid={`price-${label}`}>
      <Text size="sm" c="dimmed" w={72}>
        {label}
      </Text>
      {price === null ? (
        <Text size="sm">-</Text>
      ) : (
        <>
          <MarketplaceBadge marketplace={price.marketplace} />
          {highlighted ? (
            <Badge color="green" variant="light" size={large ? 'xl' : 'lg'} data-highlighted="true">
              {formatPrice(price.amountMinor)}
            </Badge>
          ) : (
            <Text fw={large ? 700 : 500} size={large ? 'xl' : 'md'}>
              {formatPrice(price.amountMinor)}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {formatPriceMoment(price.observedAt, locale)}
          </Text>
        </>
      )}
    </Group>
  );
}

/** The best price now, in green when it is not above the lowest of the period, and the lowest and the highest one. */
export function GroupPrices({ group }: { group: ProductGroupType }): ReactElement {
  const { t } = useTranslation();

  return (
    <Stack gap={4}>
      <PriceLine
        label={t('groups.priceNow')}
        price={group.current}
        highlighted={group.highlighted}
        large
      />
      <PriceLine label={t('groups.priceMin')} price={group.min} />
      <PriceLine label={t('groups.priceMax')} price={group.max} />
    </Stack>
  );
}
