import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantHistory } from "./AssistantHistory";

const currentUser = {
  id: "agent-001",
  name: "王芳",
  team: "自动驾驶客服一组",
  role: "agent" as const,
  created_at: "2026-09-20T00:00:00Z",
};

let container: HTMLDivElement;
let root: Root;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  container.remove();
});

describe("AssistantHistory", () => {
  it("shows persisted conversations and opens the selected conversation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "20000000-0000-0000-0000-000000000001",
                  title: "帮我查本周未处理的工单",
                  message_count: 4,
                  created_at: "2026-09-20T08:00:00Z",
                  updated_at: "2026-09-20T09:00:00Z",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const onSelect = vi.fn();
    const onNewConversation = vi.fn();

    await act(async () => {
      root.render(
        <AssistantHistory
          currentUser={currentUser}
          activeConversationId={null}
          refreshKey={0}
          onSelect={onSelect}
          onNewConversation={onNewConversation}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("帮我查本周未处理的工单");
    expect(container.textContent).toContain("4 条消息");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".assistant-history-item")
        ?.click();
    });
    expect(onSelect).toHaveBeenCalledWith(
      "20000000-0000-0000-0000-000000000001",
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".assistant-history-new")
        ?.click();
    });
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });
});
