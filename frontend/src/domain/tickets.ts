import type { TicketPriority, TicketStatus } from "../api/tickets";

export const priorityLabels: Record<TicketPriority, string> = {
  urgent: "紧急",
  high: "高",
  normal: "普通",
  low: "低",
};

export const statusLabels: Record<TicketStatus, string> = {
  open: "待领取",
  in_progress: "处理中",
  resolved: "已解决",
  closed: "已关闭",
};

export const eventTypeLabels: Record<string, string> = {
  created: "创建工单",
  claimed: "领取工单",
  assigned: "分配工单",
  reassigned: "改派工单",
  status_changed: "状态变化",
  commented: "添加评论",
};

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatFullDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
