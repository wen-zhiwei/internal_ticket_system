# AI 操作记录：工单队列排序

- 日期：2026-09-19
- Feature：工单队列排序。
- 产品决策：默认保持创建时间倒序；排序字段仅支持创建时间、更新时间、优先级和 SLA 截止时间；排序方向仅支持正序/倒序；后端使用固定白名单 SQL 表达式和工单 ID 稳定 tie-break。

## 修改内容

- 修改 `backend/internal/tickets/model.go`：增加排序字段/方向类型与解析函数。
- 修改 `backend/internal/httpapi/tickets.go`：解析并校验 `sort_by`、`sort_direction`。
- 修改 `backend/internal/tickets/store.go`：按固定白名单表达式生成排序 SQL，支持优先级和 SLA 截止时间排序。
- 修改 `backend/internal/tickets/model_test.go`、`store_test.go`、`backend/internal/httpapi/tickets_test.go`：补充排序解析、白名单和 API 参数测试。
- 修改 `frontend/src/api/tickets.ts`、`frontend/src/api/tickets.test.ts`：透传排序查询参数并测试编码结果。
- 修改 `frontend/src/pages/TicketQueue.tsx`、`frontend/src/styles.css`：增加排序字段/方向选择器和当前排序提示。
- 修改 `README.md`、`HANDOVER.md`：同步 Feature 4 API 和规则。

## 验证

- `cd frontend && npm run format:check`：通过。
- `cd frontend && npm run lint`：通过。
- `cd frontend && npm test -- --run`：通过，2 个测试文件、6 个测试通过。
- `cd frontend && npm run build`：通过，TypeScript 检查与 Vite 构建通过。
- `git diff --check`：通过；无输出。
- Go/PostgreSQL 验证仍受当前环境缺少 Go、psql 和未运行 Docker daemon 影响。
