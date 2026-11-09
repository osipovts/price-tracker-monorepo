import assert from 'node:assert/strict';
import { test } from 'node:test';

import { systemClock } from '../../shared/application/clock.port.js';
import { ProxyEntity } from '../domain/proxy.entity.js';
import { InMemoryProxyRepositoryAdapter } from '../infrastructure/in-memory-proxy-repository.adapter.js';
import { InMemoryProxyReputationRepositoryAdapter } from '../infrastructure/in-memory-proxy-reputation-repository.adapter.js';
import { AddManualProxyUseCase } from './add-manual-proxy.use-case.js';
import { ListBestProxyServersUseCase } from './list-best-proxy-servers.use-case.js';
import { ProxyNotFoundError } from './proxy-not-found.error.js';
import type { ProxyRepositoryPort } from './proxy-repository.port.js';
import { SetProxyDisabledUseCase } from './set-proxy-disabled.use-case.js';

const first = 'socks5://217.71.230.1:1080';
const second = 'socks5://217.71.230.2:1080';

/** The proxies by their estimates: every draw of the Thompson sampling lands on the mean. */
function bestOf(proxies: ProxyRepositoryPort): ListBestProxyServersUseCase {
  return new ListBestProxyServersUseCase(
    proxies,
    new InMemoryProxyReputationRepositoryAdapter(),
    systemClock,
    (): number => 0.25,
  );
}

function proxy(server: string, checksAlive: number): ProxyEntity {
  return new ProxyEntity({
    server,
    source: 'github-free-proxy-list',
    country: 'RU',
    exitIp: null,
    alive: true,
    latencyMs: 100,
    checksTotal: 4,
    checksAlive,
    lastCheckedAt: new Date('2026-10-31T10:00:00Z'),
    lastSeenAt: new Date('2026-10-31T10:00:00Z'),
    disabledAt: null,
    credentials: null,
  });
}

async function setup(): Promise<{
  proxies: InMemoryProxyRepositoryAdapter;
  setDisabled: SetProxyDisabledUseCase;
  best: ListBestProxyServersUseCase;
}> {
  const proxies = new InMemoryProxyRepositoryAdapter();
  await proxies.saveMany([proxy(first, 4), proxy(second, 2)]);

  return {
    proxies,
    setDisabled: new SetProxyDisabledUseCase(proxies),
    best: bestOf(proxies),
  };
}

void test('a proxy that is turned off is not given to the workers, and is again once it is turned on', async (): Promise<void> => {
  const { setDisabled, best } = await setup();
  assert.deepEqual(await best.execute({ marketplace: 'ozon', limit: 5 }), [first, second]);

  await setDisabled.execute(first, true);
  assert.deepEqual(await best.execute({ marketplace: 'ozon', limit: 5 }), [second]);

  await setDisabled.execute(first, false);
  assert.deepEqual(await best.execute({ marketplace: 'ozon', limit: 5 }), [first, second]);
});

void test('turning off a proxy that is turned off already changes nothing', async (): Promise<void> => {
  const { proxies, setDisabled } = await setup();

  await setDisabled.execute(first, true);
  const once = (await proxies.findByServers([first]))[0]?.snapshot.disabledAt;
  await setDisabled.execute(first, true);

  assert.deepEqual((await proxies.findByServers([first]))[0]?.snapshot.disabledAt, once);
});

void test('refuses to turn off a proxy that is unknown', async (): Promise<void> => {
  const { setDisabled } = await setup();

  await assert.rejects(setDisabled.execute('socks5://203.0.113.9:1080', true), ProxyNotFoundError);
});

void test('manual proxies go to the workers before the found ones, whatever their check and country', async (): Promise<void> => {
  const { proxies, best } = await setup();
  const manual = 'socks5://217.71.230.9:1080';

  await new AddManualProxyUseCase(proxies).execute(manual);

  assert.deepEqual(await best.execute({ marketplace: 'ozon', limit: 5 }), [manual, first, second]);
  assert.deepEqual(await best.execute({ marketplace: 'ozon', limit: 2 }), [manual, first]);
});

void test('a found proxy becomes manual and stays so after a check', async (): Promise<void> => {
  const { proxies, best } = await setup();

  await new AddManualProxyUseCase(proxies).execute(second);
  const [known] = await proxies.findByServers([second]);
  assert.ok(known);
  await proxies.saveMany([
    ProxyEntity.fromCheck(
      {
        server: second,
        source: 'proxifly',
        seen: true,
        alive: false,
        country: null,
        exitIp: null,
        latencyMs: null,
        checkedAt: new Date('2026-10-31T11:00:00Z'),
      },
      known,
    ),
  ]);

  assert.equal((await proxies.findByServers([second]))[0]?.isManual, true);
  assert.deepEqual(await best.execute({ marketplace: 'ozon', limit: 5 }), [second, first]);
});
