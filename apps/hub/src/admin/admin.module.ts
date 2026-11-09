import { Module } from '@nestjs/common';

import { AccountModule } from '../account/account.module.js';
import { GetAccountUseCase, GetUserStatsUseCase } from '../account/application/index.js';
import { GetJobStatsUseCase, ListJobsUseCase } from '../job/application/index.js';
import { JobModule } from '../job/job.module.js';
import {
  DescribeProductsUseCase,
  GetProductStatsUseCase,
  ListAllProductGroupsUseCase,
} from '../product/application/index.js';
import { ProductModule } from '../product/product.module.js';
import { GetProxyStatsUseCase } from '../proxy/application/index.js';
import { ProxyModule } from '../proxy/proxy.module.js';
import { GetDashboardUseCase } from './application/get-dashboard.use-case.js';
import { ListJobRecordsUseCase } from './application/list-job-records.use-case.js';
import { ListTrackedGroupsUseCase } from './application/list-tracked-groups.use-case.js';
import { AdminController } from './presentation/admin.controller.js';

@Module({
  imports: [AccountModule, ProductModule, ProxyModule, JobModule],
  controllers: [AdminController],
  providers: [
    {
      provide: GetDashboardUseCase,
      useFactory: (
        users: GetUserStatsUseCase,
        products: GetProductStatsUseCase,
        proxies: GetProxyStatsUseCase,
        jobs: GetJobStatsUseCase,
      ): GetDashboardUseCase => new GetDashboardUseCase(users, products, proxies, jobs),
      inject: [
        GetUserStatsUseCase,
        GetProductStatsUseCase,
        GetProxyStatsUseCase,
        GetJobStatsUseCase,
      ],
    },
    {
      provide: ListTrackedGroupsUseCase,
      useFactory: (
        groups: ListAllProductGroupsUseCase,
        accounts: GetAccountUseCase,
      ): ListTrackedGroupsUseCase => new ListTrackedGroupsUseCase(groups, accounts),
      inject: [ListAllProductGroupsUseCase, GetAccountUseCase],
    },
    {
      provide: ListJobRecordsUseCase,
      useFactory: (
        jobs: ListJobsUseCase,
        products: DescribeProductsUseCase,
      ): ListJobRecordsUseCase => new ListJobRecordsUseCase(jobs, products),
      inject: [ListJobsUseCase, DescribeProductsUseCase],
    },
  ],
})
export class AdminModule {}
