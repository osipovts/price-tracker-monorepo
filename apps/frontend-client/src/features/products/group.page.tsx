import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Pagination,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ApiError, ErrorAlert, useLocale } from 'frontend-shared';
import { type ReactElement, type SyntheticEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { AddProduct } from './add-product.component.js';
import { DeleteGroup } from './delete-group.component.js';
import { DeleteProduct } from './delete-product.component.js';
import { GroupPrices } from './group-prices.component.js';
import { isHttpLink } from './http-link.type.js';
import { MarketplaceBadge } from './marketplace-badge.component.js';
import { formatMoment } from './moment-format.type.js';
import { describeNextCheck } from './next-check.type.js';
import { availabilityLabel, priceOf, toPoints } from './observation.type.js';
import { type ChartLineInterface, PriceChart } from './price-chart.component.js';
import { formatPrice } from './price-format.type.js';
import { buildPriceSeries } from './price-series.type.js';
import { ProductThumbnail } from './product-thumbnail.component.js';
import { styleSeries } from './series-style.type.js';
import {
  type ProductGroupDetailType,
  useProductGroup,
  useRenameGroup,
} from './use-product-groups.hook.js';
import { type ObservationType, usePriceHistories } from './use-products.hook.js';

/** The hours the first chart shows, and the days the second. */
const hoursShown = 48;
const daysShown = 30;
const tablePageSize = 20;

type GroupProductType = ProductGroupDetailType['products'][number];

/** The title with a way to change it. */
function GroupTitle({
  group,
  title,
}: {
  group: ProductGroupDetailType;
  title: string;
}): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const rename = useRenameGroup(group.id);

  if (draft === null) {
    return (
      <Group gap="xs" align="center">
        <Title order={2} fz={{ base: 20, sm: 28 }}>
          {title}
        </Title>
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={(): void => {
            setDraft(group.title ?? title);
          }}
        >
          {t('group.rename')}
        </Button>
      </Group>
    );
  }

  const save = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (draft.trim() === '') return;

    rename.mutate(draft.trim(), {
      onSuccess: (): void => {
        setDraft(null);
      },
    });
  };

  return (
    <form onSubmit={save}>
      <Group align="flex-end" gap="xs">
        <TextInput
          flex="1 1 14rem"
          aria-label={t('group.rename')}
          maxLength={200}
          value={draft}
          onChange={(event): void => {
            setDraft(event.currentTarget.value);
          }}
        />
        <Button type="submit" loading={rename.isPending}>
          {t('group.save')}
        </Button>
        <Button
          variant="default"
          onClick={(): void => {
            setDraft(null);
          }}
        >
          {t('product.cancel')}
        </Button>
      </Group>
      {rename.error !== null && <ErrorAlert error={rename.error} />}
    </form>
  );
}

function GroupHeader({
  group,
  title,
  onDeleted,
}: {
  group: ProductGroupDetailType;
  title: string;
  onDeleted: () => void;
}): ReactElement {
  return (
    <Group wrap="nowrap" align="flex-start" gap="md">
      <ProductThumbnail url={group.thumbnailUrl} alt={title} size={112} />
      <Stack gap="xs" flex={1} miw={0}>
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
          <GroupTitle group={group} title={title} />
          <DeleteGroup groupId={group.id} title={title} onDeleted={onDeleted} />
        </Group>
        <GroupPrices group={group} />
      </Stack>
    </Group>
  );
}

function NextCheck({ product }: { product: GroupProductType }): ReactElement | null {
  const { t } = useTranslation();
  const locale = useLocale();
  const next = describeNextCheck(product.nextCheckAt, new Date(), locale);

  if (next === null) return null;

  return (
    <Text size="sm" c="dimmed">
      {next.soon ? t('product.nextCheckSoon') : t('product.nextCheck', { when: next.when })}
    </Text>
  );
}

/** A product of the group: where it is, its newest price, and its link. */
function ProductRow({
  product,
  color,
}: {
  product: GroupProductType;
  color: string;
}): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const { latest } = product;
  const price = latest === null ? null : priceOf(latest);
  const title = latest?.title ?? `${product.marketplace} ${product.externalId}`;

  return (
    <Card
      withBorder
      padding="sm"
      style={{ borderLeft: `4px solid var(--mantine-color-${color}-6)` }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={4} miw={0} flex={1}>
          <Group gap="xs">
            <MarketplaceBadge marketplace={product.marketplace} />
            {product.cityName !== null && (
              <Badge variant="light" color="gray">
                {t('products.cityOf', { name: product.cityName })}
              </Badge>
            )}
          </Group>
          <Text lineClamp={2} title={title} fw={500}>
            {title}
          </Text>
          <Group gap="xs">
            <Text fw={600}>
              {latest === null
                ? t('products.waiting')
                : price === null
                  ? t('products.noPrice')
                  : formatPrice(price)}
            </Text>
            {latest !== null && <Badge>{availabilityLabel(latest.availability, t)}</Badge>}
          </Group>
          {isHttpLink(product.url) && (
            <Anchor href={product.url} target="_blank" rel="noreferrer noopener" size="sm">
              {t('product.openOn', { marketplace: product.marketplace })}
            </Anchor>
          )}
          <Text size="sm" c="dimmed">
            {t('products.checked')}:{' '}
            {product.lastCheckedAt === null ? '-' : formatMoment(product.lastCheckedAt, locale)}
          </Text>
          <NextCheck product={product} />
        </Stack>
        <DeleteProduct productId={product.id} title={title} />
      </Group>
    </Card>
  );
}

/** The hourly and the daily chart of the prices, a line for each product. */
function PriceCharts({
  products,
  histories,
}: {
  products: GroupProductType[];
  histories: Array<ObservationType[] | undefined>;
}): ReactElement {
  const { t } = useTranslation();
  const lines = useMemo((): { hour: ChartLineInterface[]; day: ChartLineInterface[] } => {
    const now = new Date();
    const styles = styleSeries(products);
    const lineOf = (
      index: number,
      granularity: 'hour' | 'day',
      count: number,
    ): ChartLineInterface[] => {
      const style = styles[index];
      if (style === undefined) return [];

      return [
        {
          ...style,
          buckets: buildPriceSeries(toPoints(histories[index] ?? []), granularity, count, now),
        },
      ];
    };

    return {
      hour: products.flatMap((_, index) => lineOf(index, 'hour', hoursShown)),
      day: products.flatMap((_, index) => lineOf(index, 'day', daysShown)),
    };
  }, [products, histories]);

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <PriceChart
        title={t('product.hourlyTitle', { count: hoursShown })}
        granularity="hour"
        lines={lines.hour}
      />
      <PriceChart
        title={t('product.dailyTitle', { count: daysShown })}
        granularity="day"
        lines={lines.day}
      />
    </SimpleGrid>
  );
}

/** All the observations of all the products, the newest first, a page at a time. */
function HistoryTable({
  rows,
}: {
  rows: Array<{ marketplace: string; observation: ObservationType }>;
}): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const shown = rows.slice((page - 1) * tablePageSize, page * tablePageSize);

  return (
    <>
      <Title order={4}>{t('product.history')}</Title>
      <Table.ScrollContainer minWidth={300}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('product.observed')}</Table.Th>
              <Table.Th>{t('products.product')}</Table.Th>
              <Table.Th>{t('product.price')}</Table.Th>
              <Table.Th>{t('product.availability')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map(({ marketplace, observation }): ReactElement => {
              const amountMinor = priceOf(observation);

              return (
                <Table.Tr key={observation.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {formatMoment(observation.observedAt, locale)}
                  </Table.Td>
                  <Table.Td>
                    <MarketplaceBadge marketplace={marketplace} />
                  </Table.Td>
                  <Table.Td>{amountMinor === null ? '-' : formatPrice(amountMinor)}</Table.Td>
                  <Table.Td>{availabilityLabel(observation.availability, t)}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {rows.length === 0 && <Text c="dimmed">{t('product.noHistory')}</Text>}
      {rows.length > tablePageSize && (
        <Pagination
          total={Math.max(1, Math.ceil(rows.length / tablePageSize))}
          value={page}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function GroupPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const group = useProductGroup(id);
  const data = group.data;
  const products = useMemo((): GroupProductType[] => data?.products ?? [], [data]);
  const histories = usePriceHistories(products.map((product): string => product.id));
  const observations = histories.map(
    (history): ObservationType[] | undefined => history.data?.observations,
  );
  const rows = products
    .flatMap((product, index) =>
      (observations[index] ?? []).map((observation) => ({
        marketplace: product.marketplace,
        observation,
      })),
    )
    .toSorted((a, b): number => b.observation.observedAt.localeCompare(a.observation.observedAt));

  if (group.error instanceof ApiError && group.error.status === 404) {
    return (
      <Stack>
        <Text>{t('group.notFound')}</Text>
        <Anchor component={Link} to="/">
          {t('common.backToProducts')}
        </Anchor>
      </Stack>
    );
  }
  if (group.isError) return <ErrorAlert error={group.error} />;
  if (data === undefined) return <Loader />;

  const title = data.title ?? t('groups.untitled');
  const colors = styleSeries(products);

  return (
    <Stack>
      <Anchor component={Link} to="/" size="sm">
        {t('common.backToProducts')}
      </Anchor>
      <GroupHeader
        group={data}
        title={title}
        onDeleted={(): void => {
          void navigate('/');
        }}
      />
      <Title order={4}>{t('group.products', { count: products.length })}</Title>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        {products.map((product, index): ReactElement => (
          <ProductRow key={product.id} product={product} color={colors[index]?.color ?? 'gray'} />
        ))}
      </SimpleGrid>
      {products.length === 0 && <Text c="dimmed">{t('group.empty')}</Text>}
      <Card withBorder>
        <Stack gap="xs">
          <Text fw={500}>{t('group.addProduct')}</Text>
          <AddProduct groupId={data.id} />
        </Stack>
      </Card>
      <PriceCharts products={products} histories={observations} />
      <HistoryTable rows={rows} />
    </Stack>
  );
}
