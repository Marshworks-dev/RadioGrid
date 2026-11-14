/**
 * The promise meta-test's CI split (promise-shard.mjs): every run lands in
 * exactly one shard, and a bad PROMISE_SHARD fails instead of running nothing.
 * Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shardJobs } from './promise-shard.mjs';

const jobs = Array.from({ length: 47 }, (_, i) => i);

test('unset keeps every run', () => {
  assert.deepEqual(shardJobs(jobs, undefined), jobs);
  assert.deepEqual(shardJobs(jobs, ''), jobs);
});

test('three shards cover every run exactly once, evenly', () => {
  const shards = [1, 2, 3].map((k) => shardJobs(jobs, `${k}/3`));
  assert.deepEqual(shards.flat().sort((a, b) => a - b), jobs);
  for (const s of shards) assert.ok(s.length >= 15 && s.length <= 16, `shard of ${s.length}`);
});

test('a malformed or out-of-range shard throws', () => {
  for (const bad of ['1', '0/3', '4/3', '1/0', 'a/3', '1/3 ', ' 1/3', '1-3']) {
    assert.throws(() => shardJobs(jobs, bad), /PROMISE_SHARD must be/, `"${bad}"`);
  }
});
