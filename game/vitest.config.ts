import { defineConfig, configDefaults } from 'vitest/config';

// The full-match simulation tests (sim.test.ts, behaviour.test.ts, diag.test.ts)
// are heavily CPU-bound and run for tens of seconds each. With vitest's default
// fork count (= CPU cores) they run concurrently and starve each other, which
// makes them exceed their timeouts and trips the worker RPC. Capping the fork
// pool leaves each heavy test enough CPU to finish, so the suite is reliable.
export default defineConfig({
  test: {
    // Run test files serially. Several full-match sim tests are CPU-bound (tens
    // of seconds) AND carry their own hard-coded per-test timeouts; running them
    // concurrently starves them and trips those timeouts / the worker RPC.
    // Serial files give each heavy test the whole machine, so the suite is
    // reliable. Cost: a slower full run — fine for the gate; dev can target files.
    fileParallelism: false,
    // server/ holds the Node-runtime backend (matchmaking, TURN, realtime) with
    // its own node:test suites — run those with `node --test "server/*.test.mjs"`,
    // not vitest, which can't parse the node:test format.
    exclude: [...configDefaults.exclude, 'server/**'],
    // diag.test.ts (random-input phantom-event scan) legitimately runs ~100s and
    // can creep past 120s under full-suite CPU contention — give it headroom so
    // the gate doesn't flake on a non-failure.
    testTimeout: 180000,
    hookTimeout: 180000,
    teardownTimeout: 180000,
  },
});
