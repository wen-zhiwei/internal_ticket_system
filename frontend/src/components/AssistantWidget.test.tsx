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
  it("confirms a complete draft through the ticket API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reply: "工单草稿已整理，请核对内容后确认创建。",
            card: {
              type: "ticket_draft",
              title: "工单草稿",
              draft: {
                title: "自动驾驶订单重复扣费",
                description: "客户反馈自动驾驶订单重复扣费。",
                customer_name: "验收客户",
                customer_contact: "13900000000",
                priority: "normal",
                missing_fields: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ticket: { id: "ticket-created-1" } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
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
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (!textarea) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, "帮我创建自动驾驶订单重复扣费工单");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(container.textContent).toContain("确认创建工单");
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("确认创建工单"))
        ?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/tickets");
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      title: "自动驾驶订单重复扣费",
      customer_name: "验收客户",
    });
    expect(window.location.hash).toBe("#/tickets");
  });
});
