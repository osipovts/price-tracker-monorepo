import { type LoggerPort, silentLogger } from 'logger';
import type { HandbookCityType, HandbookType } from 'queue-contract';

import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import type { HandbookRepositoryPort } from './handbook-repository.port.js';
import { keepCityIds } from './kept-city-ids.type.js';

/**
 * Keeps the cities a fetcher read: they replace the ones the handbook had, with the ids the handbook gave
 * them (see `keepCityIds`). A read that brings none does not: the handbook keeps what it has, with its age, so
 * that the next check asks for a read again.
 */
export class SaveHandbookCitiesUseCase {
  constructor(
    private readonly handbooks: HandbookRepositoryPort,
    private readonly clock: ClockPort = systemClock,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  async execute(handbook: HandbookType, cities: HandbookCityType[]): Promise<void> {
    const previous = (await this.handbooks.findCities(handbook))?.cities ?? [];
    if (cities.length === 0 && previous.length > 0) {
      this.logger.warn(
        `The read of the handbook ${handbook} brought no cities: the ones it has stay`,
      );

      return;
    }

    await this.handbooks.saveCities(handbook, keepCityIds(previous, cities), this.clock.now());
  }
}
