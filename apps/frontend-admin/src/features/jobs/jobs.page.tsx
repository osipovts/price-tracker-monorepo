import {
  Card,
  Code,
  Drawer,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { ErrorAlert, useLocale } from 'frontend-shared';
import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { durationOf, formatDuration, formatMoment } from '../../shared/format.type.js';
import { JobProgress, JobStatusBadge, JobSubject } from './job-status.component.js';
import { jobKindLabel } from './job-status-label.type.js';
import {
  jobKinds,
  type JobKindType,
  type JobRecordType,
  jobStates,
  type JobStateType,
  useJobRecords,
} from './use-job-records.hook.js';

const pageSize = 25;

function isJobState(value: string | null): value is JobStateType {
  return jobStates.some((state): boolean => state === value);
}

function isJobKind(value: string | null): value is JobKindType {
  return jobKinds.some((kind): boolean => kind === value);
}

/** How long the job ran, or has been running; a dash while it waits. */
function Duration({ job }: { job: JobRecordType }): ReactElement {
  const { t } = useTranslation();
  const ms = durationOf(job.startedAt, job.finishedAt, Date.now());

  return <Text size="sm">{ms === null ? '-' : formatDuration(ms, t)}</Text>;
}

/** Everything the hub knows of a job. */
function JobDetails({ job }: { job: JobRecordType }): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const field = (label: string, value: ReactElement | string): ReactElement => (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {typeof value === 'string' ? <Text size="sm">{value}</Text> : value}
    </Stack>
  );

  return (
    <Stack>
      <Group justify="space-between">
        <JobStatusBadge job={job} />
        <Text size="sm" c="dimmed">
          {jobKindLabel(job.kind, t)}
        </Text>
      </Group>
      {field(t('jobs.subject'), <JobSubject job={job} />)}
      {field(t('jobs.progress'), <JobProgress job={job} />)}
      <SimpleGrid cols={2}>
        {field(t('jobs.created'), formatMoment(job.createdAt, locale))}
        {field(t('jobs.startedAt'), formatMoment(job.startedAt, locale))}
        {field(t('jobs.finishedAt'), formatMoment(job.finishedAt, locale))}
        {field(t('jobs.duration'), <Duration job={job} />)}
      </SimpleGrid>
      {job.error !== null &&
        field(
          t('jobs.error'),
          <Code block style={{ whiteSpace: 'pre-wrap' }}>
            {job.error}
          </Code>,
        )}
      {field(t('jobs.id'), <Code>{job.id}</Code>)}
    </Stack>
  );
}

function JobRow({ job, onOpen }: { job: JobRecordType; onOpen: () => void }): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <Table.Tr onClick={onOpen} style={{ cursor: 'pointer' }}>
      <Table.Td>
        <JobStatusBadge job={job} />
      </Table.Td>
      <Table.Td>
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {jobKindLabel(job.kind, t)}
        </Text>
      </Table.Td>
      <Table.Td maw={320}>
        <JobSubject job={job} />
      </Table.Td>
      <Table.Td>
        <JobProgress job={job} />
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        <Text size="sm">{formatMoment(job.createdAt, locale)}</Text>
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        <Duration job={job} />
      </Table.Td>
      <Table.Td maw={280}>
        <Text size="sm" c="red" lineClamp={2} title={job.error ?? undefined}>
          {job.error ?? ''}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

/** The jobs of the hub as they go: which run now and how far they are, which ended well, which failed and why. */
export function JobsPage(): ReactElement {
  const { t } = useTranslation();
  // The filters are in the address: the dashboard links to the failures.
  const [params, setParams] = useSearchParams();
  const state = params.get('state');
  const kind = params.get('kind');
  const [page, setPage] = useState(1);
  // The job opened stays open when it leaves the page: it ends, and the filter is of the ones on their way.
  const [opened, setOpened] = useState<JobRecordType | null>(null);
  const jobs = useJobRecords({
    page,
    pageSize,
    ...(isJobState(state) ? { state } : {}),
    ...(isJobKind(kind) ? { kind } : {}),
  });
  const data = jobs.data;
  const openedJob =
    opened === null ? null : (data?.items.find(({ id }): boolean => id === opened.id) ?? opened);
  const choose = (name: string, value: string | null): void => {
    setParams((current): URLSearchParams => {
      const next = new URLSearchParams(current);
      if (value === null || value === 'all') next.delete(name);
      else next.set(name, value);

      return next;
    });
    setPage(1);
  };

  return (
    <Stack>
      <Stack gap={2}>
        <Title order={2}>{t('jobs.title')}</Title>
        <Text size="sm" c="dimmed">
          {t('jobs.hint')}
        </Text>
      </Stack>
      <Group align="flex-end">
        <SegmentedControl
          aria-label={t('jobs.statusColumn')}
          value={isJobState(state) ? state : 'all'}
          data={[
            { value: 'all', label: t('jobs.state.all') },
            ...jobStates.map((each): { value: string; label: string } => ({
              value: each,
              label: t(`jobs.state.${each}`),
            })),
          ]}
          onChange={(value): void => {
            choose('state', value);
          }}
        />
        <Select
          aria-label={t('jobs.kindLabel')}
          w={200}
          value={isJobKind(kind) ? kind : 'all'}
          allowDeselect={false}
          data={[
            { value: 'all', label: t('jobs.kind.all') },
            ...jobKinds.map((each): { value: string; label: string } => ({
              value: each,
              label: jobKindLabel(each, t),
            })),
          ]}
          onChange={(value): void => {
            choose('kind', value);
          }}
        />
      </Group>
      {jobs.isError && <ErrorAlert error={jobs.error} />}
      {data === undefined ? (
        !jobs.isError && <Loader />
      ) : (
        <Card withBorder p={0}>
          <Table.ScrollContainer minWidth={900}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('jobs.statusColumn')}</Table.Th>
                  <Table.Th>{t('jobs.kindLabel')}</Table.Th>
                  <Table.Th>{t('jobs.subject')}</Table.Th>
                  <Table.Th>{t('jobs.progress')}</Table.Th>
                  <Table.Th>{t('jobs.created')}</Table.Th>
                  <Table.Th>{t('jobs.duration')}</Table.Th>
                  <Table.Th>{t('jobs.error')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.items.map((job): ReactElement => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onOpen={(): void => {
                      setOpened(job);
                    }}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {data.items.length === 0 && (
            <Text c="dimmed" p="md">
              {t('jobs.none')}
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
      <Drawer
        opened={openedJob !== null}
        position="right"
        title={t('jobs.details')}
        onClose={(): void => {
          setOpened(null);
        }}
      >
        {openedJob !== null && <JobDetails job={openedJob} />}
      </Drawer>
    </Stack>
  );
}
