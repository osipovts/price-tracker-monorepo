import './list-row.css';
import './waiting-glint.css';

import { Box, Button, Group, Loader, Pagination, Paper, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { ErrorAlert } from 'frontend-shared';
import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LineIcon } from './action-icons.component.js';
import { AddProductModal } from './add-product-modal.component.js';
import { BestPrice } from './group-prices.component.js';
import { MarketplaceName } from './marketplace-name.component.js';
import { hasPendingAdd } from './pending-add.type.js';
import { PriceChecks } from './price-checks.component.js';
import { ProductThumbnail } from './product-thumbnail.component.js';
import {
  groupPageSize,
  type ProductGroupPageType,
  type ProductGroupType,
  useProductGroups,
} from './use-product-groups.hook.js';

/** When the prices of the group were read last, and on which marketplace. */
function GroupLastCheck({ group }: { group: ProductGroupType }): ReactElement {
  const { lastCheck } = group;

  return (
    <PriceChecks
      checks={{
        checkedAt: lastCheck?.checkedAt ?? null,
        marketplace: lastCheck?.marketplace ?? null,
        nextAt: null,
      }}
    />
  );
}

/** The best price of the group, and the marketplace it is on under it. */
function GroupBestPrice({ group }: { group: ProductGroupType }): ReactElement {
  return (
    <Stack gap={0} align="flex-end">
      <BestPrice group={group} fz={{ base: 'md', sm: 'lg' }} />
      {group.current !== null && <MarketplaceName marketplace={group.current.marketplace} />}
    </Stack>
  );
}

/** A group in one line: what it is on the left, the best price of it and where on the right. */
function GroupRow({ group }: { group: ProductGroupType }): ReactElement {
  const { t } = useTranslation();
  const title = group.title ?? t('groups.untitled');
  // Still waiting for the first price: a glint runs over the row until it comes.
  const waiting = group.productCount > 0 && group.title === null;

  return (
    <Box
      component={Link}
      to={`/groups/${group.id}`}
      className="list-row row-link"
      py="sm"
      data-waiting={waiting ? 'true' : undefined}
    >
      <Group wrap="nowrap" gap="md">
        <ProductThumbnail url={group.thumbnailUrl} alt={title} size={56} />
        <Stack gap={2} flex={1} miw={0}>
          {/* A title can be a paragraph: one line of the row, the whole of it in the hint. */}
          <Text className="row-title" fw={500} truncate title={title}>
            {title}
          </Text>
          {waiting ? (
            <Text size="xs" c="dimmed">
              {t('products.waiting')}
            </Text>
          ) : (
            <GroupLastCheck group={group} />
          )}
        </Stack>
        {!waiting && <GroupBestPrice group={group} />}
      </Group>
    </Box>
  );
}

/** Nothing is tracked yet: what the page is for, and the way to start. */
function EmptyList({ onAdd }: { onAdd: () => void }): ReactElement {
  const { t } = useTranslation();

  return (
    <Paper withBorder radius="md" py={48} px="md">
      <Stack align="center" gap="xs" maw={420} mx="auto" ta="center">
        <Text fw={500} size="lg">
          {t('products.empty')}
        </Text>
        <Text size="sm" c="dimmed">
          {t('products.emptyHint')}
        </Text>
        <Button mt="sm" leftSection={<LineIcon name="plus" />} onClick={onAdd}>
          {t('products.addFirst')}
        </Button>
      </Stack>
    </Paper>
  );
}

/** The groups of a page, and the way to the other pages when there are more. */
function GroupList({
  data,
  page,
  onPage,
}: {
  data: ProductGroupPageType;
  page: number;
  onPage: (page: number) => void;
}): ReactElement {
  return (
    <>
      <Box>
        {data.items.map((group): ReactElement => (
          <GroupRow key={group.id} group={group} />
        ))}
      </Box>
      {data.total > groupPageSize && (
        <Pagination
          total={Math.max(1, Math.ceil(data.total / groupPageSize))}
          value={page}
          onChange={onPage}
        />
      )}
    </>
  );
}

export function ProductsPage(): ReactElement {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const groups = useProductGroups(page);
  const data = groups.data;
  // The form opens by itself when a reload cut short a product being added.
  const [adding, { open, close }] = useDisclosure(hasPendingAdd(null));
  const empty = data?.items.length === 0 && page === 1;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" gap="sm">
        <Title order={2}>{t('products.title')}</Title>
        {/* Not while the list loads: an empty one offers its own button in its place. */}
        {data !== undefined && !empty && (
          <Button leftSection={<LineIcon name="plus" />} onClick={open}>
            {t('products.add')}
          </Button>
        )}
      </Group>
      {groups.isError && <ErrorAlert error={groups.error} />}
      {data === undefined ? (
        !groups.isError && <Loader />
      ) : empty ? (
        <EmptyList onAdd={open} />
      ) : (
        <GroupList data={data} page={page} onPage={setPage} />
      )}
      <AddProductModal groupId={null} opened={adding} onClose={close} />
    </Stack>
  );
}
