// Tests for server/matchmaking.mjs — pure, socket-free matchmaking core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatchmaker, DEFAULT_GAME, validMode } from './matchmaking.mjs';

// Build a matchmaker with deterministic, injected id/seed counters so room ids
// and seeds are predictable across runs.
function makeDeterministic() {
  let roomN = 0;
  let seedN = 100;
  return createMatchmaker({
    nextRoomId: () => `room_${++roomN}`,
    nextSeed: () => seedN++,
  });
}

test('DEFAULT_GAME is bball', () => {
  assert.equal(DEFAULT_GAME, 'bball');
});

test('same game + same mode pairs with host(first)/guest(second), shared seed', () => {
  const mm = makeDeterministic();

  // First player to queue is waiting (no room yet).
  const first = mm.enqueue('alice', 'quick', 'bball');
  assert.equal(first, null, 'first player should wait, not pair');
  assert.equal(mm.queueLength('quick', 'bball'), 1);
  assert.equal(mm.roomCount(), 0);

  // Second player pairs and forms a room.
  const room = mm.enqueue('bob', 'quick', 'bball');
  assert.ok(room, 'second player should produce a room');
  assert.equal(room.roomId, 'room_1');
  assert.equal(room.game, 'bball');
  assert.equal(room.mode, 'quick');
  assert.equal(room.seed, 100, 'seed comes from injected counter');

  // Roles: first queued is host, second is guest.
  assert.deepEqual(room.players, [
    { id: 'alice', role: 'host' },
    { id: 'bob', role: 'guest' },
  ]);

  // Queue is drained, exactly one room exists.
  assert.equal(mm.queueLength('quick', 'bball'), 0);
  assert.equal(mm.roomCount(), 1);

  // Both players share the SAME room (and therefore the same seed).
  const roomA = mm.roomOf('alice');
  const roomB = mm.roomOf('bob');
  assert.ok(roomA && roomB);
  assert.equal(roomA, roomB, 'both players resolve to the same room object');
  assert.equal(roomA.seed, room.seed);
  assert.equal(mm.getRoom('room_1'), room);
});

test('GAME SEPARATION: soccer/quick and bball/quick do NOT pair', () => {
  const mm = makeDeterministic();

  const a = mm.enqueue('A', 'quick', 'soccer');
  const b = mm.enqueue('B', 'quick', 'bball');

  assert.equal(a, null, 'soccer player waits');
  assert.equal(b, null, 'bball player waits — different game, no cross-match');
  assert.equal(mm.roomCount(), 0, 'no room formed across games');
  assert.equal(mm.queueLength('quick', 'soccer'), 1);
  assert.equal(mm.queueLength('quick', 'bball'), 1);
  assert.equal(mm.roomOf('A'), undefined);
  assert.equal(mm.roomOf('B'), undefined);
});

test('GAME SEPARATION: two soccer players DO pair', () => {
  const mm = makeDeterministic();

  assert.equal(mm.enqueue('s1', 'quick', 'soccer'), null);
  const room = mm.enqueue('s2', 'quick', 'soccer');
  assert.ok(room);
  assert.equal(room.game, 'soccer');
  assert.equal(room.mode, 'quick');
  assert.deepEqual(room.players.map((p) => p.id), ['s1', 's2']);
  assert.deepEqual(room.players.map((p) => p.role), ['host', 'guest']);
  assert.equal(mm.roomCount(), 1);
});

test('GAME SEPARATION: legacy enqueue() with no game arg defaults to bball and pairs with explicit bball', () => {
  const mm = makeDeterministic();

  // Legacy basketball client sends no game field at all.
  const legacy = mm.enqueue('legacy', 'quick');
  assert.equal(legacy, null, 'legacy player waits in the bball queue');
  // It should sit in the bball queue (the default).
  assert.equal(mm.queueLength('quick', 'bball'), 1);
  assert.equal(mm.queueLength('quick'), 1, 'queueLength also defaults to bball');

  // An explicit bball player pairs with the legacy default-bball player.
  const room = mm.enqueue('explicit', 'quick', 'bball');
  assert.ok(room, 'explicit bball pairs with default-bball legacy');
  assert.equal(room.game, 'bball');
  assert.deepEqual(room.players.map((p) => p.id), ['legacy', 'explicit']);
  assert.equal(mm.roomCount(), 1);
});

test('PRIVATE ROOMS: matching code:* modes pair; a different code does not', () => {
  const mm = makeDeterministic();

  assert.equal(mm.enqueue('friend1', 'code:ABCDE', 'soccer'), null);

  // A third player with a DIFFERENT code must not join the first two.
  const wrong = mm.enqueue('stranger', 'code:ZZZZZ', 'soccer');
  assert.equal(wrong, null, 'different private code does not pair');
  assert.equal(mm.roomCount(), 0, 'no room yet — codes differ');

  // The matching code pairs with friend1.
  const room = mm.enqueue('friend2', 'code:ABCDE', 'soccer');
  assert.ok(room, 'same private code pairs');
  assert.equal(room.mode, 'code:ABCDE');
  assert.equal(room.game, 'soccer');
  assert.deepEqual(room.players.map((p) => p.id), ['friend1', 'friend2']);
  assert.equal(mm.roomCount(), 1);

  // The stranger is still waiting alone in its own code queue.
  assert.equal(mm.queueLength('code:ZZZZZ', 'soccer'), 1);
  assert.equal(mm.roomOf('stranger'), undefined);
});

test('double-enqueue is a no-op (same player twice returns null, queue unchanged)', () => {
  const mm = makeDeterministic();

  const first = mm.enqueue('dup', 'quick', 'bball');
  assert.equal(first, null);
  assert.equal(mm.queueLength('quick', 'bball'), 1);

  // Re-enqueue the same waiting player: no-op.
  const again = mm.enqueue('dup', 'quick', 'bball');
  assert.equal(again, null, 'second enqueue of a waiting player returns null');
  assert.equal(mm.queueLength('quick', 'bball'), 1, 'queue length unchanged');
  assert.equal(mm.roomCount(), 0);

  // A player already paired into a room also cannot double-enqueue.
  mm.enqueue('partner', 'quick', 'bball'); // pairs with 'dup'
  assert.equal(mm.roomCount(), 1);
  const paired = mm.enqueue('dup', 'quick', 'bball');
  assert.equal(paired, null, 'a roomed player cannot re-enqueue');
  assert.equal(mm.queueLength('quick', 'bball'), 0);
  assert.equal(mm.roomCount(), 1, 'no extra room from re-enqueue of roomed player');
});

test('remove(): removing a queued (unpaired) player frees the queue and returns null', () => {
  const mm = makeDeterministic();

  mm.enqueue('waiter', 'quick', 'bball');
  assert.equal(mm.queueLength('quick', 'bball'), 1);

  const res = mm.remove('waiter');
  assert.equal(res, null, 'removing a queued player (no room) returns null');
  assert.equal(mm.queueLength('quick', 'bball'), 0, 'queue is freed');

  // The freed slot means the next two players still pair normally.
  assert.equal(mm.enqueue('x', 'quick', 'bball'), null);
  const room = mm.enqueue('y', 'quick', 'bball');
  assert.ok(room);
  assert.deepEqual(room.players.map((p) => p.id), ['x', 'y']);
});

test('remove(): removing a paired player tears down the room and returns the orphaned peer', () => {
  const mm = makeDeterministic();

  mm.enqueue('host1', 'quick', 'bball');
  const room = mm.enqueue('guest1', 'quick', 'bball');
  assert.ok(room);
  assert.equal(mm.roomCount(), 1);

  // peerOf returns the OTHER player while the room is intact.
  assert.deepEqual(mm.peerOf('host1'), { id: 'guest1', role: 'guest' });
  assert.deepEqual(mm.peerOf('guest1'), { id: 'host1', role: 'host' });

  const res = mm.remove('host1');
  assert.ok(res, 'removing a paired player returns a teardown result');
  assert.equal(res.room.roomId, room.roomId, 'the torn-down room is returned');
  assert.deepEqual(res.peer, { id: 'guest1', role: 'guest' }, 'orphaned peer returned');

  // Room is gone; neither player resolves to a room anymore.
  assert.equal(mm.roomCount(), 0);
  assert.equal(mm.getRoom(room.roomId), undefined);
  assert.equal(mm.roomOf('host1'), undefined);
  assert.equal(mm.roomOf('guest1'), undefined);
  assert.equal(mm.peerOf('host1'), undefined);
  assert.equal(mm.peerOf('guest1'), undefined);
});

test('peerOf returns undefined for an unknown / unpaired player', () => {
  const mm = makeDeterministic();
  assert.equal(mm.peerOf('nobody'), undefined);
  mm.enqueue('lonely', 'quick', 'bball');
  assert.equal(mm.peerOf('lonely'), undefined, 'queued-but-unpaired has no peer');
});

test('validMode: rejects empty, non-strings and >64 chars; accepts normal strings', () => {
  // Rejected.
  assert.equal(validMode(''), false, 'empty string rejected');
  assert.equal(validMode('a'.repeat(65)), false, '65 chars rejected');
  assert.equal(validMode(null), false);
  assert.equal(validMode(undefined), false);
  assert.equal(validMode(123), false);
  assert.equal(validMode({}), false);
  assert.equal(validMode([]), false);
  assert.equal(validMode(true), false);

  // Accepted.
  assert.equal(validMode('quick'), true);
  assert.equal(validMode('code:ABCDE'), true);
  assert.equal(validMode('a'), true, '1 char accepted');
  assert.equal(validMode('a'.repeat(64)), true, 'exactly 64 chars accepted');
});

test('enqueue throws on an invalid mode (does not silently return null)', () => {
  const mm = makeDeterministic();
  assert.throws(() => mm.enqueue('p', ''), /unknown mode/);
  assert.throws(() => mm.enqueue('p', 'a'.repeat(65)), /unknown mode/);
});
