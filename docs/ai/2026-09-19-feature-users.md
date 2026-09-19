# AI 操作记录：演示用户、角色与当前用户切换

- 日期：2026-09-19
- Feature：演示用户、角色与当前用户切换。
- 用户决策：当前 identity 通过 `X-User-ID` 传递；后端从 PostgreSQL 读取角色并忽略客户端声明的角色；不实现完整认证。Agent 只能处理自己的工单，Supervisor 负责查看、分配、改派和任意工单评论；两种角色都可以创建工单。

## 修改内容

- 新增 `backend/internal/users/model.go`：角色、用户模型和角色解析。
- 新增 `backend/internal/users/store.go`：基于 pgx 的参数化用户查询。
- 修改 `backend/internal/httpapi/handler.go`：增加 `GET /api/users`、`GET /api/me`、统一错误响应，并将 CORS 限制为配置的精确 Origin。
- 修改 `backend/cmd/server/main.go`：初始化 PostgreSQL 连接池并注入用户仓储。
- 新增 `backend/internal/httpapi/handler_test.go`：验证用户列表、角色筛选、数据库角色优先、缺失/未知 identity、非法角色、仓储错误和 CORS。
- 新增 `backend/internal/users/model_test.go`：验证仅允许 `agent` / `supervisor` 两种角色。
- 新增 `db/migrations/0001_users.sql`：用户表、角色 CHECK 和三名演示用户 seed，可重复执行。
- 新增 `frontend/src/api/client.ts`、`frontend/src/api/users.ts`：真实 Fetch API client 和用户 API 类型。
- 修改 `frontend/src/App.tsx`、`frontend/src/styles.css`：从 Go API 加载用户、切换当前用户、展示角色和错误状态；用户列表重试成功后会清理旧身份错误。
- 修改 `README.md`、`HANDOVER.md`、`Makefile`：同步迁移、启动、当前进度和验证说明。

## 验证

- `cd frontend && npm run format`：成功。
- `cd frontend && npm run lint`：成功。
- `cd frontend && npm test -- --run`：成功，2 个测试文件、6 个测试通过；新增 App 级 API/identity 测试。
- `cd frontend && npm run build`：成功，TypeScript 和 Vite 构建通过。
- `cd frontend && npm run format:check`：成功。
- `git diff --check`：成功。
- Go 侧验证未执行：当前环境没有 `go` 命令；代码已按 Go 结构编写，需在有 Go 工具链的环境补跑 `gofmt`、`go test ./...`、`go vet ./...`、`go build ./...`。

## 遗留

- Go/PostgreSQL 侧验证仍需在具备工具链和数据库服务的环境执行；前端已通过本阶段验证。
- 当前 `frontend` 安装环境曾缺失 Rolldown macOS x64 可选原生依赖，已通过 npm 补齐后完成测试和构建；`package.json` 保留该平台开发依赖以保证当前环境可复现。
