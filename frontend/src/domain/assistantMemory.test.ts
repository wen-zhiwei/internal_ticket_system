import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY,
  loadAssistantMemory,
  rememberAssistantMemory,
} from "./assistantMemory";
import { currentGreeting, greetingForHour } from "./greeting";

describe("assistant memory", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns safe defaults for a new user", () => {
    expect(loadAssistantMemory("agent-001")).toEqual(DEFAULT_MEMORY);
  });

  it("stores preferences separately for each user", () => {
    rememberAssistantMemory("agent-001", { favorite_view: "unassigned" });
    rememberAssistantMemory("agent-002", { preferred_reply_style: "详细" });

    expect(loadAssistantMemory("agent-001").favorite_view).toBe("unassigned");
    expect(loadAssistantMemory("agent-001").preferred_reply_style).toBe("简洁");
    expect(loadAssistantMemory("agent-002").favorite_view).toBe("all");
    expect(loadAssistantMemory("agent-002").preferred_reply_style).toBe("详细");
  });
});

describe("greeting", () => {
  it.each([
    [5, "早上好"],
    [11, "早上好"],
    [12, "中午好"],
    [13, "中午好"],
    [14, "下午好"],
    [17, "下午好"],
    [18, "晚上好"],
    [2, "晚上好"],
  ])("returns the correct greeting for %i:00", (hour, expected) => {
    expect(greetingForHour(hour)).toBe(expected);
  });

  it("uses the supplied date", () => {
    expect(currentGreeting(new Date("2026-09-20T08:00:00+08:00"))).toBe(
      "早上好",
    );
  });
});
