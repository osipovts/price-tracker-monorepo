import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProxyEndpointEntity } from 'proxy-endpoint';

import type { CityInterface } from '../domain/city.interface.js';
import type { CitySourcePort, CitySourceSessionInterface } from './city-source.port.js';
import { FetchCitiesUseCase } from './fetch-cities.use-case.js';

const first = new ProxyEndpointEntity('socks5://217.71.230.1:1080');
const second = new ProxyEndpointEntity('socks5://217.71.230.2:1080');
const city = (id: string, name: string): CityInterface => ({ id, name, region: null });
const never = new AbortController().signal;

interface SourceScriptInterface {
  /** What a route says of a letter: the cities, or an error for a route that stops working. */
  answer: (route: string | undefined, letter: string) => CityInterface[] | Error;
  /** The routes that do not open. */
  closed?: ReadonlyArray<string | undefined>;
}

function source(script: SourceScriptInterface): {
  source: CitySourcePort;
  reads: Array<[string | undefined, string]>;
  opened: Array<string | undefined>;
  closed: Array<string | undefined>;
} {
  const reads: Array<[string | undefined, string]> = [];
  const opened: Array<string | undefined> = [];
  const closed: Array<string | undefined> = [];

  return {
    reads,
    opened,
    closed,
    source: {
      open: (proxy): Promise<CitySourceSessionInterface> => {
        const route = proxy?.server;
        if (script.closed?.includes(route) === true) return Promise.reject(new Error('no route'));

        opened.push(route);

        return Promise.resolve({
          read: (letter): Promise<CityInterface[]> => {
            reads.push([route, letter]);
            const answer = script.answer(route, letter);

            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
          },
          close: (): Promise<void> => {
            closed.push(route);

            return Promise.resolve();
          },
        });
      },
    },
  };
}

const listener = (
  progress: Array<[number, number]> = [],
): { onProgress: (done: number, total: number) => Promise<void> } => ({
  onProgress: (done, total): Promise<void> => {
    progress.push([done, total]);

    return Promise.resolve();
  },
});

void test('gathers the cities of every letter once, by name, and reports the letters done', async (): Promise<void> => {
  const { source: cities } = source({
    answer: (_route, letter) =>
      letter === 'А'
        ? [city('2', 'Бор'), city('1', 'Абакан')]
        : [city('2', 'Бор'), city('3', 'Волгоград')],
  });
  const progress: Array<[number, number]> = [];

  const found = await new FetchCitiesUseCase(cities, ['А', 'Б']).execute(
    [first],
    never,
    listener(progress),
  );

  assert.deepEqual(found, [city('1', 'Абакан'), city('2', 'Бор'), city('3', 'Волгоград')]);
  assert.deepEqual(progress, [
    [0, 2],
    [1, 2],
    [2, 2],
  ]);
});

void test('opens the marketplace once on a route, reads every letter on it, and closes it', async (): Promise<void> => {
  const {
    source: cities,
    reads,
    opened,
    closed,
  } = source({
    answer: (_route, letter) => [city(letter, letter)],
  });

  await new FetchCitiesUseCase(cities, ['А', 'Б', 'В']).execute([first, second], never, listener());

  assert.deepEqual(opened, [first.server]);
  assert.deepEqual(reads, [
    [first.server, 'А'],
    [first.server, 'Б'],
    [first.server, 'В'],
  ]);
  assert.deepEqual(closed, [first.server]);
});

void test('goes on to the next route when one does not open, or stops working, and carries on from the letter it failed at', async (): Promise<void> => {
  const {
    source: cities,
    reads,
    closed,
  } = source({
    closed: [first.server],
    answer: (route, letter) =>
      route === second.server && letter === 'В' ? new Error('timeout') : [city(letter, letter)],
  });

  const found = await new FetchCitiesUseCase(cities, ['А', 'Б', 'В', 'Г']).execute(
    [first, second, null],
    never,
    listener(),
  );

  assert.equal(found.length, 4);
  assert.deepEqual(reads, [
    [second.server, 'А'],
    [second.server, 'Б'],
    [second.server, 'В'],
    [undefined, 'В'],
    [undefined, 'Г'],
  ]);
  assert.deepEqual(closed, [second.server, undefined]);
});

void test('fails, and gives none of the cities, when no route can read a letter', async (): Promise<void> => {
  const { source: cities, closed } = source({
    answer: (_route, letter) => (letter === 'Б' ? new Error('timeout') : [city('1', 'Абакан')]),
  });

  await assert.rejects(
    new FetchCitiesUseCase(cities, ['А', 'Б']).execute([first, second], never, listener()),
    /Б/,
  );
  assert.deepEqual(closed, [first.server, second.server]);
  await assert.rejects(
    new FetchCitiesUseCase(cities, ['А']).execute([], never, listener()),
    /route/,
  );
});

void test('stops when the job is aborted, instead of trying the other routes', async (): Promise<void> => {
  const controller = new AbortController();
  const { source: cities, reads } = source({
    answer: () => {
      controller.abort();

      return new Error('aborted');
    },
  });

  await assert.rejects(
    new FetchCitiesUseCase(cities, ['А']).execute([first, second], controller.signal, listener()),
  );
  assert.equal(reads.length, 1);
});
