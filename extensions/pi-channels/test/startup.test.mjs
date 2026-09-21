import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';

// Never read the owner's settings or start configured network adapters.
mock.module('../config.ts', { exports: { loadConfig: () => ({ adapters: {}, routes: {}, bridge: {} }), getChannelSetting: () => undefined } });
const { default: channels } = await import('../index.ts');

const ready = { databases: [{ name: 'custom', driver: 'sqlite' }], defaultDatabase: 'custom', defaultDriver: 'sqlite' };
const empty = { ...ready, databases: [] };

function harness(t, info = empty) {
  const listeners = new Map();
  const hooks = new Map();
  const tools = new Map();
  const notifications = [];
  const queries = [];
  let response = info;
  let fail;
  let hold = false;
  let infoReply;
  const events = {
    on(name, fn) {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set); set.add(fn);
      return () => set.delete(fn);
    },
    emit(name, payload) { for (const fn of [...(listeners.get(name) ?? [])]) fn(payload); },
  };
  events.on('kysely:info', ({ reply }) => { infoReply = reply; if (response) reply(response); });
  events.on('kysely:migration:apply', data => data.reply({ ok: true }));
  events.on('kysely:schema:register', data => data.reply({ ok: true }));
  events.on('kysely:query', data => {
    queries.push(data);
    if (hold) return;
    if (fail) data.ack?.({ ok: false, error: fail });
    else data.reply({ rows: [] });
  });
  channels({ events, on: (name, fn) => hooks.set(name, fn), registerTool: tool => tools.set(tool.name, tool),
    registerCommand() {}, registerFlag() {}, registerShortcut() {}, getCommands: () => [], getFlag: () => false });
  const ctx = { cwd: '/unused', modelRegistry: {}, ui: { notify: text => notifications.push(text) } };
  t.after(() => hooks.get('session_shutdown')());
  return { events, tools, notifications, queries, listeners,
    start: () => hooks.get('session_start')({}, ctx), stop: () => hooks.get('session_shutdown')(),
    setInfo: value => { response = value; }, setFailure: value => { fail = value; },
    hold: () => { hold = true; }, replyInfo: value => infoReply(value),
    history: () => tools.get('channel_history')?.execute('test', { action: 'query' }),
  };
}

async function startWithoutWaiting(h) {
  let finished = false;
  const pending = h.start().then(() => { finished = true; });
  await flush();
  assert.equal(finished, true, 'channels must return before Kysely startup');
  await pending;
}

test('channels first: empty info does not issue SQL or block subsequent startup; late history tool works', async t => {
  const h = harness(t);
  await startWithoutWaiting(h);
  assert.equal(h.queries.length, 0);
  h.events.emit('kysely:ready', ready);
  await flush();
  assert.match((await h.history()).content[0].text, /No messages found/);
  assert.equal(h.notifications.length, 0);
});

test('Kysely first: info initializes history without a new ready event', async t => {
  const h = harness(t, ready);
  await startWithoutWaiting(h);
  assert.match((await h.history()).content[0].text, /No messages found/);
});

test('empty or non-default ready registry is not usable', async t => {
  const h = harness(t);
  await startWithoutWaiting(h);
  h.events.emit('kysely:ready', empty);
  h.events.emit('kysely:ready', { ...ready, databases: [{ name: 'other', driver: 'sqlite' }] });
  await flush();
  assert.equal(h.queries.length, 0);
});

test('missing Kysely warns without blocking and can recover after watchdog', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, null);
  await startWithoutWaiting(h);
  t.mock.timers.tick(10_001);
  assert.match(h.notifications.join('\n'), /history unavailable.*default database/i);
  h.events.emit('kysely:ready', ready);
  await flush();
  assert.match((await h.history()).content[0].text, /No messages found/);
});

test('repeated ready events do not duplicate schema initialization', async t => {
  const h = harness(t, ready);
  await startWithoutWaiting(h);
  h.events.emit('kysely:ready', ready);
  h.events.emit('kysely:ready', ready);
  await flush();
  assert.equal(h.queries.filter(q => q.input.sql === 'PRAGMA journal_mode = WAL').length, 1);
});

test('initialization errors preserve ack message and retry on later readiness', async t => {
  const h = harness(t);
  await startWithoutWaiting(h);
  h.setFailure('database is read-only');
  h.events.emit('kysely:ready', ready);
  await flush();
  assert.match(h.notifications.join('\n'), /database is read-only/);
  h.setFailure(undefined);
  h.events.emit('kysely:ready', ready);
  await flush();
  assert.match((await h.history()).content[0].text, /No messages found/);
});

test('shutdown removes listeners and ignores delayed info callbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, null);
  await startWithoutWaiting(h);
  await h.stop();
  assert.equal(h.listeners.get('kysely:ready')?.size ?? 0, 0);
  h.replyInfo(ready);
  h.events.emit('kysely:ready', ready);
  await flush();
  assert.equal(h.queries.length, 0);
  t.mock.timers.tick(10_001);
  assert.equal(h.notifications.length, 0);
});

test('shutdown cancels in-flight initialization and stale replies cannot publish or issue more SQL', async t => {
  const h = harness(t, ready);
  h.hold();
  await startWithoutWaiting(h);
  const query = h.queries[0];
  h.events.emit('kysely:ready', ready);
  h.events.emit('kysely:ready', ready);
  assert.equal(h.queries.length, 1, 'only one initialization may be in flight');
  await h.stop();
  query.reply({ rows: [] });
  await flush();
  assert.equal(h.queries.length, 1);
  assert.equal(h.notifications.length, 0);
});

test('late readiness attaches incoming and outgoing logging; shutdown clears both', async t => {
  const h = harness(t);
  await startWithoutWaiting(h);
  let incoming;
  h.events.emit('channel:register', { name: 'custom:test', adapter: {
    direction: 'bidirectional', start: fn => { incoming = fn; }, send: async () => ({ ok: true }),
  } });
  const send = () => new Promise(resolve => h.events.emit('channel:send', {
    adapter: 'custom:test', recipient: 'bob', text: 'outgoing', callback: resolve,
  }));
  incoming({ sender: 'alice', text: 'before readiness' });
  await send();
  assert.equal(h.queries.length, 0);
  h.events.emit('kysely:ready', ready);
  await flush();
  incoming({ sender: 'alice', text: 'incoming' });
  await send();
  const inserts = h.queries.filter(q => q.input.sql.startsWith('INSERT'));
  assert.deepEqual(inserts.map(q => q.input.params[1]), ['in', 'out']);
  await h.stop();
  const count = h.queries.length;
  incoming({ sender: 'alice', text: 'stale callback' });
  await send();
  assert.equal(h.queries.length, count);
});

test('history tool uses current session state instead of a captured old history instance', async t => {
  const h = harness(t, ready);
  await startWithoutWaiting(h);
  const tool = h.tools.get('channel_history');
  await h.stop();
  const count = h.queries.length;
  assert.match((await tool.execute('test', { action: 'query' })).content[0].text, /not ready/i);
  assert.equal(h.queries.length, count);
  h.setInfo(empty);
  await startWithoutWaiting(h);
  assert.match((await h.history()).content[0].text, /not ready/i);
  h.events.emit('kysely:ready', ready);
  await flush();
  assert.match((await h.history()).content[0].text, /No messages found/);
});
