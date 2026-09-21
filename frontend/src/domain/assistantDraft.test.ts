import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ASSISTANT_DRAFT_KEY,
  clearAssistantDraft,
  readAssistantDraft,
  saveAssistantDraft,
} from "./assistantDraft";

const draft = {
  title: "订单重复扣费",
  description: "客户反馈同一订单被扣费两次。",
  customer_name: "王女士",
  customer_contact: "13800000000",
  priority: "normal" as const,
  missing_fields: [],
};

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

describe("assistant draft storage", () => {
  it("stores and reads a draft from the current browser session", () => {
    saveAssistantDraft(draft);

    expect(sessionStorage.getItem(ASSISTANT_DRAFT_KEY)).toContain(
      "订单重复扣费",
    );
    expect(readAssistantDraft()).toEqual(draft);
  });

  it("clears a draft after it is consumed", () => {
    saveAssistantDraft(draft);
    clearAssistantDraft();

    expect(readAssistantDraft()).toBeNull();
  });

  it("ignores malformed session data", () => {
    sessionStorage.setItem(ASSISTANT_DRAFT_KEY, "not-json");

    expect(readAssistantDraft()).toBeNull();
  });
});
