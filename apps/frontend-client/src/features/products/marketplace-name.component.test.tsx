import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { marketplaceColor, MarketplaceName } from './marketplace-name.component.js';

test('ozon is blue, dns is orange, and a marketplace not known yet is grey', () => {
  expect(marketplaceColor('ozon')).toBe('blue');
  expect(marketplaceColor('dns')).toBe('orange');
  expect(marketplaceColor('wb')).toBe('gray');
});

test('shows the name of the marketplace', () => {
  render(
    <MantineProvider>
      <MarketplaceName marketplace="dns" />
    </MantineProvider>,
  );

  expect(screen.getByText('dns')).toBeInTheDocument();
});
