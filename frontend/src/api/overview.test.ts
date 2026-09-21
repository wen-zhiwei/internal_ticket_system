import { afterEach, describe, expect, it, vi } from "vitest";
import { getTicketOverview } from "./overview";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ticket overview API", () => {
  it("requests an overview with the current user identity", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            total: 10,
            pending: 4,
            urgent: 2,
            sla_attention: 1,
            by_status: { open: 2, in_progress: 2, resolved: 4, closed: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTicketOverview("agent-001")).resolves.toMatchObject({
      total: 10,
      pending: 4,
      sla_attention: 1,
    });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(String(input)).toContain("/tickets/overview");
    expect(new Headers(init.headers).get("X-User-ID")).toBe("agent-001");
  });
});
