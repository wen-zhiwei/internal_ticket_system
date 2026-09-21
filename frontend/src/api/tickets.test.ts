import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import {
  addTicketComment,
  changeTicketStatus,
  createTicket,
  listTickets,
  updateTicket,
} from "./tickets";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ticket API client", () => {
  it("sends identity and encoded filters to the Go API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [],
        page: 2,
        page_size: 10,
        total: 0,
        total_pages: 0,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await listTickets("agent-id", {
      q: "登录 问题",
      status: "open",
      priority: "urgent",
      assigneeId: "unassigned",
      page: 2,
      pageSize: 10,
      sortBy: "sla_due_at",
      sortDirection: "asc",
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/tickets?");
    expect(url).toContain("q=%E7%99%BB%E5%BD%95+%E9%97%AE%E9%A2%98");
    expect(url).toContain("status=open");
    expect(url).toContain("assignee_id=unassigned");
    expect(url).toContain("sort_by=sla_due_at");
    expect(url).toContain("sort_direction=asc");
    expect(new Headers(options.headers).get("X-User-ID")).toBe("agent-id");
  });

  it("preserves backend field validation errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: "validation_error",
          message: "请检查工单字段",
          fields: { title: "不能为空" },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = createTicket("agent-id", {
      title: "",
      description: "描述",
      customer_name: "客户",
      customer_contact: "contact@example.com",
      priority: "normal",
    });

    await expect(request).rejects.toMatchObject<Partial<ApiError>>({
      status: 400,
      code: "validation_error",
      fields: { title: "不能为空" },
    });
  });

  it("sends mutation requests with identity and JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticket: {}, comments: [], history: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await changeTicketStatus("agent-id", "ticket/id", "resolved");
    await addTicketComment("agent-id", "ticket/id", "已补充排查结果");

    const [, statusOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(statusOptions.method).toBe("PATCH");
    expect(new Headers(statusOptions.headers).get("X-User-ID")).toBe(
      "agent-id",
    );
    expect(statusOptions.body).toBe(JSON.stringify({ status: "resolved" }));
    expect(fetchMock.mock.calls[0][0]).toContain("/tickets/ticket%2Fid/status");
  });

  it("updates ticket fields through the dedicated edit endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticket: {}, comments: [], history: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      title: "更新标题",
      description: "更新描述",
      customer_name: "客户",
      customer_contact: "contact@example.com",
      priority: "high" as const,
    };
    await updateTicket("agent-id", "ticket/id", input);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/tickets/ticket%2Fid");
    expect(options.method).toBe("PATCH");
    expect(new Headers(options.headers).get("X-User-ID")).toBe("agent-id");
    expect(options.body).toBe(JSON.stringify(input));
  });
});
