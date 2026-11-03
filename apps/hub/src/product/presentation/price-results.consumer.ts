import { Inject, Injectable } from '@nestjs/common';
import { priceFetchResultSchema, type PriceFetchResultType, queueNames } from 'queue-contract';
import { QueueMessageParser } from 'queue-worker';

import { RecordJobMessageUseCase } from '../../job/application/index.js';
import {
  APP_CONFIG,
  type AppConfigInterface,
} from '../../shared/application/app-config.interface.js';
import { LOGGER, type LoggerPort } from '../../shared/application/logger.port.js';
import { ResultsConsumer } from '../../shared/presentation/results.consumer.js';
import {
  type PriceAttemptInterface,
  type PriceResultInterface,
  RecordPriceResultUseCase,
} from '../application/record-price-result.use-case.js';

type ProductResultType = Extract<PriceFetchResultType, { type: 'product_result' }>;

@Injectable()
export class PriceResultsConsumer extends ResultsConsumer<PriceFetchResultType> {
  constructor(
    @Inject(RecordPriceResultUseCase) private readonly recordResult: RecordPriceResultUseCase,
    @Inject(RecordJobMessageUseCase) private readonly recordJobMessage: RecordJobMessageUseCase,
    @Inject(QueueMessageParser) messages: QueueMessageParser,
    @Inject(APP_CONFIG) config: AppConfigInterface,
    @Inject(LOGGER) logger: LoggerPort,
  ) {
    super(
      {
        name: queueNames.priceFetchResults,
        schema: priceFetchResultSchema,
        description: 'price fetch result',
      },
      messages,
      config,
      logger,
    );
  }

  protected override async record(message: PriceFetchResultType, at: Date): Promise<void> {
    switch (message.type) {
      case 'job_started':
      case 'job_progress':
      case 'job_done':
      case 'job_failed':
        return this.recordJobMessage.execute(message, at);
      case 'product_result':
        return this.recordResult.execute(this.toResult(message));
    }
  }

  private toResult(message: ProductResultType): PriceResultInterface {
    const attempts = message.attempts.map(({ proxy, result }): PriceAttemptInterface => ({
      proxy,
      status: result.status,
      httpStatus: 'httpStatus' in result ? (result.httpStatus ?? null) : null,
    }));

    for (const attempt of message.attempts) {
      if (!('snapshot' in attempt.result)) continue;

      const { snapshot, exitIp } = attempt.result;

      return {
        jobId: message.jobId,
        trackedProductId: message.trackedProductId,
        status: message.status,
        observation: {
          title: snapshot.title,
          observedAt: new Date(snapshot.observedAt),
          availability: snapshot.availability,
          prices: snapshot.prices,
          exitIp,
        },
        imageUrl: snapshot.imageUrl ?? null,
        attempts,
      };
    }

    return {
      jobId: message.jobId,
      trackedProductId: message.trackedProductId,
      status: message.status,
      observation: null,
      attempts,
    };
  }
}
