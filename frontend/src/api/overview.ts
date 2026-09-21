import { apiRequest } from "./client";

export type TicketOverview = {
  total: number;
  pending: number;
  urgent: number;
  sla_attention: number;
  by_status: {
    open: number;
    in_progress: number;
    resolved: number;
    closed: number;
  };
};

export function getTicketOverview(userId: string): Promise<TicketOverview> {
  return apiRequest<TicketOverview>("/tickets/overview", { userId });
}
