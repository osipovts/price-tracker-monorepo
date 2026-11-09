import {
  Anchor,
  Avatar,
  Button,
  Card,
  Group,
  Loader,
  Pagination,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { ErrorAlert, MarketplaceName, useLocale } from 'frontend-shared';
import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMoment, formatPrice } from '../../shared/format.type.js';
import {
  groupViewUrl,
  type TrackedGroupType,
  useTrackedGroups,
} from './use-tracked-groups.hook.js';

const pageSize = 25;

function GroupRow({ group }: { group: TrackedGroupType }): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = group.title ?? t('groups.untitled');
  const url = groupViewUrl(group.id);

  return (
    <Table.Tr>
      <Table.Td maw={360}>
        <Group gap="sm" wrap="nowrap">
          <Avatar src={group.thumbnailUrl} name={title} color="initials" radius="sm" size={40} />
          <Anchor href={url} target="_blank" rel="noopener" lineClamp={2} title={title}>
            {title}
          </Anchor>
        </Group>
      </Table.Td>
      <Table.Td>
        {group.ownerEmail === null ? (
          <Text size="sm" c="dimmed">
            {t('groups.ownerGone')}
          </Text>
        ) : (
          <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
            {group.ownerEmail}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap={8}>
          {group.marketplaces.map((marketplace, index): ReactElement => (
            <MarketplaceName key={`${marketplace}-${String(index)}`} marketplace={marketplace} />
          ))}
        </Group>
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        {group.current === null ? (
          '-'
        ) : (
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatPrice(group.current.amountMinor, locale)}
            </Text>
            <MarketplaceName marketplace={group.current.marketplace} />
          </Group>
        )}
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        <Text size="sm">{formatMoment(group.lastCheck?.checkedAt ?? null, locale)}</Text>
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        <Text size="sm">{formatMoment(group.createdAt, locale)}</Text>
      </Table.Td>
      <Table.Td>
        <Button component="a" href={url} target="_blank" rel="noopener" size="xs" variant="light">
          {t('groups.open')}
        </Button>
      </Table.Td>
    </Table.Tr>
  );
}

/** The groups the users track; each opens in the app as its owner sees it, read-only. */
export function GroupsPage(): ReactElement {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const groups = useTrackedGroups(page, pageSize);
  const data = groups.data;

  return (
    <Stack>
      <Stack gap={2}>
        <Title order={2}>{t('groups.title')}</Title>
        <Text size="sm" c="dimmed">
          {t('groups.hint')}
        </Text>
      </Stack>
      {groups.isError && <ErrorAlert error={groups.error} />}
      {data === undefined ? (
        !groups.isError && <Loader />
      ) : (
        <Card withBorder p={0}>
          <Table.ScrollContainer minWidth={900}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('groups.group')}</Table.Th>
                  <Table.Th>{t('groups.owner')}</Table.Th>
                  <Table.Th>{t('groups.marketplaces')}</Table.Th>
                  <Table.Th>{t('groups.price')}</Table.Th>
                  <Table.Th>{t('groups.lastCheck')}</Table.Th>
                  <Table.Th>{t('groups.created')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.items.map((group): ReactElement => (
                  <GroupRow key={group.id} group={group} />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {data.items.length === 0 && (
            <Text c="dimmed" p="md">
              {t('groups.none')}
            </Text>
          )}
        </Card>
      )}
      {data !== undefined && data.total > pageSize && (
        <Pagination
          total={Math.max(1, Math.ceil(data.total / pageSize))}
          value={page}
          onChange={setPage}
        />
      )}
    </Stack>
  );
}
