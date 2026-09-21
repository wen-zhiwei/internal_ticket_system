# Feature 9：统计概览与可收缩目录栏

日期：2026-09-20

## 目标

在不增加复杂图表和新业务流程的前提下，让客服打开工单中心就能知道当前工作量，并可以快速进入对应工单范围。

## 已确定设计

### 统计概览

放在工单中心标题下方、筛选区上方，提供四个数字：

- 全部工单
- 待处理：待领取 + 处理中
- 紧急工单
- SLA 需关注：已超过 SLA 且未解决/关闭

下面提供状态分布：待领取、处理中、已解决、已关闭。

统计数据由 `GET /api/tickets/overview` 在 Go 后端聚合，沿用工单列表的权限范围：

- Agent：自己的工单，以及可领取的未分配工单。
- Supervisor：全部工单。

点击数字或状态可以直接套用筛选；SLA 需关注会使用后端的 `overdue=true` 条件，避免前端拿一页数据自行猜测。

### 可收缩目录栏

- 默认展开。
- 点击箭头后收起，只保留图标。
- 主内容区同步变宽。
- 使用 `localStorage` 保存用户选择。
- 小屏幕下恢复顶部导航布局，不强制缩成只有图标。

## 实现文件

- `backend/internal/tickets/model.go`：统计模型和列表过滤字段。
- `backend/internal/tickets/store.go`：权限范围内的 SQL 聚合和 pending/overdue 条件。
- `backend/internal/httpapi/tickets.go`：统计接口和过滤参数解析。
- `backend/internal/httpapi/handler.go`：注册 `GET /api/tickets/overview`。
- `frontend/src/api/overview.ts`：统计 API client。
- `frontend/src/components/TicketOverview.tsx`：统计概览组件。
- `frontend/src/pages/TicketQueue.tsx`：加载统计、点击统计套用筛选。
- `frontend/src/App.tsx`、`frontend/src/styles.css`：目录栏状态和响应式布局。

## 验证记录

已执行并通过：

```text
make format-check
make lint
make test
make build
git diff --check
```

结果：后端测试通过；前端 7 个测试文件、26 个测试通过；前端生产构建通过。
