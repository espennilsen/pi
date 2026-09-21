// Run with sibling pi-kysely dependencies installed: npm run test:integration
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { wireKyselyEvents } from '../../pi-kysely/events.ts';
import { clearDatabases, configureDefaults, createSqliteDatabase, getDefaultDatabaseName, getRawSqlite, listDatabases } from '../../pi-kysely/registry.ts';
import { MessageHistory } from '../history.ts';
import { startHistory } from '../history-lifecycle.ts';

for (const order of ['channels-first', 'kysely-first', 'legacy-database']) {
  test(`real in-memory Kysely: ${order}, migrations, logging, queries, errors`, async t => {
    const handlers = new Map();
    const events = {
      on(name, fn) {
        const set = handlers.get(name) ?? new Set();
        handlers.set(name, set); set.add(fn);
        return () => set.delete(fn);
      },
      emit(name, data) { for (const fn of [...(handlers.get(name) ?? [])]) fn(data); },
    };
    wireKyselyEvents({ events });
    configureDefaults({ databaseName: 'history-test' });
    const info = () => ({ databases: listDatabases(), defaultDatabase: getDefaultDatabaseName() });
    events.on('kysely:info', ({ reply }) => reply(info()));
    let current = null;
    let resolveReady;
    const initialized = new Promise(resolve => { resolveReady = resolve; });
    const warnings = [];
    let stop;
    t.after(async () => { stop?.(); await clearDatabases({ destroy: true }); });
    if (order !== 'channels-first') await createSqliteDatabase('history-test', ':memory:');
    if (order === 'legacy-database') {
      getRawSqlite().exec(`
        CREATE TABLE pi_channels__messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT, adapter TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
          sender TEXT, recipient TEXT, text TEXT, metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE pi_channels_migrations (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL);
        INSERT INTO pi_channels_migrations VALUES (1, 1);
        INSERT INTO pi_channels__messages (adapter, direction, text) VALUES ('legacy', 'in', 'preserve me');
      `);
    }
    stop = startHistory(events, 30, history => { current = history; if (history) resolveReady(); }, () => {}, warning => warnings.push(warning));
    if (order === 'channels-first') {
      assert.equal(current, null);
      await createSqliteDatabase('history-test', ':memory:');
      events.emit('kysely:ready', info());
    }
    // Bounded failure rather than a silently hanging integration run.
    const timeout = setTimeout(() => resolveReady(), 1000);
    await initialized;
    clearTimeout(timeout);
    assert.ok(current, warnings.join('\n'));
    current.logIncoming({ sender: 'alice', text: 'hello', metadata: {} }, 'test');
    current.logOutgoing({ recipient: 'bob', text: 'world' }, 'test');
    await flush();
    assert.equal(await current.count(), order === 'legacy-database' ? 3 : 2);
    if (order === 'legacy-database') {
      assert.equal((await current.query({ adapter: 'legacy' }))[0].text, 'preserve me');
      assert.equal(getRawSqlite().prepare('SELECT version FROM pi_channels_migrations').get().version, 1);
    }
    // Another session can initialize against already migrated tables and keep the data.
    const nextHistory = new MessageHistory(events);
    await nextHistory.init();
    assert.equal(await nextHistory.count(), await current.count());
    nextHistory.dispose();
    assert.equal((await current.query({ direction: 'in' }))[0].text, 'hello');
    assert.equal((await current.query({ direction: 'out' }))[0].recipient, 'bob');
    assert.deepEqual(warnings, []);
    await clearDatabases({ destroy: true });
    const history = new MessageHistory(events);
    const started = Date.now();
    await assert.rejects(history.query(), /Database "history-test" is not registered/);
    assert.ok(Date.now() - started < 1000, 'error must not become the 10s query timeout');
    history.dispose();
  });
}
