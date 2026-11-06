import './list-row.css';

import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  CloseButton,
  Collapse,
  Group,
  Loader,
  Menu,
  Pagination,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  useDisclosure,
  useElementSize,
  useLocalStorage,
  type UseStorageOptions,
} from '@mantine/hooks';
import { ApiError, ErrorAlert, MarketplaceName, marketplaceName, useLocale } from 'frontend-shared';
import { type ReactElement, type SyntheticEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { LineIcon } from './action-icons.component.js';
import { AddProductModal } from './add-product-modal.component.js';
import { chartPointsFitting } from './chart-layout.type.js';
import { DeleteGroup } from './delete-group.component.js';
import { DeleteProduct } from './delete-product.component.js';
import { BestPrice } from './group-prices.component.js';
import { isHttpLink } from './http-link.type.js';
import { formatMoment } from './moment-format.type.js';
import { availabilityLabel, priceOf, toPoints } from './observation.type.js';
import { hasPendingAdd } from './pending-add.type.js';
import { type ChartLineInterface, PriceChart } from './price-chart.component.js';
import { PriceChecks } from './price-checks.component.js';
import { formatPrice } from './price-format.type.js';
import { buildPriceSeries, granularities, type GranularityType } from './price-series.type.js';
import { ProductThumbnail } from './product-thumbnail.component.js';
import { type SeriesStyleInterface, styleSeries } from './series-style.type.js';
import {
  type ProductGroupDetailType,
  useProductGroup,
  useRenameGroup,
} from './use-product-groups.hook.js';
import { type ObservationType, usePriceHistories } from './use-products.hook.js';

/** A point of the chart is an hour, a day or a week. */
const granularityLabels = {
  hour: 'group.byHour',
  day: 'group.byDay',
  week: 'group.byWeek',
} as const satisfies Record<GranularityType, string>;
const tablePageSize = 20;

/** A point a day, before any scale is picked. */
const defaultGranularity: GranularityType = 'day';
/** The scale the person picked last is kept by the browser. */
const granularityStorage: UseStorageOptions<GranularityType> & { defaultValue: GranularityType } = {
  key: 'chartGranularity',
  defaultValue: defaultGranularity,
  // Read at once, not after the first paint: the chart would be drawn twice.
  getInitialValueInEffect: false,
  serialize: (granularity: GranularityType): string => granularity,
  deserialize: (stored: string | undefined): GranularityType =>
    granularities.find((granularity): boolean => granularity === stored) ?? defaultGranularity,
};

type GroupProductType = ProductGroupDetailType['products'][number];

interface HistoryRowInterface {
  productId: string;
  observation: ObservationType;
}

const seriesDotSize = 10;
/** The cross of an offer, and the height of the line of it, for the name and the price to stand level with it. */
const crossSize = 28;

/** The mark of a product in the list, the chart and the table: the colour of its line. */
function SeriesDot({ color }: { color: string }): ReactElement {
  return (
    <Box
      w={seriesDotSize}
      h={seriesDotSize}
      bg={`var(--mantine-color-${color}-6)`}
      style={{ borderRadius: '50%', flexShrink: 0 }}
    />
  );
}

/** The title being changed, in place of the title. */
function RenameForm({
  group,
  title,
  onDone,
}: {
  group: ProductGroupDetailType;
  title: string;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(group.title ?? title);
  const rename = useRenameGroup(group.id);

  const save = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (draft.trim() === '') return;

    rename.mutate(draft.trim(), { onSuccess: onDone });
  };

  return (
    <Box component="form" onSubmit={save} flex={1}>
      <Group align="flex-end" gap="xs">
        <TextInput
          flex="1 1 14rem"
          aria-label={t('group.rename')}
          maxLength={200}
          autoFocus
          value={draft}
          onChange={(event): void => {
            setDraft(event.currentTarget.value);
          }}
        />
        <Button type="submit" loading={rename.isPending}>
          {t('group.save')}
        </Button>
        <Button variant="default" onClick={onDone}>
          {t('product.cancel')}
        </Button>
      </Group>
      {rename.error !== null && <ErrorAlert error={rename.error} />}
    </Box>
  );
}

/** The picture, the title, and the best price of the group: what the page is for, at the top of it. */
function GroupHeader({
  group,
  title,
  onAdd,
  onDeleted,
}: {
  group: ProductGroupDetailType;
  title: string;
  onAdd: () => void;
  onDeleted: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [deleting, deletion] = useDisclosure(false);

  return (
    <Group wrap="nowrap" align="stretch" gap="md">
      <Box visibleFrom="xs">
        <ProductThumbnail url={group.thumbnailUrl} alt={title} size={96} />
      </Box>
      {/* The price stands on the lower edge of the picture. */}
      <Stack gap={6} flex={1} miw={0} justify="space-between">
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
          {renaming ? (
            <RenameForm
              group={group}
              title={title}
              onDone={(): void => {
                setRenaming(false);
              }}
            />
          ) : (
            // A title can be a paragraph: one line of the header, the whole of it in the hint.
            <Title
              order={2}
              fz={{ base: 20, sm: 24 }}
              lh={1.3}
              fw={600}
              lineClamp={1}
              title={title}
              flex={1}
              miw={0}
            >
              {title}
            </Title>
          )}
          <Menu position="bottom-end" width={220} shadow="md">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="lg" aria-label={t('group.actions')}>
                <LineIcon name="dots" size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={(): void => {
                  setRenaming(true);
                }}
              >
                {t('group.rename')}
              </Menu.Item>
              <Menu.Item color="red" onClick={deletion.open}>
                {t('groups.delete')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
        {/* The best price, and at the right of it, on its lower edge, the same button as the one of the list of groups. */}
        <Group justify="space-between" align="flex-end" wrap="nowrap" gap="sm" mt={4}>
          <Group gap="sm" align="baseline">
            <BestPrice group={group} fz={{ base: 32, sm: 40 }} lh={1} />
            {group.current !== null && (
              <MarketplaceName marketplace={group.current.marketplace} size="md" />
            )}
          </Group>
          <Button leftSection={<LineIcon name="plus" />} onClick={onAdd}>
            {t('products.add')}
          </Button>
        </Group>
      </Stack>
      <DeleteGroup
        groupId={group.id}
        title={title}
        opened={deleting}
        onClose={deletion.close}
        onDeleted={onDeleted}
      />
    </Group>
  );
}

interface LinkPropsInterface {
  component: 'a';
  href: string;
  target: string;
  rel: string;
  title: string;
}

/** An offer leads to it on its marketplace; an address that is not a web page leads nowhere. */
function linkProps(url: string, title: string): LinkPropsInterface | Record<string, never> {
  return isHttpLink(url)
    ? {
        component: 'a',
        href: url,
        target: '_blank',
        rel: 'noreferrer noopener',
        title,
      }
    : {};
}

/** Under the name of an offer: that it waits for its first price, or when its price was read and is read next. */
function OfferNote({ product }: { product: GroupProductType }): ReactElement {
  const { t } = useTranslation();

  if (product.latest === null) {
    return (
      <Text size="xs" c="dimmed">
        {t('products.waiting')}. {t('products.waitingHint')}
      </Text>
    );
  }

  return (
    <PriceChecks
      checks={{ checkedAt: product.lastCheckedAt, marketplace: null, nextAt: product.nextCheckAt }}
    />
  );
}

/** The newest price of an offer; struck out, with a hint, when it is out of stock. */
function OfferPrice({
  product,
  best,
}: {
  product: GroupProductType;
  best: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const { latest } = product;
  if (latest === null) return null;

  const price = priceOf(latest);
  if (price === null) {
    return (
      <Text c="dimmed" size="sm">
        {t('products.noPrice')}
      </Text>
    );
  }

  const absent = latest.availability === 'out_of_stock';

  return (
    <Text
      fw={best ? 700 : 500}
      fz={{ base: 'md', sm: 'lg' }}
      {...(absent ? { c: 'dimmed', td: 'line-through', title: t('product.absentHint') } : {})}
      style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
    >
      {formatPrice(price)}
    </Text>
  );
}

/**
 * A product of the group, a row like the one of a group in the list: where it is and its newest price on the
 * first line, its checks on the second, all of it a link to it; and apart from the link, the way to stop tracking it.
 */
function OfferRow({
  product,
  style,
  best,
}: {
  product: GroupProductType;
  style: SeriesStyleInterface;
  best: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [deleting, deletion] = useDisclosure(false);
  const title =
    product.latest?.title ?? `${marketplaceName(product.marketplace)} ${product.externalId}`;
  const link = linkProps(
    product.url,
    t('product.openOn', { marketplace: marketplaceName(product.marketplace) }),
  );
  const struck =
    product.latest?.availability === 'out_of_stock' ? { c: 'dimmed', td: 'line-through' } : {};

  return (
    <Box className="list-row" py="sm" title={title}>
      <Group wrap="nowrap" gap="sm" align="flex-start">
        <Box {...link} className="row-link" flex={1} miw={0}>
          <Group wrap="nowrap" gap="sm" mih={crossSize}>
            <SeriesDot color={style.color} />
            <Text className="row-title" fw={500} truncate flex={1} miw={0} {...struck}>
              {style.label}
            </Text>
            <OfferPrice product={product} best={best} />
          </Group>
          {/* Under the name, not under the dot. */}
          <Box pl={`calc(${String(seriesDotSize)}px + var(--mantine-spacing-sm))`}>
            <OfferNote product={product} />
          </Box>
        </Box>
        <CloseButton
          size={crossSize}
          aria-label={t('product.delete')}
          title={t('product.delete')}
          onClick={deletion.open}
        />
      </Group>
      <DeleteProduct
        productId={product.id}
        title={title}
        opened={deleting}
        onClose={deletion.close}
      />
    </Box>
  );
}

/** The order of the offers: the cheapest of those in stock first, then those out of stock, then those with no price. */
function offerRank(product: GroupProductType): [number, number] {
  const price = product.latest === null ? null : priceOf(product.latest);
  if (price === null) return [2, 0];

  return [product.latest?.availability === 'out_of_stock' ? 1 : 0, price];
}

function byOffer(a: GroupProductType, b: GroupProductType): number {
  const [rankA, priceA] = offerRank(a);
  const [rankB, priceB] = offerRank(b);

  return rankA - rankB || priceA - priceB;
}

/** Where the product can be bought, the cheapest first. */
function Offers({
  products,
  styles,
}: {
  products: GroupProductType[];
  styles: SeriesStyleInterface[];
}): ReactElement {
  const { t } = useTranslation();
  const sorted = products.toSorted(byOffer);
  const [first] = sorted;
  const bestId = first !== undefined && offerRank(first)[0] === 0 ? first.id : null;

  if (products.length === 0) return <Text c="dimmed">{t('group.empty')}</Text>;

  return (
    <Box>
      {sorted.flatMap((product): ReactElement[] => {
        // Each product has its style: the styles are made of these very products.
        const style = styles.find((candidate): boolean => candidate.id === product.id);

        return style === undefined
          ? []
          : [
              <OfferRow
                key={product.id}
                product={product}
                style={style}
                best={product.id === bestId}
              />,
            ];
      })}
    </Box>
  );
}

/** All the observations of all the products, the newest first, a page at a time. */
function HistoryTable({
  rows,
  styles,
}: {
  rows: HistoryRowInterface[];
  styles: SeriesStyleInterface[];
}): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const shown = rows.slice((page - 1) * tablePageSize, page * tablePageSize);

  return (
    <Stack gap="xs">
      <Table.ScrollContainer minWidth={300}>
        <Table verticalSpacing={6} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('product.observed')}</Table.Th>
              <Table.Th>{t('products.product')}</Table.Th>
              <Table.Th>{t('product.price')}</Table.Th>
              <Table.Th>{t('product.availability')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map(({ productId, observation }): ReactElement => {
              const amountMinor = priceOf(observation);
              const style = styles.find((candidate): boolean => candidate.id === productId);

              return (
                <Table.Tr key={observation.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {formatMoment(observation.observedAt, locale)}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <SeriesDot color={style?.color ?? 'gray'} />
                      <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                        {style?.label}
                      </Text>
                    </Group>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {amountMinor === null ? '-' : formatPrice(amountMinor)}
                  </Table.Td>
                  <Table.Td>{availabilityLabel(observation.availability, t)}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {rows.length > tablePageSize && (
        <Pagination
          size="sm"
          total={Math.max(1, Math.ceil(rows.length / tablePageSize))}
          value={page}
          onChange={setPage}
        />
      )}
    </Stack>
  );
}

/** The chart of the prices, a line for each product, by hour or by day; the raw checks under it on demand. */
function PriceHistory({
  products,
  styles,
  histories,
}: {
  products: GroupProductType[];
  styles: SeriesStyleInterface[];
  histories: Array<ObservationType[] | undefined>;
}): ReactElement {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useLocalStorage<GranularityType>(granularityStorage);
  const [tableShown, table] = useDisclosure(false);
  // As many points as the width keeps apart, the same number on any wide screen.
  const chart = useElementSize();
  const pointCount = chartPointsFitting(chart.width);
  const lines = useMemo((): ChartLineInterface[] => {
    const now = new Date();

    return styles.map((style, index): ChartLineInterface => ({
      ...style,
      buckets: buildPriceSeries(toPoints(histories[index] ?? []), granularity, pointCount, now),
    }));
  }, [styles, histories, granularity, pointCount]);
  const rows = products
    .flatMap((product, index): HistoryRowInterface[] =>
      (histories[index] ?? []).map((observation): HistoryRowInterface => ({
        productId: product.id,
        observation,
      })),
    )
    .toSorted((a, b): number => b.observation.observedAt.localeCompare(a.observation.observedAt));

  return (
    // Two parts of the page: the checks are as far from the chart as the chart is from the offers.
    <>
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Title order={3} fz="lg" fw={600}>
            {t('group.history')}
          </Title>
          <SegmentedControl
            size="xs"
            value={granularity}
            data={granularities.map((value): { value: string; label: string } => ({
              value,
              label: t(granularityLabels[value]),
            }))}
            onChange={(value): void => {
              const chosen = granularities.find((candidate): boolean => candidate === value);
              if (chosen !== undefined) setGranularity(chosen);
            }}
          />
        </Group>
        {rows.length === 0 ? (
          <Text c="dimmed">{t('product.noHistory')}</Text>
        ) : (
          <Paper ref={chart.ref} withBorder radius="md" p={{ base: 'xs', sm: 'md' }}>
            <PriceChart granularity={granularity} lines={lines} />
          </Paper>
        )}
      </Stack>
      {rows.length > 0 && (
        <Stack gap="xs">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            w="fit-content"
            onClick={table.toggle}
          >
            {tableShown
              ? t('group.hideObservations')
              : t('group.observations', { count: rows.length })}
          </Button>
          <Collapse expanded={tableShown}>
            <HistoryTable rows={rows} styles={styles} />
          </Collapse>
        </Stack>
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
  const styles = useMemo((): SeriesStyleInterface[] => styleSeries(products), [products]);
  const histories = usePriceHistories(products.map((product): string => product.id));
  const observations = histories.map(
    (history): ObservationType[] | undefined => history.data?.observations,
  );
  // The form opens by itself when a reload cut short a product being added to this group.
  const [adding, { open, close }] = useDisclosure(hasPendingAdd(id));

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

  return (
    <Stack gap="xl">
      <Stack gap="md">
        <Anchor component={Link} to="/" size="sm" c="dimmed" w="fit-content">
          <Group gap={4} wrap="nowrap">
            <LineIcon name="arrowLeft" size={14} />
            {t('common.backToProducts')}
          </Group>
        </Anchor>
        <GroupHeader
          group={data}
          title={title}
          onAdd={open}
          onDeleted={(): void => {
            void navigate('/');
          }}
        />
      </Stack>
      <Offers products={products} styles={styles} />
      <PriceHistory products={products} styles={styles} histories={observations} />
      <AddProductModal groupId={data.id} opened={adding} onClose={close} />
    </Stack>
  );
}
