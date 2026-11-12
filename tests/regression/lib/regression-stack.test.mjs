import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeStamp, reapPlan, stackName } from "./regression-stack-core.mjs";

const baseInputs = {
  headSha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80910",
  diff: "",
  dockerfile: "dockerfile-hash",
  compose: "compose-hash",
  lockfile: "lockfile-hash",
  environment: JSON.stringify({ basePort: 4100, dbUrls: { one: "postgres://5434" } }),
};

describe("computeStamp", () => {
  it("is deterministic for identical inputs", () => {
    const first = computeStamp(baseInputs);
    const second = computeStamp(baseInputs);
    assert.equal(first, second);
  });

  it("emits 40 lowercase hex chars (sha1)", () => {
    const stamp = computeStamp(baseInputs);
    assert.match(stamp, /^[0-9a-f]{40}$/);
  });

  it("changes when the uncommitted diff changes", () => {
    const withDiff = computeStamp({ ...baseInputs, diff: "--Y--\n+z" });
    assert.notEqual(withDiff, computeStamp(baseInputs));
  });

  it("changes when any identity input changes", () => {
    for (const key of ["headSha", "dockerfile", "compose", "lockfile", "environment"]) {
      const shifted = computeStamp({
        ...baseInputs,
        [key]: `${baseInputs[key]}-shifted`,
      });
      assert.notEqual(shifted, computeStamp(baseInputs), `${key} change must re-stamp`);
    }
  });

  it("does not change when unrelated input order of joined parts is stable", () => {
    const reordered = computeStamp({
      ...baseInputs,
      // Same values, object key order irrelevant (join order is fixed).
    });
    assert.equal(reordered, computeStamp(baseInputs));
  });
});

describe("reapPlan", () => {
  const stamp = computeStamp(baseInputs);
  const current = stackName("ssr", stamp);

  it("keeps a healthy current-stamp stack and reaps everything else", () => {
    const plan = reapPlan("ssr", stamp, [
      { name: current, healthy: true },
      { name: "bos-regression-ssr-aaaaaaaa", healthy: true },
      { name: "bos-regression-ssr-bbbbbbbb", healthy: false },
    ]);
    assert.deepEqual(plan.keep, [{ name: current, healthy: true }]);
    assert.deepEqual(
      plan.reap.map((c) => c.name),
      ["bos-regression-ssr-aaaaaaaa", "bos-regression-ssr-bbbbbbbb"],
    );
  });

  it("reaps an unhealthy current-stamp container (rebuild wins)", () => {
    const plan = reapPlan("ssr", stamp, [{ name: current, healthy: false }]);
    assert.deepEqual(plan.keep, []);
    assert.deepEqual(
      plan.reap.map((c) => c.name),
      [current],
    );
  });

  it("reaps every container when none matches the current stamp (fail loud, rebuild)", () => {
    const plan = reapPlan("ssr", stamp, [
      { name: "bos-regression-ssr-aaaaaaaa", healthy: true },
      { name: "bos-regression-ssr-bbbbbbbb", healthy: true },
    ]);
    assert.deepEqual(plan.keep, []);
    assert.equal(plan.reap.length, 2);
  });

  it("plans nothing for an empty fleet", () => {
    const plan = reapPlan("ssr", stamp, []);
    assert.deepEqual(plan.keep, []);
    assert.deepEqual(plan.reap, []);
  });

  it("never plans a keep for another variant's container", () => {
    const csrName = "bos-regression-csr-99999999";
    const plan = reapPlan("ssr", stamp, [{ name: csrName, healthy: true }]);
    assert.deepEqual(plan.reap, [{ name: csrName, healthy: true }]);
  });
});
