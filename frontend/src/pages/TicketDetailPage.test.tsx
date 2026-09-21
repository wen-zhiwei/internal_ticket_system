import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTicket, type TicketDetail } from "../api/tickets";
import type { User } from "../api/users";
import { TicketDetailPage } from "./TicketDetailPage";

vi.mock("../api/tickets", async () => {
  const actual =
    await vi.importActual<typeof import("../api/tickets")>("../api/tickets");
  return {
    ...actual,
    getTicket: vi.fn(),
  };
});

const currentUser: User = {
  id: "00000000-0000-0000-0000-000000000003",
  name: "赵经理",
  team: "客服管理组",
  role: "supervisor",
  created_at: "2026-09-19T00:00:00Z",
};

const agents: User[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "王芳",
    team: "自动驾驶客服一组",
    role: "agent",
    created_at: "2026-09-19T00:00:00Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "李娜",
    team: "自动驾驶客服二组",
    role: "agent",
    created_at: "2026-09-19T00:00:00Z",
  },
];

const detail: TicketDetail = {
  ticket: {
    id: "10000000-0000-0000-0000-000000000001",
    title: "自动驾驶订单重复扣费",
    description: "客户反馈订单被重复扣费。",
    customer_name: "演示客户",
    customer_contact: "13800000000",
    priority: "high",
    status: "in_progress",
    assignee: {
      id: agents[0].id,
      name: agents[0].name,
      team: agents[0].team,
    },
    created_by: {
      id: currentUser.id,
      name: currentUser.name,
      team: currentUser.team,
    },
    sla_due_at: "2026-09-22T08:00:00Z",
    overdue: false,
    created_at: "2026-09-20T08:00:00Z",
    updated_at: "2026-09-20T09:00:00Z",
  },
  comments: [
    {
      id: 1,
      author: {
        id: agents[0].id,
        name: agents[0].name,
        team: agents[0].team,
      },
      body: "已核对订单流水，准备联系客户。",
      created_at: "2026-09-20T09:00:00Z",
    },
  ],
  history: [],
};

let container: HTMLDivElement;
let root: Root;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(getTicket).mockResolvedValue(detail);
});

afterEach(() => {
  act(() => root.unmount());
  vi.clearAllMocks();
  container.remove();
});

describe("TicketDetailPage collaboration layout", () => {
  it("places comments on the right and searches assignees by team", async () => {
    await act(async () => {
      root.render(
        <TicketDetailPage
          currentUser={currentUser}
          agents={agents}
          ticketId={detail.ticket.id}
        />,
      );
      await Promise.resolve();
    });

    const sidebar = container.querySelector(".detail-sidebar");
    expect(sidebar).not.toBeNull();
    expect(sidebar?.textContent).toContain("评论");
    expect(container.querySelector(".detail-main")?.textContent).not.toContain(
      "已核对订单流水",
    );
    expect(container.querySelector(".detail-key-facts")?.textContent).toContain(
      "自动驾驶客服一组",
    );

    const assignmentToggle =
      container.querySelector<HTMLButtonElement>(".assignment-toggle");
    expect(assignmentToggle).not.toBeNull();
    await act(async () => {
      assignmentToggle?.click();
    });

    const search = container.querySelector<HTMLInputElement>(
      "#ticket-assignee-search",
    );
    expect(search).not.toBeNull();
    await act(async () => {
      search?.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: "二组" }),
      );
      if (search) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(search, "二组");
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const options = container.querySelector(".assignee-options");
    expect(options?.textContent).toContain("李娜");
    expect(options?.textContent).toContain("自动驾驶客服二组");
    expect(options?.textContent).not.toContain("自动驾驶客服一组");
  });
});
