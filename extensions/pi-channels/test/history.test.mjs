import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageHistory } from '../history.ts';

test('query error ack rejects promptly with actual message, not timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const history = new MessageHistory({ emit(_name, data) { data.ack?.({ ok: false, error: 'Database "default" is not registered' }); } });
  let failure;
  const pending = history.query().catch(error => { failure = error; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.match(failure?.message ?? '', /Database "default" is not registered/);
  await pending;
  t.mock.timers.tick(10_001);
});

test('query timeout remains available when no provider responds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const history = new MessageHistory({ emit() {} });
  const check = assert.rejects(history.query(), /History query timed out/);
  t.mock.timers.tick(10_001);
  await check;
});

test('dispose rejects pending requests and prevents new requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  const history = new MessageHistory({ emit() { requests++; } });
  const check = assert.rejects(history.query(), /disposed/i);
  history.dispose();
  await check;
  await assert.rejects(history.query(), /disposed/i);
  assert.equal(requests, 1);
  t.mock.timers.tick(10_001);
});

test('migration and schema error replies reject initialization with their message', async () => {
  for (const failedEvent of ['kysely:migration:apply', 'kysely:schema:register']) {
    const history = new MessageHistory({ emit(name, data) {
      if (name === failedEvent) data.reply({ ok: false, errors: ['schema permission denied'] });
      else if (name === 'kysely:query') data.reply({ rows: [] });
      else data.reply({ ok: true });
    } });
    await assert.rejects(history.init(), /schema permission denied/);
    history.dispose();
  }
});

test('first response wins when reply and ack both arrive', async () => {
  const history = new MessageHistory({ emit(_name, data) {
    data.reply({ rows: [{ id: 42 }] });
    data.ack?.({ ok: false, error: 'late error' });
  } });
  assert.deepEqual(await history.query(), [{ id: 42 }]);
});
