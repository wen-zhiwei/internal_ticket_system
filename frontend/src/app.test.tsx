import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

type DemoUser = {
  id: string;
  name: string;
  team: string;
  role: "agent" | "supervisor";
  created_at: string;
};

const agent: DemoUser = {
  id: "agent-001",
  name: "王芳",
  team: "自动驾驶客服一组",
  role: "agent",
  created_at: "2026-09-19T00:00:00Z",
};
const supervisor: DemoUser = {
  id: "supervisor-001",
  name: "赵经理",
  team: "客服管理组",
  role: "supervisor",
  created_at: "2026-09-19T00:00:00Z",
};

let container: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installSuccessfulApi() {
  const requests: Array<{
    url: string;
    headers: Headers;
    method?: string;
    body?: string;
  }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        headers,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.endsWith("/users")) {
        return jsonResponse({ items: [agent, supervisor] });
      }
      if (url.endsWith("/me")) {
        const currentId = headers.get("X-User-ID");
        return jsonResponse(currentId === supervisor.id ? supervisor : agent);
      }
      if (url.endsWith("/tickets/overview")) {
        return jsonResponse({
          total: 13,
          pending: 10,
          urgent: 3,
          sla_attention: 2,
          by_status: { open: 6, in_progress: 4, resolved: 2, closed: 1 },
        });
      }
      if (url.endsWith("/assistant/chat")) {
        return jsonResponse({
          reply: "我会继续在这段会话中处理。",
          conversation_id: "20000000-0000-0000-0000-000000000001",
        });
      }
      if (url.endsWith("/assistant/conversations")) {
        return jsonResponse({
          items: [
            {
              id: "20000000-0000-0000-0000-000000000001",
              title: "帮我查一下本周未处理的工单",
              message_count: 2,
              created_at: "2026-09-20T08:00:00Z",
              updated_at: "2026-09-20T09:00:00Z",
            },
          ],
        });
      }
      if (
        url.endsWith(
          "/assistant/conversations/20000000-0000-0000-0000-000000000001",
        )
      ) {
        return jsonResponse({
          id: "20000000-0000-0000-0000-000000000001",
          title: "帮我查一下本周未处理的工单",
          message_count: 2,
          created_at: "2026-09-20T08:00:00Z",
          updated_at: "2026-09-20T09:00:00Z",
          messages: [
            {
              id: "message-user",
              role: "user",
              content: "帮我查一下本周未处理的工单",
              is_error: false,
              created_at: "2026-09-20T08:00:00Z",
            },
            {
              id: "message-assistant",
              role: "assistant",
              content: "找到 6 张工单。",
              is_error: false,
              created_at: "2026-09-20T08:00:01Z",
            },
          ],
        });
      }
      if (url.includes("/tickets?")) {
        return jsonResponse({
          items: [],
          page: 1,
          page_size: 20,
          total: 0,
          total_pages: 0,
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  return requests;
}

async function renderAndFlush() {
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.location.hash = "";
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
  window.location.hash = "#/tickets";
});

describe("App identity bootstrap", () => {
  it("loads users and confirms the selected identity through the Go API", async () => {
    const requests = installSuccessfulApi();

    await renderAndFlush();

    expect(container.textContent).toContain("王芳");
    expect(container.textContent).toContain("Agent · 客服");
    expect(container.textContent).not.toContain(
      "权限由后端根据 PostgreSQL 中的角色校验",
    );
    expect(container.textContent).toContain("今日工作概览");
    expect(container.textContent).toContain("全部工单");
    expect(container.textContent).not.toContain("常用筛选");
    expect(
      container.querySelector('select[aria-label="切换工单视图"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(".ticket-center-island .page-intro"),
    ).toBeNull();
    expect(container.textContent).toContain("历史会话");
    const navigationItems = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".nav .nav-item"),
    );
    expect(navigationItems).toHaveLength(2);
    expect(navigationItems[0]?.textContent).toContain("工单中心");
    expect(navigationItems[0]?.classList.contains("active")).toBe(true);
    expect(navigationItems[1]?.textContent).toContain("历史会话");
    expect(container.querySelector(".assistant-history")).toBeNull();
    expect(container.querySelector(".ticket-workspace")).not.toBeNull();
    expect(container.querySelector(".assistant-panel-embedded")).not.toBeNull();
    expect(container.querySelector(".ticket-center-island")).not.toBeNull();
    expect(container.textContent).toContain("客服协作工作台");
    expect(container.textContent).toContain("今天工作也要稳稳推进");
    expect(container.textContent).not.toContain("自动驾驶客服助手");
    expect(container.querySelectorAll(".filter-panel select")).toHaveLength(2);
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("更多条件"))
        ?.click();
    });
    expect(container.querySelectorAll(".filter-panel select")).toHaveLength(5);
    expect(requests.some((request) => request.url.endsWith("/users"))).toBe(
      true,
    );
    const ticketRequest = requests.find((request) =>
      request.url.includes("/tickets?"),
    );
    expect(ticketRequest?.url).toContain("sort_by=created_at");
    expect(ticketRequest?.url).toContain("sort_direction=desc");
    const meRequest = requests.find((request) => request.url.endsWith("/me"));
    expect(meRequest?.headers.get("X-User-ID")).toBe(agent.id);
    expect(meRequest?.headers.get("X-User-Role")).toBeNull();
    expect(
      window.localStorage.getItem("internal_ticket_system.current-user-id"),
    ).toBe(agent.id);
  });

  it("shows history in the sidebar and opens a selected conversation", async () => {
    window.location.hash = "#/assistant-history";
    const requests = installSuccessfulApi();

    await renderAndFlush();

    const navigationItems = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".nav .nav-item"),
    );
    expect(navigationItems).toHaveLength(2);
    expect(navigationItems[1]?.classList.contains("active")).toBe(true);
    expect(container.querySelector(".ticket-workspace")).toBeNull();
    expect(container.querySelector(".assistant-history")).not.toBeNull();
    expect(container.textContent).toContain("帮我查一下本周未处理的工单");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".assistant-history-item")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.location.hash).toBe("#/assistant-history");
    expect(container.querySelector(".ticket-workspace")).toBeNull();
    expect(container.querySelector(".assistant-history-widget")).not.toBeNull();
    expect(container.textContent).toContain("找到 6 张工单。");
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '.assistant-history-widget textarea[aria-label="输入助手问题"]',
    );
    expect(textarea).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, "继续帮我处理这批工单");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      container
        .querySelector<HTMLFormElement>(".assistant-history-widget form")
        ?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    const chatRequest = requests.find((request) =>
      request.url.endsWith("/assistant/chat"),
    );
    expect(chatRequest?.method).toBe("POST");
    expect(JSON.parse(chatRequest?.body ?? "{}")).toMatchObject({
      message: "继续帮我处理这批工单",
      conversation_id: "20000000-0000-0000-0000-000000000001",
    });
  });

  it("restores the selected user and switches identity through the API", async () => {
    window.localStorage.setItem(
      "internal_ticket_system.current-user-id",
      supervisor.id,
    );
    const requests = installSuccessfulApi();

    await renderAndFlush();

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="切换当前用户"]',
    );
    expect(select?.value).toBe(supervisor.id);
    expect(container.textContent).toMatch(
      /(早上好|中午好|下午好|晚上好)，赵经理/,
    );

    await act(async () => {
      if (!select) throw new Error("identity selector was not rendered");
      select.value = agent.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      window.localStorage.getItem("internal_ticket_system.current-user-id"),
    ).toBe(agent.id);
    const meRequests = requests.filter((request) =>
      request.url.endsWith("/me"),
    );
    expect(meRequests.at(-1)?.headers.get("X-User-ID")).toBe(agent.id);
    expect(container.textContent).toMatch(
      /(早上好|中午好|下午好|晚上好)，王芳/,
    );
  });

  it("shows a clear initialization error when the API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "user_store_unavailable",
              message: "暂时无法读取用户列表",
            },
          },
          503,
        ),
      ),
    );

    await renderAndFlush();

    expect(container.querySelector(`[role="alert"]`)).not.toBeNull();
    expect(container.textContent).toContain("无法初始化工作台");
    expect(container.textContent).toContain("暂时无法读取用户列表");
  });
});
