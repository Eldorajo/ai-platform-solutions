/**
 * Tests for the path switcher: failover, retry of the same request, switching
 * back, which errors switch, and probe behaviour under load.
 * Dependencies: node:test, node:assert, ../src
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPathSwitcher, type SwitchEvent, type SwitcherDeps } from '../src/switcher.ts';

class NetworkBlocked extends Error {}
class RateLimited extends Error {}

/** A fake network: `blocked` decides whether the direct path works. */
function setup(overrides: Partial<SwitcherDeps<string, string>> = {}) {
  const net = { blocked: false, now: 0, direct: 0, enqueued: 0, probes: 0 };
  const events: SwitchEvent[] = [];
  const switcher = createPathSwitcher<string, string>({
    async callDirect(req) {
      net.direct++;
      if (net.blocked) throw new NetworkBlocked('connect timeout');
      return `direct:${req}`;
    },
    async enqueue(req) {
      net.enqueued++;
      return `job-${req}`;
    },
    async waitForResult(jobId) {
      return `fallback:${jobId}`;
    },
    async probe() {
      net.probes++;
      return !net.blocked;
    },
    isNetworkBlock: (err) => err instanceof NetworkBlocked,
    clock: { now: () => net.now },
    reprobeMs: 60_000,
    onSwitch: (e) => events.push(e),
    ...overrides,
  });
  return { net, events, switcher };
}

test('uses the direct path when the network allows it', async () => {
  const { switcher, net } = setup();
  assert.deepEqual(await switcher.send('a'), { route: 'direct', res: 'direct:a' });
  assert.equal(net.enqueued, 0);
});

test('on a block, switches and retries the same request on the fallback', async () => {
  const { switcher, net, events } = setup();
  net.blocked = true;
  assert.deepEqual(await switcher.send('a'), { route: 'fallback', res: 'fallback:job-a' });
  assert.equal(switcher.current(), 'fallback');
  assert.deepEqual(events, [{ from: 'direct', to: 'fallback', cause: 'connect timeout', at: 0 }]);
});

test('stays on the fallback without retrying direct until the reprobe interval', async () => {
  const { switcher, net } = setup();
  net.blocked = true;
  await switcher.send('a');
  net.now = 30_000;
  await switcher.send('b');
  assert.equal(net.direct, 1);
  assert.equal(net.probes, 0);
});

test('switches back after a successful probe', async () => {
  const { switcher, net, events } = setup();
  net.blocked = true;
  await switcher.send('a');
  net.blocked = false;
  net.now = 61_000;
  assert.deepEqual(await switcher.send('b'), { route: 'direct', res: 'direct:b' });
  assert.equal(events.at(-1)!.cause, 'probe succeeded');
});

test('a failed probe keeps the fallback and waits a full interval before trying again', async () => {
  const { switcher, net } = setup();
  net.blocked = true;
  await switcher.send('a');
  net.now = 61_000;
  await switcher.send('b');
  net.now = 90_000;
  await switcher.send('c');
  assert.equal(net.probes, 1);
  assert.equal(switcher.current(), 'fallback');
});

test('a probe that throws counts as still blocked', async () => {
  const { switcher, net } = setup({ probe: async () => { throw new Error('dns'); } });
  net.blocked = true;
  await switcher.send('a');
  net.now = 61_000;
  assert.equal((await switcher.send('b')).route, 'fallback');
});

test('provider errors are rethrown, not rerouted', async () => {
  const { switcher, net } = setup({
    callDirect: async () => {
      throw new RateLimited('429');
    },
  });
  await assert.rejects(switcher.send('a'), RateLimited);
  assert.equal(switcher.current(), 'direct');
  assert.equal(net.enqueued, 0);
});

test('a burst of requests at reprobe time triggers one probe', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { switcher, net } = setup({
    probe: async () => {
      net.probes++;
      await gate;
      return true;
    },
  });
  net.blocked = true;
  await switcher.send('a');
  net.blocked = false;
  net.now = 61_000;
  const burst = Promise.all(['b', 'c', 'd'].map((r) => switcher.send(r)));
  release();
  const out = await burst;
  assert.equal(net.probes, 1);
  assert.deepEqual(out.map((o) => o.route), ['direct', 'direct', 'direct']);
});

test('a throwing switch hook does not break requests', async () => {
  const { switcher, net } = setup({
    onSwitch: () => {
      throw new Error('metrics down');
    },
  });
  net.blocked = true;
  assert.equal((await switcher.send('a')).route, 'fallback');
});

test('fallback failures surface to the caller', async () => {
  const { switcher, net } = setup({
    waitForResult: async () => {
      throw new Error('job failed');
    },
  });
  net.blocked = true;
  await assert.rejects(switcher.send('a'), /job failed/);
});
