import { Anchor, Badge, Group, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { MarketplaceName, marketplaceName } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { jobStatusColor, jobStatusLabel } from './job-status-label.type.js';
import { isActive, type JobRecordType } from './use-job-records.hook.js';

/** The form of the ids of the products; the subject of a batch of reads is its marketplace instead. */
const productIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the job is, in words and in a colour; a lost one is told apart from the ones on their way. */
export function JobStatusBadge({
  job,
}: {
  job: Pick<JobRecordType, 'status' | 'lost'>;
}): ReactElement {
  const { t } = useTranslation();
  const status = job.lost ? 'lost' : job.status;
  const badge = (
    <Badge color={jobStatusColor(status)} variant="light">
      {jobStatusLabel(status, t)}
    </Badge>
  );

  return job.lost ? (
    <Tooltip multiline w={280} label={t('dashboard.lostHint')}>
      {badge}
    </Tooltip>
  ) : (
    badge
  );
}

/** What the job is about: the product a price read is of, the marketplace of a batch, a source, a handbook. */
export function JobSubject({ job }: { job: JobRecordType }): ReactElement {
  const { t } = useTranslation();
  const { product } = job;

  if (product !== null) {
    return (
      <Stack gap={0} miw={0}>
        <Anchor
          href={product.url}
          target="_blank"
          rel="noreferrer noopener"
          size="sm"
          lineClamp={1}
          title={product.title ?? product.url}
        >
          {product.title ?? product.url}
        </Anchor>
        <Group gap={6}>
          <MarketplaceName marketplace={product.marketplace} />
          {product.cityName !== null && (
            <Text size="xs" c="dimmed">
              {product.cityName}
            </Text>
          )}
        </Group>
      </Stack>
    );
  }
  if (job.kind === 'price_fetch') {
    // The product of a read may have gone since: the subject is its id still.
    const gone = productIdPattern.test(job.subject);

    return gone ? (
      <Text size="sm" c="dimmed">
        {t('jobs.goneProduct')}
      </Text>
    ) : (
      <Text size="sm">{t('jobs.batch', { marketplace: marketplaceName(job.subject) })}</Text>
    );
  }

  return <Text size="sm">{job.subject}</Text>;
}

/** How far the job is: a bar while it is on its way, else what it did. */
export function JobProgress({ job }: { job: JobRecordType }): ReactElement {
  const { t } = useTranslation();
  const done =
    job.total === null
      ? t('jobs.processedUnknown', { processed: job.processed })
      : t('jobs.processed', {
          processed: job.processed,
          total: job.total,
          succeeded: job.succeeded,
        });

  return (
    <Stack gap={4} miw={140}>
      {isActive(job) && (
        <Progress
          value={job.percent}
          size="sm"
          animated={job.status === 'running'}
          aria-label={t('jobs.progress')}
        />
      )}
      <Text size="xs" c="dimmed">
        {done}
      </Text>
    </Stack>
  );
}
