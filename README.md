# Internal Ticket System

面向客服团队的轻量工单平台。客服 Agent 可以领取和处理工单，主管 Supervisor 可以分配、改派并查看全部工单。

项目按 Feature 切片开发，当前已完成 **Feature 1：演示用户与 identity**、**Feature 2：工单基础模型、创建、列表、详情与 SLA 展示** 和 **Feature 3：领取、分配、改派、状态机、评论与操作历史**。

## 技术栈

- 前端：React + TypeScript + Vite
- 后端：Go `net/http`
- 数据库：PostgreSQL 16
- 数据访问：`github.com/jackc/pgx/v5`
- 测试：Go `testing`、Vitest
- 质量工具：ESLint、Prettier、`go vet`、`gofmt`
- 迁移：可重复执行的 SQL 文件，位于 `db/migrations/`

## 目录结构

```text
.
├── AGENTS.md
├── README.md
├── HANDOVER.md
├── Makefile
├── .env.example
├── compose.yaml
├── backend/
│   ├── cmd/server/main.go
│   ├── internal/config/
│   ├── internal/httpapi/
│   ├── internal/tickets/
│   ├── internal/users/
│   ├── go.mod
│   └── go.sum                 # 由 go mod download 生成/维护
├── db/migrations/
├── docs/ai/                   # AI 对话与操作记录
└── frontend/
    ├── src/App.tsx
    ├── src/api/
    ├── src/components/
    ├── src/domain/
    ├── src/pages/
    ├── src/styles.css
    └── package.json
```

## 角色模型与演示 identity

系统角色只有：

- `agent`：客服。
- `supervisor`：主管。

当前用户切换不是完整登录系统。前端从 Go API 加载用户列表，并把当前用户 ID 通过 `X-User-ID` 请求头发送给后端。后端根据该 ID 从 PostgreSQL 读取用户和角色，**不信任客户端自行声明的角色**。本题范围内不实现防止用户 ID 被冒用的认证机制，但所有业务权限仍必须由后端校验。

API 的跨域响应只允许 `WEB_ORIGIN` 配置的精确 Origin；允许的请求头为 `Content-Type` 与 `X-User-ID`，不会开放任意来源。客户端即使发送 `X-User-Role`，后端也不会读取或信任它。

预置演示用户：

| ID | 姓名 | 角色 |
| --- | --- | --- |
| `00000000-0000-0000-0000-000000000001` | 张三 | agent |
| `00000000-0000-0000-0000-000000000002` | 李四 | agent |
| `00000000-0000-0000-0000-000000000003` | 主管用户 | supervisor |

当前已确认的权限边界：

- Agent 队列只显示 `open` 且未分配的工单，以及已分配给自己的工单；Agent 查看其他客服负责的工单会收到 `403`。
- Supervisor 可以查看全部工单，并可使用处理人筛选。
- 两种角色都可以创建工单。
- Supervisor 的分配、改派、评论与 Agent 的处理权限均由后端强制校验；前端隐藏按钮不是权限边界。

## Feature 2 与 Feature 3 业务规则

### 工单字段

工单包含标题、问题描述、客户名称、联系方式、优先级、状态、处理人、创建人、创建时间和更新时间。新工单固定为：

- `status = open`
- `assignee = null`
- 同一事务写入 `created` 操作历史

输入由 API 和数据库双重校验：标题最多 200 字符，描述最多 10000 字符，客户名称最多 100 字符，联系方式最多 200 字符；文本首尾空白会被去除；优先级必须是 `urgent`、`high`、`normal`、`low`。

### 状态机

允许的流转为：`open -> in_progress`、`in_progress -> resolved`、`resolved -> in_progress`、`resolved -> closed`；`closed` 是终态。所有其他流转必须由后端拒绝并返回业务冲突错误。当前版本由负责 Agent 执行状态流转，Supervisor 负责分配、改派和跨工单评论。

### 领取、分配、改派与评论

- Agent 只能领取 `open` 且未分配的工单；领取使用带状态和未分配条件的原子更新。
- Supervisor 只能把 `open` 且未分配的工单分配给 Agent，分配与进入 `in_progress` 在同一事务完成。
- Supervisor 只能改派 `in_progress` 工单；`resolved` 不能直接改派，`closed` 是终态。
- 工单变更与对应的 `ticket_events` 历史写入在同一 PostgreSQL 事务中完成；业务冲突统一返回 `409`。
- 评论独立持久化在 `ticket_comments` 表，并同时写入 `commented` 事件；Agent 只能评论自己的工单，Supervisor 可以评论任意可见工单。

### SLA

SLA 从 `created_at` 计算，在读取工单时计算截止时间和逾期标记，不依赖后台定时任务：

| 优先级 | SLA |
| --- | ---: |
| urgent | 2 小时 |
| high | 8 小时 |
| normal | 24 小时 |
| low | 72 小时 |

只有尚未 `resolved` 或 `closed` 且当前时间已超过截止时间的工单标记为逾期。

## 当前 API

所有工单接口都要求 `X-User-ID`，角色由后端数据库查询确定。

### `GET /api/health`

健康检查，返回 `{"status":"ok"}`。

### `GET /api/users`

读取演示用户列表，可选 `role=agent|supervisor`。

### `GET /api/me`

根据 `X-User-ID` 读取当前用户和数据库中的真实角色。

### `GET /api/tickets`

读取当前用户可见的工单队列。

支持查询参数：

- `status=open|in_progress|resolved|closed`
- `priority=urgent|high|normal|low`
- `assignee_id=<UUID>|unassigned`
- `q=<标题或客户名称搜索>`
- `page=<正整数>`，默认 1
- `page_size=1..100`，默认 20

列表响应包含 `items`、`page`、`page_size`、`total`、`total_pages`。每项包含 SLA 截止时间和 `overdue` 计算结果。

### `POST /api/tickets`

创建工单。请求体：

```json
{
  "title": "生产环境无法登录",
  "description": "客户反馈管理员账号提示凭证无效。",
  "customer_name": "远山科技",
  "customer_contact": "ops@example.com",
  "priority": "urgent"
}
```

成功返回 `201` 和工单详情；参数错误返回 `400 validation_error`，其中 `error.fields` 包含字段级提示；未知 JSON 字段、非法 JSON 会返回 `400`。

### `GET /api/tickets/{id}`

读取工单详情、评论和操作历史。资源不存在返回 `404 ticket_not_found`，Agent 无权查看其他客服工单返回 `403 ticket_access_denied`。

### 工单处理写操作

所有接口都要求 `X-User-ID`，请求身份的角色由数据库读取。成功返回更新后的详情（评论返回 `201`）。

- `POST /api/tickets/{id}/claim`：Agent 领取未分配的 `open` 工单。
- `POST /api/tickets/{id}/assign`：Supervisor 分配 `open` 未分配工单，请求体为 `{ "assignee_id": "<agent uuid>" }`。
- `POST /api/tickets/{id}/reassign`：Supervisor 改派 `in_progress` 工单，请求体同上。
- `PATCH /api/tickets/{id}/status`：负责 Agent 变更状态，请求体为 `{ "status": "resolved" }` 等合法目标状态。
- `POST /api/tickets/{id}/comments`：添加评论，请求体为 `{ "body": "处理说明" }`。

处理人不存在返回 `404 assignee_not_found`，目标用户不是 Agent 返回 `400 assignee_not_agent`，状态不允许或并发占用返回 `409`。

### 错误语义

- `400`：参数格式、筛选条件或输入校验错误。
- `401`：缺少或不存在的演示 identity。
- `403`：当前角色无权访问资源。
- `404`：工单资源不存在。
- `409`：后续业务操作发生状态/并发冲突。
- `503`：数据库或持久化层暂不可用。

## 环境变量

复制模板：

```bash
cp .env.example .env
```

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `API_ADDR` | `:8080` | Go API 监听地址 |
| `DATABASE_URL` | `postgres://internal_ticket_system:internal_ticket_system@localhost:5432/internal_ticket_system?sslmode=disable` | PostgreSQL 连接串 |
| `WEB_ORIGIN` | `http://localhost:5173` | API 允许的前端来源 |
| `VITE_API_BASE_URL` | `http://localhost:8080/api` | 前端 API 基地址 |

不要提交 `.env`、密码、token 或其他秘密；只提交 `.env.example`。

## 本地启动

### 1. 安装依赖

需要 Node.js、npm、Go 1.27+、Docker（若使用 Compose）和 PostgreSQL。执行：

```bash
make install
```

### 2. 启动 PostgreSQL 并执行迁移

推荐使用 Docker Compose：

```bash
make db-up
make db-migrate
```

`make db-migrate` 会按文件名顺序执行 `db/migrations/*.sql`。本机有 `psql` 时连接 `DATABASE_URL`；本机没有 `psql` 但 Docker PostgreSQL 已运行时，会自动使用容器内的 `psql`。迁移包含三名演示用户和四张演示工单，演示工单 seed 使用 `ON CONFLICT DO NOTHING`，不会在重复迁移时覆盖已有业务状态。

也可以使用本机 PostgreSQL，只需将 `DATABASE_URL` 指向可用数据库。

### 3. 启动 API 和前端

分别在两个终端执行：

```bash
make api
make frontend
```

浏览器打开 <http://localhost:5173>。当前页面会从真实 Go API 加载数据，支持当前用户切换、队列筛选分页、创建工单、领取/分配/改派、状态流转、评论和详情历史查看。

停止 Docker 数据库：

```bash
make db-down
```

## 开发与验证命令

```bash
make format        # gofmt + 前端 Prettier
make format-check  # 检查格式
make lint          # ESLint + go vet
make test          # Go 测试 + Vitest
make build         # Go 构建 + 前端生产构建
```

前端也可以直接执行：

```bash
cd frontend
npm run format:check
npm run lint
npm test -- --run
npm run build
```

后端可直接执行：

```bash
cd backend
gofmt -w ./...
go test ./...
go vet ./...
go build ./...
```

## 已完成与未完成

### 已完成

- [x] React + TypeScript + Vite 前端和 Go API 基础架构
- [x] PostgreSQL 用户表、角色约束和三名演示用户
- [x] `GET /api/users`、`GET /api/me` 与数据库角色读取
- [x] 当前用户切换和 localStorage 记忆
- [x] 工单表、评论表、操作历史表、约束、索引和四张演示工单
- [x] `GET /api/tickets`：角色可见性、状态/优先级/处理人筛选、标题/客户搜索、分页
- [x] `POST /api/tickets`：输入校验、默认状态/处理人、创建历史事务一致性
- [x] `GET /api/tickets/{id}`：详情、操作历史、404/403 错误语义
- [x] SLA 截止时间和逾期状态的查询时计算
- [x] Agent 领取、Supervisor 分配/改派，以及后端角色和状态冲突校验
- [x] 原子并发领取策略与可选 PostgreSQL 并发集成测试
- [x] 状态机接口、评论持久化、操作历史和详情页操作 UI
- [x] 队列、新建工单、详情页面和响应式基础样式
- [x] 输入校验、API 错误字段透传、前端 API client 测试

### 未完成 / 范围外

- [ ] 完整登录、token、刷新和防止演示用户 ID 被冒用（题面明确不要求）
- [ ] 后台 SLA 定时任务、通知、附件和实时推送
- [ ] 编辑已创建工单和高级标签/批量操作
- [ ] PostgreSQL 集成测试需要 Go 与 PostgreSQL 运行环境；已提供可选的并发领取测试，设置 `TEST_DATABASE_URL` 后执行

## AI 操作记录

每个 Feature 的实现和验证记录放在 `docs/ai/`：

- `docs/ai/2026-09-18-init.md`：项目初始化
- `docs/ai/2026-09-19-feature-users.md`：演示用户、角色与当前用户切换
- `docs/ai/2026-09-19-feature-tickets.md`：工单基础模型、创建、列表、详情与 SLA
- `docs/ai/2026-09-19-feature-actions.md`：领取、分配、改派、状态机、评论与并发策略
