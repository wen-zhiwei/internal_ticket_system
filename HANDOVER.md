# 项目交接文档

## 项目概述

这是一个面向滴滴自动驾驶客服团队的轻量工单平台。项目按 Feature 切片开发，当前已完成 Feature 1（演示用户/角色/当前用户切换）、Feature 2（工单基础模型、创建、列表、详情、SLA）、Feature 3（领取、分配、改派、状态机、评论、操作历史）、Feature 4（工单队列排序）、Feature 5（编辑已创建工单）、Feature 6/7（首页问候、快捷视图、查询标签、简单记忆）和 Feature 8（AI 助手基础能力）。

## 技术选型与架构

- 前端：React + TypeScript + Vite；目录 `frontend/`。
- 后端：Go + `net/http`；目录 `backend/`。
- 数据库：PostgreSQL；访问库为 `github.com/jackc/pgx/v5`。
- 迁移：`db/migrations/0001_users.sql`、`db/migrations/0002_tickets.sql`、`db/migrations/0003_ticket_comments.sql`、`db/migrations/0004_ticket_updates.sql`、`db/migrations/0005_autonomous_driving_demo.sql`、`db/migrations/0006_workflow_collaboration_demo.sql`，由 `make db-migrate` 按顺序执行。
- 前端数据必须来自 Go API，业务数据持久化 PostgreSQL。
- 当前 identity 使用 `X-User-ID`，后端从数据库读取角色，不信任客户端自报角色。

## 当前进度

- 自动驾驶客服场景已统一：页面、助手文案和演示工单围绕 Robotaxi 订单、接驾、自动驾驶服务和安全员问题。
- 已增加 6 张工作流与协作演示工单，覆盖待领取、处理中、已解决、已关闭、分配、改派、评论和操作历史。
- 助手完整草稿确认后会调用已有创建 API，创建成功后切换到全部工单并刷新列表。

- [x] 项目初始化、目录、环境变量、启动/测试/构建命令
- [x] 用户表、角色约束和三名演示用户
- [x] `GET /api/users`、`GET /api/me`
- [x] 当前用户切换与后端角色确认
- [x] 工单表、事件表、约束、索引、自动驾驶工作流与协作演示工单
- [x] 工单创建、列表、详情 API
- [x] Agent 最小可见范围与 Supervisor 全量可见范围
- [x] 状态/优先级/处理人筛选、标题/客户搜索、分页和白名单排序
- [x] SLA 查询计算与逾期标记
- [x] 队列、新建、详情页面和前端 API 测试
- [x] 领取、分配、改派、状态流转、评论
- [x] 状态机单元测试和可选 PostgreSQL 并发领取测试
- [x] 已创建工单编辑、权限/状态校验、更新事件和前端编辑表单
- [x] 首页问候、快捷视图、查询标签和按用户隔离的简单记忆
- [x] AI Assistant API、OpenAI-compatible Tool 调用、工单卡片、草稿预填充和前端助手浮窗
- [ ] 助手服务端多轮会话、确认操作、批量修改和幂等防重
- [ ] 在具备 PostgreSQL 的环境执行迁移和数据库集成验证

## Feature 2 规则与实现

- Agent 只能看到 `open` 且未分配工单，以及分配给自己的工单；Supervisor 可看到全部工单。
- 两种角色都可以创建工单。创建始终为 `open`、未分配，并在同一事务写入 `created` 事件。
- 工单详情中返回创建人、当前处理人、SLA 截止时间、逾期标记和按时间升序排列的操作历史。
- SLA：urgent 2h、high 8h、normal 24h、low 72h。`resolved`/`closed` 不标记逾期。
- `closed` 为终态；领取/分配/改派/状态机/评论已接入真实 API，业务变更和事件/评论写入使用同一事务。
- 队列排序支持创建时间、更新时间、优先级和 SLA 截止时间；字段与方向由后端白名单校验，默认创建时间倒序，并使用工单 ID 稳定排序。
- 编辑工单：Supervisor 可编辑全部可见工单，Agent 只能编辑自己负责的工单；`closed` 禁止编辑；字段更新和 `updated` 事件同事务提交。

## 启动方式

```bash
cp .env.example .env
make install
make db-up
make db-migrate
# 终端一
make api
# 终端二
make frontend
```

前端：`http://localhost:5173`；API：`http://localhost:8080`。

`make db-migrate` 优先使用本机 `psql`；若本机没有 `psql`，但 Compose 的 PostgreSQL 正在运行，则使用容器内客户端。迁移 seed 对已存在工单使用 `ON CONFLICT DO NOTHING`，不会重置业务状态。

## 最近一次 Feature 1 高标准补强

- 后端用户 API 增加成功列表、角色筛选、身份仓储故障和精确 CORS Origin 的自动化覆盖。
- 前端增加真实 API 驱动的用户加载、localStorage 恢复、身份切换、未声明客户端角色和 API 故障反馈测试。
- 修复用户列表重新加载成功后遗留身份错误提示的问题。
- 变更文件：`backend/internal/httpapi/handler.go`、`backend/internal/httpapi/handler_test.go`、`backend/internal/users/model_test.go`、`frontend/src/App.tsx`、`frontend/src/app.test.tsx`。

## 验证状态

本阶段已实际执行：

- `cd frontend && npm run format:check`：通过。
- `cd frontend && npm run lint`：通过。
- `cd frontend && npm test -- --run`：通过，2 个测试文件、6 个测试通过。
- `cd frontend && npm run build`：通过，TypeScript 与 Vite 构建通过。
- `make lint`：前端 ESLint 通过，后端因 `/bin/sh: go: command not found` 退出。
- `make test`：后端步骤因 `/bin/sh: go: command not found` 退出，未进入前端步骤。
- `make build`：后端步骤因 `/bin/sh: go: command not found` 退出，未进入前端步骤。
- `make format-check`：Go 检查因 `gofmt: No such file or directory` 失败，前端 Prettier 检查通过。
- `make db-migrate`：本机 PostgreSQL `localhost:5432` 无响应，Docker daemon 不可用。
- 2026-09-20：`make format-check`、`make lint`、`make test`、`make build` 和 `git diff --check` 已通过；数据库迁移和 PostgreSQL 集成验证仍未执行。

## 相关文件

- `backend/internal/tickets/model.go`：优先级、状态、校验、SLA 规则。
- `backend/internal/tickets/store.go`：列表、详情、创建、权限范围、事务。
- `backend/internal/tickets/model_test.go`、`store_test.go`：输入、UUID、SLA、可见范围测试。
- `backend/internal/httpapi/tickets.go`、`tickets_test.go`：API 路由、参数、错误映射测试。
- `frontend/src/pages/TicketQueue.tsx`：队列筛选、排序与分页。
- `frontend/src/pages/NewTicketPage.tsx`：创建表单。
- `frontend/src/pages/TicketDetailPage.tsx`：详情和历史。
- `backend/internal/assistant/`：AI Tool、模型适配器和助手业务服务。
- `frontend/src/components/AssistantWidget.tsx`：右下角助手浮窗。
- `.ai/SESSION.md`：持续恢复点（不进 Git）。
