import './waiting-glint.css';

import {
  Button,
  Card,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ErrorAlert } from 'frontend-shared';
import { type ReactElement, type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { AddProduct } from './add-product.component.js';
import { DeleteGroup } from './delete-group.component.js';
import { GroupPrices } from './group-prices.component.js';
import { ProductThumbnail } from './product-thumbnail.component.js';
import {
  groupPageSize,
  type ProductGroupType,
  statsPeriods,
  type StatsPeriodType,
  useChooseStatsPeriod,
  useCreateGroup,
  useProductGroups,
} from './use-product-groups.hook.js';

/** Makes an empty group, to fill with products later. */
function CreateGroup(): ReactElement {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const create = useCreateGroup();

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    create.mutate(title.trim() === '' ? null : title.trim(), {
      onSuccess: (): void => {
        setTitle('');
      },
    });
  };

  return (
    <form onSubmit={submit}>
      <Group align="flex-end">
        <TextInput
          flex="1 1 12rem"
          label={t('groups.newLabel')}
          placeholder={t('groups.newPlaceholder')}
          maxLength={200}
          value={title}
          onChange={(event): void => {
            setTitle(event.currentTarget.value);
          }}
        />
        <Button type="submit" variant="default" loading={create.isPending}>
          {t('groups.create')}
        </Button>
      </Group>
      {create.error !== null && <ErrorAlert error={create.error} />}
    </form>
  );
}

/** The period of the lowest and the highest price, kept for the user. */
function PeriodSwitch({ value }: { value: StatsPeriodType }): ReactElement {
  const { t } = useTranslation();
  const choose = useChooseStatsPeriod();

  return (
    <SegmentedControl
      aria-label={t('groups.period')}
      size="xs"
      value={value}
      data={statsPeriods.map((period): { value: string; label: string } => ({
        value: period,
        label: t(`groups.periods.${period}`),
      }))}
      onChange={(period): void => {
        const chosen = statsPeriods.find((candidate): boolean => candidate === period);
        if (chosen !== undefined) choose.mutate(chosen);
      }}
    />
  );
}

function GroupCards({
  items,
  onDeleted,
}: {
  items: ProductGroupType[];
  onDeleted: () => void;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
      {items.map((group): ReactElement => {
        const title = group.title ?? t('groups.untitled');
        // Still waiting for the first price: a glint runs over the card until it comes.
        const waiting = group.productCount > 0 && group.title === null;

        return (
          <Card key={group.id} withBorder padding="sm" data-waiting={waiting ? 'true' : undefined}>
            <Group wrap="nowrap" align="flex-start" gap="sm">
              <ProductThumbnail url={group.thumbnailUrl} alt={title} size={88} />
              <Stack gap={6} flex={1} miw={0}>
                <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                  {/* A title can be a paragraph: two lines of the card, the whole of it in the hint. */}
                  <Text
                    component={Link}
                    to={`/groups/${group.id}`}
                    fw={500}
                    lineClamp={2}
                    title={title}
                  >
                    {title}
                  </Text>
                  <DeleteGroup groupId={group.id} title={title} onDeleted={onDeleted} />
                </Group>
                <Text size="xs" c="dimmed">
                  {t('groups.productCount', { count: group.productCount })}
                </Text>
                {waiting ? (
                  <>
                    <Text size="sm" c="dimmed">
                      {t('products.waiting')}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t('products.waitingHint')}
                    </Text>
                  </>
                ) : (
                  <GroupPrices group={group} />
                )}
              </Stack>
            </Group>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}

export function ProductsPage(): ReactElement {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const groups = useProductGroups(page);
  const data = groups.data;
  // The last group of a page is gone: the page goes with it.
  const onDeleted = (): void => {
    if (data?.items.length === 1 && page > 1) setPage(page - 1);
  };

  return (
    <Stack>
      <Card withBorder>
        <Stack gap="md">
          <AddProduct groupId={null} />
          <CreateGroup />
        </Stack>
      </Card>
      <Group justify="space-between" mt="md">
        <Title order={2}>{t('products.title')}</Title>
        {data !== undefined && <PeriodSwitch value={data.statsPeriod} />}
      </Group>
      {groups.isError && <ErrorAlert error={groups.error} />}
      {data === undefined ? (
        !groups.isError && <Loader />
      ) : (
        <>
          <GroupCards items={data.items} onDeleted={onDeleted} />
          {data.items.length === 0 && <Text c="dimmed">{t('products.empty')}</Text>}
          {data.total > groupPageSize && (
            <Pagination
              total={Math.max(1, Math.ceil(data.total / groupPageSize))}
              value={page}
              onChange={setPage}
            />
          )}
        </>
      )}
    </Stack>
  );
}
