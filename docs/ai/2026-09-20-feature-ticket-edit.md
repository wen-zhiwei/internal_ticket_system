# AI 操作记录：编辑已创建工单

- 日期：2026-09-20
- Feature：编辑已创建工单。
- 已确认规则：Supervisor 可编辑全部可见工单；Agent 只能编辑自己当前负责的工单；`closed` 工单禁止编辑；可编辑标题、问题描述、客户名称、联系方式和优先级。

## 修改内容

- `backend/internal/tickets/model.go`：增加编辑输入校验和关闭工单业务错误。
- `backend/internal/tickets/store.go`：增加事务化 `Update`，锁定工单、校验角色/处理人/状态，更新字段并写入 `updated` 事件。
- `backend/internal/httpapi/handler.go`、`tickets.go`：增加 `PATCH /api/tickets/{id}` 和错误映射。
- `db/migrations/0004_ticket_updates.sql`：允许 `ticket_events.event_type = 'updated'`。
- `frontend/src/api/tickets.ts`、`tickets.test.ts`：增加编辑 API client 和请求测试。
- `frontend/src/pages/TicketDetailPage.tsx`、`styles.css`、`domain/tickets.ts`：增加编辑入口、表单、字段校验、权限状态展示和更新历史文案。
- `backend/internal/httpapi/tickets_test.go`、`backend/internal/tickets/model_test.go`：增加编辑输入、错误映射和非法参数测试。

## 验证

- `GOCACHE=/tmp/internal_ticket_system-go-cache go test ./...`：通过。
- `GOCACHE=/tmp/internal_ticket_system-go-cache go vet ./...`：通过。
- `GOCACHE=/tmp/internal_ticket_system-go-cache go build ./...`：通过。
- `cd frontend && npm run format:check`：通过。
- `cd frontend && npm run lint`：通过。
- `cd frontend && npm test -- --run`：通过，2 个测试文件、7 个测试通过。
- `cd frontend && npm run build`：通过。
- PostgreSQL 迁移和集成测试：本机 `localhost:5432` 无响应，待可用数据库环境验证。
