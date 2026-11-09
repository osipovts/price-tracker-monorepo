import type { TFunction } from 'i18next';

/** The status of a job as the hub names it, or `lost`; one it does not know is shown as it is. */
export function jobStatusLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'queued':
      return t('jobs.status.queued');
    case 'running':
      return t('jobs.status.running');
    case 'retrying':
      return t('jobs.status.retrying');
    case 'completed':
      return t('jobs.status.completed');
    case 'failed':
      return t('jobs.status.failed');
    case 'lost':
      return t('jobs.status.lost');
    default:
      return status;
  }
}

/** The colour of the status: grey while it waits, the accent while it runs, then how it ended. */
export function jobStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'accent';
    case 'retrying':
      return 'yellow';
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'lost':
      return 'orange';
    default:
      return 'gray';
  }
}

/** The kind of a job as the panel names it; one the panel does not know is shown as it is. */
export function jobKindLabel(kind: string, t: TFunction): string {
  switch (kind) {
    case 'price_fetch':
      return t('jobs.kind.priceFetch');
    case 'proxy_fetch':
      return t('jobs.kind.proxyFetch');
    case 'handbook_fetch':
      return t('jobs.kind.handbookFetch');
    default:
      return kind;
  }
}
