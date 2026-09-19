import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

type DemoUser = {
  id: string;
  name: string;
  role: "agent" | "supervisor";
  created_at: string;
};

const agent: DemoUser = {
  id: "agent-001",
  name: "张三",
  role: "agent",
  created_at: "2026-09-19T00:00:00Z",
};
const supervisor: DemoUser = {
  id: "supervisor-001",
  name: "主管用户",
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
  const requests: Array<{ url: string; headers: Headers }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (url.endsWith("/users")) {
        return jsonResponse({ items: [agent, supervisor] });
      }
      if (url.endsWith("/me")) {
        const currentId = headers.get("X-User-ID");
        return jsonResponse(currentId === supervisor.id ? supervisor : agent);
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

    expect(container.textContent).toContain("张三");
    expect(container.textContent).toContain("Agent · 客服");
    expect(requests.some((request) => request.url.endsWith("/users"))).toBe(
      true,
    );
    const meRequest = requests.find((request) => request.url.endsWith("/me"));
    expect(meRequest?.headers.get("X-User-ID")).toBe(agent.id);
    expect(meRequest?.headers.get("X-User-Role")).toBeNull();
    expect(
      window.localStorage.getItem("internal_ticket_system.current-user-id"),
    ).toBe(agent.id);
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
    expect(container.textContent).toContain("主管视图");

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
    expect(container.textContent).toContain("客服视图");
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
