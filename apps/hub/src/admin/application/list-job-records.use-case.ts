import type {
  JobEntity,
  JobKindType,
  JobStatusType,
  ListJobsUseCase,
} from '../../job/application/index.js';
import type {
  DescribeProductsUseCase,
  ProductDescriptionInterface,
} from '../../product/application/index.js';
import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';

/** Where a job is: on its way (queued, running or waiting for a retry), done, or failed for good. */
export const jobStates = ['active', 'completed', 'failed'] as const;

export type JobStateType = (typeof jobStates)[number];

const statusesOf: Record<JobStateType, readonly JobStatusType[]> = {
  active: ['queued', 'running', 'retrying'],
  completed: ['completed'],
  failed: ['failed'],
};

export interface JobRecordFilterInterface {
  kind?: JobKindType;
  state?: JobStateType;
}

export interface JobRecordInterface {
  job: JobEntity;
  /** Not done long after it was queued: the worker that had it is likely gone. */
  lost: boolean;
  /** The product a price job reads; null for the other jobs, for a batch, and for a product gone since. */
  product: ProductDescriptionInterface | null;
}

/** The jobs, the newest first, each with what it is about: the product a price job reads is named. */
export class ListJobRecordsUseCase {
  constructor(
    private readonly jobs: Pick<ListJobsUseCase, 'execute'>,
    private readonly products: Pick<DescribeProductsUseCase, 'execute'>,
    private readonly clock: ClockPort = systemClock,
  ) {}

  async execute(
    filter: JobRecordFilterInterface,
    pagination: PaginationInterface,
  ): Promise<PageInterface<JobRecordInterface>> {
    const page = await this.jobs.execute(
      {
        ...(filter.kind === undefined ? {} : { kind: filter.kind }),
        ...(filter.state === undefined ? {} : { statuses: statusesOf[filter.state] }),
      },
      pagination,
    );
    const products = await this.products.execute(
      page.items
        .filter(({ snapshot }): boolean => snapshot.kind === 'price_fetch')
        .map(({ snapshot }): string => snapshot.subject),
    );
    const now = this.clock.now();

    return {
      items: page.items.map((job): JobRecordInterface => ({
        job,
        lost: job.isLost(now),
        product:
          job.snapshot.kind === 'price_fetch'
            ? (products.find(({ id }): boolean => id === job.snapshot.subject) ?? null)
            : null,
      })),
      total: page.total,
    };
  }
}
