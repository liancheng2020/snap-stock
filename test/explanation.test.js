import test from "node:test";
import assert from "node:assert/strict";
import { explain, validateExplanation, factsFor } from "../lib/explanation.js";
const data = {
  trend: "中期偏弱",
  momentum: "动能改善",
  rows: [{ close: 100 }],
  events: [],
  returns: { 5: 1 },
  volumeRatio: 1,
  asOf: "2026-09-09",
  warnings: ["不保证未来"],
};
const valid = {
  sections: Array.from({ length: 3 }, () => ({
    text: "价格动能改善，但不能确认趋势反转。",
    factIds: ["trend"],
  })),
};
test("Missing key does not call model", async () => {
  assert.equal(
    (
      await explain(data, {
        key: "",
        request: () => {
          throw Error("must not call");
        },
      })
    ).provider,
    "rules",
  );
});
test("Valid DeepSeek output includes traceable facts", async () => {
  const r = await explain(data, {
    key: "test-only",
    request: async (url, init) => {
      assert.match(url, /chat\/completions$/);
      assert.equal(JSON.parse(init.body).response_format.type, "json_object");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(valid) } }],
        }),
      };
    },
  });
  assert.equal(r.provider, "deepseek");
  assert.equal(r.sections.length, 3);
  assert.deepEqual(r.facts, factsFor(data));
});
test("HTTP failure and invalid JSON return rules, never leak server error", async () => {
  for (const response of [
    { ok: false, status: 401 },
    {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "invalid" } }] }),
    },
  ]) {
    assert.equal(
      (await explain(data, { key: "test-only", request: async () => response }))
        .provider,
      "rules",
    );
  }
});
test("Unknown facts and trading instructions rejected", () => {
  assert.throws(() =>
    validateExplanation(
      {
        sections: [
          ...valid.sections.slice(0, 2),
          { text: "买入", factIds: ["trend"] },
        ],
      },
      factsFor(data),
    ),
  );
  assert.throws(() =>
    validateExplanation(
      {
        sections: [
          ...valid.sections.slice(0, 2),
          { text: "解释", factIds: ["invented"] },
        ],
      },
      factsFor(data),
    ),
  );
});
