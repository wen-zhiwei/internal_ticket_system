# AI 操作记录：Feature 2 工单基础能力

日期：2026-09-19

## 目标

完成工单基础模型、创建、列表、详情、SLA 查询计算、Agent 可见性和对应前端页面；本 Feature 不实现领取、分配、改派、状态流转与评论动作。

## 实际变更

- 新增 `db/migrations/0002_tickets.sql`：`tickets`、`ticket_events`、约束、索引、更新时间 trigger、四张演示工单和创建事件 seed。
- 新增 `backend/internal/tickets/model.go`、`store.go`：优先级/状态模型、输入校验、PostgreSQL 列表/详情/创建仓储；创建和创建事件使用同一事务。
- 新增 `backend/internal/tickets/model_test.go`、`store_test.go`：输入规范化、UUID 格式、SLA、Agent/Supervisor 可见范围和参数化筛选条件测试。
- 新增 `backend/internal/httpapi/tickets.go`、`tickets_test.go`：列表、创建、详情 API，字段校验和 400/401/403/404/503 反馈。
- 新增 `frontend/src/pages/TicketQueue.tsx`、`NewTicketPage.tsx`、`TicketDetailPage.tsx`；增加真实 API 驱动的 hash 路由和响应式工作台样式。
- 新增 `frontend/src/api/tickets.test.ts`：请求身份/筛选参数和后端字段错误透传测试。
- 修改 `Makefile`：迁移按顺序执行全部 SQL；缺少本机 `psql` 时可调用运行中的 Docker PostgreSQL 客户端。
- 修改 `backend/internal/users/store.go`：使用 `id::text` 查询，格式不合法或不存在的演示 identity 统一走明确的身份不存在错误，而不是让数据库解析错误泄漏为 503。
- 修改 `README.md`、`HANDOVER.md` 和 `.ai/SESSION.md`：同步当前能力、角色规则、SLA 口径、启动和验证信息。

## 产品决策

1. Agent 队列显示 `open` 且未分配的工单和分配给自己的工单；这是“Agent 只能处理自己的工单”和“Supervisor 查看全部工单”的最小权限实现。
2. Agent 与 Supervisor 都可创建工单；创建不自动分配。
3. SLA 截止时间和逾期在读取时计算；`resolved` 与 `closed` 永不显示逾期。
4. 迁移演示工单使用 `ON CONFLICT DO NOTHING`，避免重复启动覆盖已经发生的业务操作。
5. 当前页面不渲染虚假的领取/分配/状态/评论按钮，详情页明确提示这些动作属于后续切片。

## 验证记录

已实际执行：

- `cd frontend && npm run format`：成功。
- `cd frontend && npm run format:check`：成功，`All matched files use Prettier code style!`。
- `cd frontend && npm run lint`：成功，无 ESLint 错误。
- `cd frontend && npm test -- --run`：成功，2 个测试文件、3 个测试通过。
- `cd frontend && npm run build`：成功，TypeScript 检查和 Vite 生产构建通过。
- `git diff --check`：成功，无空白错误。
- `make lint`：前端 ESLint 通过，后端因 `go: command not found` 失败。
- `make test`、`make build`：后端均因 `go: command not found` 失败，未宣称通过。
- `make format-check`：前端 Prettier 通过，Go `gofmt` 因命令不存在失败。
- `make db-migrate`：本机无 `psql`，Docker daemon 未运行而失败。尝试下载官方 Go/PostgreSQL 镜像也因 `Cannot connect to the Docker daemon at unix:///var/run/docker.sock` 失败。
- 后端命令在 Go 工具链不可用期间未宣称通过。

## 遗留问题

- 领取、分配、改派、状态机、评论及并发领取尚未实现。
- 尚未执行 PostgreSQL 集成测试；需要先完成 Go/数据库运行环境验证。
- 当前 identity 仍是演示身份，不提供防止用户 ID 被冒用的认证。
