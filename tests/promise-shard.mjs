/**
 * Splits the promise meta-test's runs across CI jobs. PROMISE_SHARD="k/n"
 * keeps every n-th run starting at the k-th; unset keeps them all (local
 * runs). A malformed value throws: a typo must fail the job, never quietly
 * run no breakers and pass.
 */
export function shardJobs(jobs, spec) {
  if (spec === undefined || spec === '') return jobs;
  const m = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(spec);
  if (!m || Number(m[1]) > Number(m[2])) throw new Error(`PROMISE_SHARD must be "k/n" with 1 <= k <= n, got "${spec}"`);
  const k = Number(m[1]), n = Number(m[2]);
  return jobs.filter((_, i) => i % n === k - 1);
}
