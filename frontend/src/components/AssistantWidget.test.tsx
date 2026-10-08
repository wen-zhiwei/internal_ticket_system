import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantWidget } from "./AssistantWidget";

const currentUser = {
  id: "agent-001",
  name: "王芳",
  team: "自动驾驶客服一组",
  role: "agent" as const,
  created_at: "2026-09-19T00:00:00Z",
};

let container: HTMLDivElement;
let root: Root;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.location.hash = "#/tickets";
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("AssistantWidget", () => {
  it("opens and closes the assistant panel", async () => {
    await act(async () => {
      root.render(<AssistantWidget currentUser={currentUser} />);
    });

    expect(container.textContent).toContain("助手");
    expect(container.querySelector(".assistant-panel")).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="打开我的助手"]')
        ?.click();
    });

    expect(container.querySelector(".assistant-panel")).not.toBeNull();
    expect(container.textContent).toContain("我的助手");
    expect(container.textContent).toContain("你好，我可以帮你查工单");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="关闭我的助手"]')
        ?.click();
    });

    expect(container.querySelector(".assistant-panel")).toBeNull();
  });
  it("confirms ticket creation through the assistant pending action", async () => {
    const actionId = "30000000-0000-0000-0000-000000000001";
    const conversationId = "20000000-0000-0000-0000-000000000001";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reply: "工单内容已整理，请确认后创建。",
            conversation_id: conversationId,
            card: {
              type: "pending_action",
              title: "待确认操作",
              action: {
                id: actionId,
                action_type: "create_ticket",
                summary: "创建工单《自动驾驶订单重复扣费》",
                status: "pending",
                items: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reply: "工单已创建。",
            conversation_id: conversationId,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    await act(async () => {
      root.render(<AssistantWidget currentUser={currentUser} />);
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="打开我的助手"]')
        ?.click();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, "创建一个自动驾驶订单重复扣费工单");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(container.textContent).toContain("创建工单《自动驾驶订单重复扣费》");
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "确认执行")
        ?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/assistant/chat");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      message: `确认执行操作 ${actionId}`,
      conversation_id: conversationId,
    });
  });

  it("confirms a pending action through the assistant", async () => {
    const actionId = "30000000-0000-0000-0000-000000000001";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reply: "状态修改已准备，请确认后执行。",
            conversation_id: "20000000-0000-0000-0000-000000000001",
            card: {
              type: "pending_action",
              title: "待确认操作",
              action: {
                id: actionId,
                action_type: "change_status",
                summary: "将工单《接驾失败》改为 resolved",
                status: "pending",
                items: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reply: "工单状态已更新。",
            conversation_id: "20000000-0000-0000-0000-000000000001",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    await act(async () => {
      root.render(<AssistantWidget currentUser={currentUser} />);
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="打开我的助手"]')
        ?.click();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, "把这张工单改为已解决");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(container.textContent).toContain("将工单《接驾失败》改为 resolved");
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "确认执行")
        ?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      message: `确认执行操作 ${actionId}`,
      conversation_id: "20000000-0000-0000-0000-000000000001",
    });
  });
});
