import { Module } from '@nestjs/common';

import { PrismaClient } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfigInterface } from '../shared/application/app-config.interface.js';
import { LOGGER, type LoggerPort } from '../shared/application/logger.port.js';
import { PRISMA, PrismaModule } from '../shared/infrastructure/prisma.module.js';
import { GetJobUseCase } from './application/get-job.use-case.js';
import { GetJobActivityUseCase } from './application/get-job-activity.use-case.js';
import { GetJobStatsUseCase } from './application/get-job-stats.use-case.js';
import { JOB_QUEUE, type JobQueuePort } from './application/job-queue.port.js';
import { JOB_REPOSITORY, type JobRepositoryPort } from './application/job-repository.port.js';
import { ListJobsUseCase } from './application/list-jobs.use-case.js';
import { RecordJobEventUseCase } from './application/record-job-event.use-case.js';
import { RecordJobMessageUseCase } from './application/record-job-message.use-case.js';
import { ScheduleJobUseCase } from './application/schedule-job.use-case.js';
import { BullmqJobQueueAdapter } from './infrastructure/bullmq-job-queue.adapter.js';
import { PrismaJobRepositoryAdapter } from './infrastructure/prisma-job-repository.adapter.js';
import { JobsController } from './presentation/jobs.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [JobsController],
  providers: [
    {
      provide: JOB_REPOSITORY,
      useFactory: (prisma: PrismaClient): JobRepositoryPort =>
        new PrismaJobRepositoryAdapter(prisma),
      inject: [PRISMA],
    },
    {
      provide: JOB_QUEUE,
      useFactory: (config: AppConfigInterface, logger: LoggerPort): JobQueuePort =>
        new BullmqJobQueueAdapter(config.redisUrl, logger.child('queue')),
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: RecordJobEventUseCase,
      useFactory: (jobs: JobRepositoryPort, logger: LoggerPort): RecordJobEventUseCase =>
        new RecordJobEventUseCase(jobs, logger.child('jobs')),
      inject: [JOB_REPOSITORY, LOGGER],
    },
    {
      provide: RecordJobMessageUseCase,
      useFactory: (recordJobEvent: RecordJobEventUseCase): RecordJobMessageUseCase =>
        new RecordJobMessageUseCase(recordJobEvent),
      inject: [RecordJobEventUseCase],
    },
    {
      provide: ScheduleJobUseCase,
      useFactory: (queue: JobQueuePort, jobs: JobRepositoryPort): ScheduleJobUseCase =>
        new ScheduleJobUseCase(queue, jobs),
      inject: [JOB_QUEUE, JOB_REPOSITORY],
    },
    {
      provide: GetJobStatsUseCase,
      useFactory: (jobs: JobRepositoryPort): GetJobStatsUseCase => new GetJobStatsUseCase(jobs),
      inject: [JOB_REPOSITORY],
    },
    {
      provide: GetJobActivityUseCase,
      useFactory: (jobs: JobRepositoryPort): GetJobActivityUseCase =>
        new GetJobActivityUseCase(jobs),
      inject: [JOB_REPOSITORY],
    },
    {
      provide: GetJobUseCase,
      useFactory: (jobs: JobRepositoryPort): GetJobUseCase => new GetJobUseCase(jobs),
      inject: [JOB_REPOSITORY],
    },
    {
      provide: ListJobsUseCase,
      useFactory: (jobs: JobRepositoryPort): ListJobsUseCase => new ListJobsUseCase(jobs),
      inject: [JOB_REPOSITORY],
    },
  ],
  exports: [
    ScheduleJobUseCase,
    RecordJobMessageUseCase,
    GetJobStatsUseCase,
    GetJobActivityUseCase,
    ListJobsUseCase,
  ],
})
export class JobModule {}
