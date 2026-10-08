# 客服工作台

面向自动驾驶客服团队的轻量工单平台。客服 Agent 可以领取和处理工单，主管 Supervisor 可以分配、改派并查看全部工单。

业务场景：自动驾驶订单重复扣费、Robotaxi 接驾失败、自动驾驶服务中断、安全员服务异常、订单状态未更新等客服问题。示例数据和助手文案均按自动驾驶客服场景设计，不代表滴滴内部真实业务规则。

项目按 Feature 切片开发，当前已完成 **Feature 1：演示用户与 identity**、**Feature 2：工单基础模型、创建、列表、详情与 SLA 展示**、**Feature 3：领取、分配、改派、状态机、评论与操作历史**、**Feature 4：工单队列排序**、**Feature 5：编辑已创建工单**、**Feature 6：首页问候与工单快捷视图**、**Feature 7：简单记忆**、**Feature 8：AI 工单助手基础能力** 和 **Feature 9：统计概览与可收缩目录栏**。

## 技术栈

- 前端：React + TypeScript + Vite
- 业务后端：Go `net/http`，负责权限、状态机、事务和业务 API
- AI 工具层：Python + LangChain
- AI 流程层：LangGraph，多轮状态保存到 PostgreSQL
- 数据库：PostgreSQL 16
- 数据访问：Go 使用 `github.com/jackc/pgx/v5`，Python 使用 `psycopg`
- 测试：Go `testing`、Pytest、Vitest
- 质量工具：ESLint、Prettier、Ruff、`go vet`、`gofmt`
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
├── assistant-service/         # LangChain 工具和 LangGraph 多轮流程
│   ├── main.py
│   ├── graph.py
│   ├── tools.py
│   └── tests/
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


| ID                                     | 姓名   | 角色         |
| -------------------------------------- | ---- | ---------- |
| `00000000-0000-0000-0000-000000000001` | 王芳   | agent      |
| `00000000-0000-0000-0000-000000000002` | 李娜   | agent      |
| `00000000-0000-0000-0000-000000000003` | 赵经理 | supervisor |


当前已确认的权限边界：

- Agent 队列只显示 `open` 且未分配的工单，以及已分配给自己的工单；Agent 查看其他客服负责的工单会收到 `403`。
- Supervisor 可以查看全部工单，并可使用处理人筛选。
- 两种角色都可以创建工单。
- Supervisor 的分配、改派、评论与 Agent 的处理权限均由后端强制校验；前端隐藏按钮不是权限边界。

## Feature 2、Feature 3、Feature 4 与 Feature 5 业务规则

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

### 编辑已创建工单

- Supervisor 可以编辑全部可见工单；Agent 只能编辑自己当前负责的工单。
- `closed` 工单禁止编辑；其他状态允许编辑标题、问题描述、客户名称、联系方式和优先级。
- 编辑输入沿用创建工单的长度、非空、去首尾空白和优先级校验。
- 工单字段更新与 `updated` 操作历史必须在同一事务中完成；关闭工单返回 `409 ticket_closed`。

### SLA

SLA 从 `created_at` 计算，在读取工单时计算截止时间和逾期标记，不依赖后台定时任务：


| 优先级    | SLA   |
| ------ | -----: |
| urgent | 2 小时  |
| high   | 8 小时  |
| normal | 24 小时 |
| low    | 72 小时 |


只有尚未 `resolved` 或 `closed` 且当前时间已超过截止时间的工单标记为逾期。

## 当前 API

所有工单接口都要求 `X-User-ID`，角色由后端数据库查询确定。

### `POST /api/assistant/chat`

AI 工单助手接口。请求必须携带 `X-User-ID`，请求体为：

```json
{
  "message": "帮我查一下本周未处理的工单"
}
```

成功返回助手文字和可选结构化卡片：

```json
{
  "reply": "找到 2 张工单。",
  "card": {
    "type": "ticket_list",
    "title": "查询结果",
    "items": []
  }
}
```

Go API 会先从 PostgreSQL 读取当前用户身份，再把消息和 `conversation_id` 发送给 Python 助手服务。LangGraph 负责多轮状态，LangChain 向模型提供 10 个结构化工具。查询结果、草稿和待确认操作以卡片返回；所有工单写操作最终仍调用 Go API，由 Go 强制校验权限、状态机和事务。未启动助手服务或未配置模型时返回 `503`，不返回假数据。

### `GET /api/health`

健康检查，返回 `{"status":"ok"}`。

### `GET /api/users`

读取演示用户列表，可选 `role=agent|supervisor`。

### `GET /api/me`

根据 `X-User-ID` 读取当前用户和数据库中的真实角色。

### `GET /api/tickets`

读取当前用户可见的工单队列。

### `GET /api/tickets/overview`

读取当前用户可见范围内的统计概览，返回全部工单、待处理、紧急、SLA 需关注数量，以及状态分布。Supervisor 统计全部工单；Agent 只统计自己可见的工单。

统计概览页面上的数字可以直接点击，自动套用对应筛选条件，不需要重复填写查询表单。

支持查询参数：

- `status=pending|open|in_progress|resolved|closed`；`pending` 表示待领取或处理中
- `overdue=true`：只看已超过 SLA 且尚未解决/关闭的工单
- `priority=urgent|high|normal|low`
- `assignee_id=<UUID>|unassigned`
- `q=<标题或客户名称搜索>`
- `page=<正整数>`，默认 1
- `page_size=1..100`，默认 20
- `sort_by=created_at|updated_at|priority|sla_due_at`，可选；默认按创建时间倒序
- `sort_direction=asc|desc`，可选；默认倒序

排序字段由后端白名单映射为固定 SQL 表达式，不接受任意列名或 SQL 片段。优先级排序顺序为 `urgent`、`high`、`normal`、`low`；所有排序都使用工单 ID 作为稳定的最终排序键。

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
- `PATCH /api/tickets/{id}`：编辑工单标题、描述、客户信息和优先级；Supervisor 可编辑全部可见工单，Agent 只能编辑自己负责的非关闭工单。

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
| `DATABASE_URL` | 本地 PostgreSQL | Go 业务数据、LangGraph 会话状态和待确认操作 |
| `WEB_ORIGIN` | `http://localhost:5173` | Go API 允许的前端来源 |
| `ASSISTANT_SERVICE_URL` | `http://127.0.0.1:8090` | Go 调用 Python 助手服务的地址 |
| `ASSISTANT_SERVICE_TOKEN` | 空 | Go 与 Python 服务间的可选鉴权 Token |
| `VITE_API_BASE_URL` | `/api` | React 调用 Go API 的地址 |
| `GO_API_BASE_URL` | `http://127.0.0.1:8080/api` | Python 工具调用 Go 业务 API 的地址 |
| `LLM_BASE_URL` | 空 | OpenAI-compatible 模型服务地址 |
| `LLM_API_KEY` | 空 | 只由 Python 助手服务读取的模型密钥 |
| `LLM_MODEL` | 空 | 模型名称 |

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

`make db-migrate` 会按文件名顺序执行 `db/migrations/*.sql`。本机有 `psql` 时连接 `DATABASE_URL`；本机没有 `psql` 但 Docker PostgreSQL 已运行时，会自动使用容器内的 `psql`。迁移包含三名演示用户和十张演示工单。`0006_workflow_collaboration_demo.sql` 额外准备了待领取、处理中、已解决、已关闭、改派和评论协作场景；演示工单 seed 使用 `ON CONFLICT DO NOTHING`，不会在重复迁移时覆盖已有业务状态。

也可以使用本机 PostgreSQL，只需将 `DATABASE_URL` 指向可用数据库。

## 页面使用设计

- 左侧目录栏默认展开，点击目录栏右上角的箭头可以收起；收起后保留图标，主内容区自动变宽。
- 展开/收起状态按浏览器保存，下次打开仍保持上次选择；窄屏下目录栏恢复为顶部导航，不会挤压页面内容。
- 工单中心最上方是“处理情况”统计概览：全部工单、待处理、紧急工单、SLA 需关注，以及状态分布。
- 统计数字只统计当前用户有权限看到的工单，不在前端自行拼接数据。

## 演示数据如何体现工作流和协作

执行迁移后，工单中心会有一组自动驾驶客服演示数据：

- **工作流**：待领取 → 处理中 → 已解决 → 已关闭，详情页可以查看每次状态变化。
- **分配与改派**：主管把工单分给王芳，再改派给李娜，可以在详情页看到处理人变化。
- **协作评论**：客服、主管可以在同一张工单下留言，评论和操作历史都会保留。
- **SLA 优先级**：同时准备紧急、高、普通优先级，方便演示排序、筛选和逾期状态。

推荐演示路径：

1. 右上角切换到“赵经理”，点击“全部工单”。
2. 打开“车辆已到站但无法接驾”，查看分配、改派和多人评论。
3. 打开“自动驾驶服务中断，需技术协同”，查看处理中工单的协作过程。
4. 打开“订单状态未更新”，查看从创建、分配、解决到关闭的完整流程。
5. 再切换到“王芳”或“李娜”，查看不同客服看到的待处理范围。

### 3. 启动 Go、Python 助手和前端

如果项目根目录有本地 `.env`，三个启动命令都会读取它。分别打开三个终端：

```bash
make api
make assistant
make frontend
```

调用链：

```text
React -> Go API -> Python LangGraph -> LangChain Tool -> Go 工单 API -> PostgreSQL
```

- Go 是唯一的工单业务入口，负责权限、状态机、事务和操作历史。
- Python 不直接修改工单表，只保存 LangGraph checkpoint 和 AI 待确认操作。
- React 负责消息、工单卡片、草稿卡片和确认按钮。

### 给别人使用助手：最简单的三种方式

浏览器和 Go 都不直接读取模型密钥。API Key 只写在运行 Python 助手服务的电脑上的 `.env`。

#### 方式一：使用自己的云端 API Key（推荐）

```bash
cp .env.example .env
```

编辑 `.env`：

```env
LLM_BASE_URL=https://api.stepfun.com/step_plan/v1
LLM_API_KEY=填写你自己的密钥
LLM_MODEL=填写服务支持的模型名
```

然后启动或重启：

```bash
make assistant
```

#### 方式二：使用 Ollama（本地运行，不需要云端 Key）

```bash
ollama serve
ollama pull qwen2.5:7b
```

`.env`：

```env
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:7b
```

模型必须支持工具调用。配置后执行 `make assistant`。

#### 方式三：其他 OpenAI 兼容服务

```env
LLM_BASE_URL=服务地址
LLM_API_KEY=服务密钥
LLM_MODEL=模型名称
```

> 分享项目时只分享 `.env.example`，不要分享 `.env`。

浏览器打开 [http://localhost:5173](http://localhost:5173)。当前页面会从真实 Go API 加载数据，支持当前用户切换、统计概览、目录栏收缩、工单筛选分页、创建工单、领取/分配/改派、状态流转、评论和详情历史查看。

停止 Docker 数据库：

```bash
make db-down
```

## 开发与验证命令

```bash
make format
make format-check
make lint
make test
make build
```

这些命令会一起检查 React、Go 和 Python 助手服务。

## AI 助手架构、多轮与 10 个工具

需求 3“自然语言整理工单草稿”和需求 4“我的助手”仍是一个统一功能，职责拆分为：

```text
Go = 工单业务核心
LangChain = 10 个结构化工具封装
LangGraph = 多轮 AI 流程编排
PostgreSQL = 业务数据、会话状态、历史消息和待确认操作
React = 页面、卡片和确认交互
```

同一用户、同一会话使用：

```text
thread_id = user_id + ":" + conversation_id
```

10 个工具：

1. `search_tickets`：查询工单并保存本轮候选顺序。
2. `get_ticket_detail`：查看工单详情。
3. `search_users`：按姓名或团队查询可分配的客服。
4. `prepare_create_ticket`：整理新工单；信息完整后生成待确认创建操作。
5. `prepare_update_ticket`：准备编辑工单。
6. `prepare_assign_ticket`：准备分配或改派工单。
7. `prepare_change_status`：准备修改单张工单状态。
8. `prepare_bulk_action`：按明确清单或筛选条件准备批量操作。
9. `confirm_pending_action`：用户确认后执行。
10. `cancel_pending_action`：取消待确认操作。

查询工具可以直接执行。创建、编辑、状态修改和批量修改必须先展示草稿或确认卡片。模型不能执行任意 CLI，也不能绕过 Go API 直接改工单表。

简单偏好仍按用户保存在浏览器 `localStorage`；业务会话历史、LangGraph checkpoint、最近工单候选、最近创建工单和待确认操作保存在 PostgreSQL。

## 已完成与未完成

### 已完成

- [x] React + TypeScript + Vite 前端和 Go API 基础架构
- [x] PostgreSQL 用户表、角色约束和三名演示用户
- [x] `GET /api/users`、`GET /api/me` 与数据库角色读取
- [x] 当前用户切换和 localStorage 记忆
- [x] 工单表、评论表、操作历史表、约束、索引和四张演示工单
- [x] `GET /api/tickets`：角色可见性、状态/优先级/处理人筛选、标题/客户搜索、分页和白名单排序
- [x] `POST /api/tickets`：输入校验、默认状态/处理人、创建历史事务一致性
- [x] `GET /api/tickets/{id}`：详情、操作历史、404/403 错误语义
- [x] SLA 截止时间和逾期状态的查询时计算
- [x] Agent 领取、Supervisor 分配/改派，以及后端角色和状态冲突校验
- [x] 原子并发领取策略与可选 PostgreSQL 并发集成测试
- [x] 状态机接口、评论持久化、操作历史和详情页操作 UI
- [x] 队列、新建工单、详情页面和响应式基础样式
- [x] 输入校验、API 错误字段透传、前端 API client 测试
- [x] 编辑已创建工单、后端权限/状态校验、`updated` 操作历史和编辑表单
- [x] 首页按时间问候、工单快捷视图、保存查询标签和按用户隔离的简单偏好记忆
- [x] 统计概览、待处理/SLA 快速筛选和可收缩左侧目录栏

### 未完成 / 范围外

- [ ] 完整登录、token、刷新和防止演示用户 ID 被冒用
- [ ] 后台 SLA 定时任务、通知、附件和实时推送
- [x] 自动驾驶客服助手浮窗、工单查询卡片、草稿确认创建和创建后回到工单中心
- [x] LangGraph 多轮会话、10 个工具、候选工单引用、创建/分配/批量确认操作和重复确认防重
- [ ] 高级标签/批量操作
- [ ] PostgreSQL 集成测试需要 Go 与 PostgreSQL 运行环境；已提供可选的并发领取测试，设置 `TEST_DATABASE_URL` 后执行

## AI 操作记录

每个 Feature 的实现和验证记录放在 `docs/ai/`：

- `docs/ai/2026-09-18-init.md`：项目初始化
- `docs/ai/2026-09-19-feature-users.md`：演示用户、角色与当前用户切换
- `docs/ai/2026-09-19-feature-tickets.md`：工单基础模型、创建、列表、详情与 SLA
- `docs/ai/2026-09-19-feature-actions.md`：领取、分配、改派、状态机、评论与并发策略
- `docs/ai/2026-09-20-feature-ticket-edit.md`：编辑已创建工单
- `docs/ai/2026-09-20-feature-assistant-plan.md`：AI 助手工具、失败处理和简单记忆方案
- `docs/ai/2026-09-20-feature-overview-sidebar.md`：统计概览与可收缩目录栏方案和验收记录
- `docs/ai/2026-09-21-feature-codex-development-record.md`：初始化边界、AGENTS.md、SESSION.md 和展示页来源记录

## Codex 开发记录展示

为了方便对外介绍本项目如何使用 Codex 开发，新增了一份独立的、纯 HTML 的脱敏展示页：

- `docs/codex-development-record.html`：需求拆解、AI 工具架构、系统演示视频、Feature 时间线、真实操作命令、验证结果和最终能力。
- `docs/ai/2026-09-21-feature-codex-development-record.md`：展示页的文字来源、视频引用方式和三类项目记录文件的分工。

直接打开：

```bash
open docs/codex-development-record.html
```

也可以在项目根目录启动临时静态服务后访问 `http://127.0.0.1:9000/docs/codex-development-record.html`：

```bash
python3 -m http.server 9000 --directory .
```

页面中的系统演示视频引用项目根目录的 `省时版：系统演示视频.MOV`，分享 HTML 时请同时保留这个视频文件。

展示页是基于本次开发记录整理的脱敏版本，不包含 API Key、数据库密码、Token、绝对本机路径或原始内部日志。页面不依赖 React、Go 或外部网络资源，支持浏览器打印/导出 PDF。
