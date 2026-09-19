# Feature 3：工单处理动作与协作记录

## 范围

本阶段实现 Agent 领取、Supervisor 分配/改派、负责 Agent 状态流转、评论，以及对应操作历史。没有实现完整登录或演示用户 ID 防冒用，这与题面范围一致。

## 实际变更

- `backend/internal/tickets/model.go`
  - 增加状态机 `CanTransition`。
  - 增加分配、状态、评论输入验证。
  - 增加评论模型和业务冲突错误。
- `backend/internal/tickets/store.go`
  - 增加 Claim、Assign、Reassign、ChangeStatus、AddComment。
  - 业务更新与 `ticket_events` / `ticket_comments` 在同一事务写入。
  - 领取采用带 `status = 'open' AND assignee_id IS NULL` 条件的单条 UPDATE；并发请求只有一个能返回更新行。
  - 分配/改派/状态变更先在事务中锁定工单行，再校验当前状态和权限。
- `backend/internal/httpapi/handler.go`、`tickets.go`
  - 增加动作 API 和 400/403/404/409/503 错误映射。
- `db/migrations/0003_ticket_comments.sql`
  - 增加评论表和查询索引。
- `frontend/src/api/tickets.ts`
  - 增加动作 API client、评论类型和详情返回字段。
- `frontend/src/pages/TicketDetailPage.tsx`、`App.tsx`、`styles.css`
  - 接入领取、分配、改派、状态按钮和评论表单；所有操作调用真实 Go API。
- 测试
  - 增加状态机、输入校验、HTTP 409/400 映射测试。
  - 增加可选 PostgreSQL 并发领取集成测试：`TEST_DATABASE_URL=... go test ./backend/internal/tickets -run TestClaimConcurrentExactlyOneWinner`。

## 产品决策

- Supervisor 不执行通用状态流转；状态变更由负责 Agent 完成。
- Supervisor 可以在任意自己可见的工单添加评论；Agent 只能在自己负责的工单添加评论。
- `resolved` 不可直接改派；必须先由负责 Agent 回到 `in_progress`。`closed` 为终态。

## 验证

已执行：

```text
cd frontend && npm run format:check  # passed
cd frontend && npm run lint          # passed
cd frontend && npm test -- --run     # 2 files, 3 tests passed
cd frontend && npm run build         # TypeScript + Vite build passed
```

尚未执行：

```text
gofmt / go test / go vet / go build
make db-migrate
```

原因：当前环境没有 `go`、`gofmt`、`psql`，Docker daemon 也没有运行。后续必须在具备 Go 和 PostgreSQL 的环境中执行仓库级验证，并运行可选并发测试。
