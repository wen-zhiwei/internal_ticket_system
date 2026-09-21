import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./client";
import { listAssistantConversations, sendAssistantMessage } from "./assistant";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assistant API", () => {
  it("sends the message with the current user identity", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ reply: "找到 0 张工单。" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendAssistantMessage("agent-001", "帮我查一下未处理的工单"),
    ).resolves.toEqual({ reply: "找到 0 张工单。" });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(String(input)).toContain("/assistant/chat");
    expect(new Headers(init.headers).get("X-User-ID")).toBe("agent-001");
    expect(JSON.parse(String(init.body))).toEqual({
      message: "帮我查一下未处理的工单",
    });
  });

  it("sends the selected conversation and lists history", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: "继续处理。",
          conversation_id: "20000000-0000-0000-0000-000000000001",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await sendAssistantMessage(
      "agent-001",
      "继续查",
      "20000000-0000-0000-0000-000000000001",
    );
    await listAssistantConversations("agent-001");

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      message: "继续查",
      conversation_id: "20000000-0000-0000-0000-000000000001",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/assistant/conversations",
    );
  });

  it("keeps the assistant error code and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "assistant_not_configured",
              message: "AI 助手尚未配置模型服务",
            },
          },
          503,
        ),
      ),
    );

    await expect(
      apiRequest("/assistant/chat", { method: "POST" }),
    ).rejects.toEqual(
      new ApiError(503, "assistant_not_configured", "AI 助手尚未配置模型服务"),
    );
  });
});
