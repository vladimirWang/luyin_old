import assert from "node:assert/strict";
import test from "node:test";
import { createWeChatJsSdkSignature } from "./wechat.js";

test("WeChat JS-SDK signatures are deterministic and field-sensitive", () => {
  const input = {
    ticket: "ticket-value",
    nonceStr: "nonce-value",
    timestamp: 1_700_000_000,
    url: "https://example.test/records",
  };
  const signature = createWeChatJsSdkSignature(input);

  assert.match(signature, /^[a-f0-9]{40}$/);
  assert.equal(createWeChatJsSdkSignature(input), signature);
  assert.notEqual(createWeChatJsSdkSignature({ ...input, url: `${input.url}?page=2` }), signature);
});
