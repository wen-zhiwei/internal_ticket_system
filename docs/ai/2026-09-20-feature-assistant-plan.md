# AI 助手与简单记忆方案

## 已确认的最小方案

需求 3「自然语言整理工单草稿」和需求 4「右下角对话助手」做成一个能力：

```text
用户消息
  -> Go Assistant API
  -> 大模型选择结构化工具
  -> ToolRegistry
  -> TicketService
  -> 权限、状态机、事务
  -> PostgreSQL
```

- `prepare_create_ticket` 只整理草稿，不直接创建工单。
- 用户确认后，前端调用已有的 `POST /api/tickets`，后端继续负责权限、校验、事务和历史记录。
- 查询类工具可以直接执行；修改类工具先生成待确认操作。
- 不让大模型执行任意 CLI 或 Shell。
- HTTP API 是前端调用 Go；AI Tool 是 Go 内部函数；二者最终复用同一个业务服务。
- 暂不单独做意图分类模型。工具名称和参数由 Go 每次请求大模型时传入。
- 工具执行结果使用结构化数据，前端可以直接展示文字、工单列表卡片、草稿卡片和确认卡片。
- 工具失败时返回 `ok/code/retryable/message`；临时错误最多重试 1–2 次，权限/参数/状态错误不重试。
- 写操作使用 `action_id` 和事务，避免网络超时造成重复创建。

## 第一版工具清单

```text
search_tickets             查询工单，筛选条件放参数中
get_ticket_detail          查看工单详情
prepare_create_ticket      整理新工单草稿
prepare_update_ticket      整理编辑工单草稿
prepare_change_status      准备修改状态
prepare_bulk_action        准备批量操作
confirm_pending_action     确认后执行待处理操作
cancel_pending_action      取消待处理操作
```

先不拆成很多相似工具，例如不单独创建 `search_my_open_tickets`、`search_this_week_tickets`。

## 简单记忆

第一版只记住用户偏好，不记敏感业务内容：

```text
default_date_range = "this_week"
timezone = "Asia/Shanghai"
favorite_view = "全部工单"
preferred_reply_style = "简洁"
```

当前先使用浏览器 localStorage 保存这些轻量偏好，避免为了第一版助手增加复杂的记忆系统。后续接入多设备、审计或团队共享时，再迁移到 PostgreSQL 的用户偏好表。对话上下文仍由服务端按 `conversation_id` 管理，不直接当作长期记忆。

## 本次先开发

1. 首页按时间显示问候语。
2. 工单队列增加快捷视图和保存查询标签。
3. 保存并使用上述简单记忆中的 `favorite_view`。
4. 保留现有工单 API 和权限边界，后续再接入模型和 Assistant API。


## 2026-09-20 已交付基础版本

- `POST /api/assistant/chat` 已接入 Go HTTP API。
- 已接入 OpenAI-compatible 模型服务；Ollama 可通过 `LLM_BASE_URL=http://localhost:11434` 使用。
- 已实现 `search_tickets`、`get_ticket_detail`、`prepare_create_ticket`。
- 查询结果、详情和草稿均返回结构化卡片数据。
- 前端助手浮窗支持消息、加载、错误、列表卡片、详情卡片和草稿卡片。
- 完整草稿卡片支持“确认创建工单”，调用已有创建 API；缺少必填信息时进入表单补齐。
- 创建成功后通知工单中心刷新，并切换到“全部工单”，避免新建的 open 工单被“我的待处理”筛选隐藏。
- 当前未配置模型时返回 `503 assistant_not_configured`，不使用假数据。

## 下一阶段

下一阶段再增加服务端持久化会话和 `conversation_id`，以及状态修改、批量操作和幂等防重。写操作必须继续经过现有 TicketStore 的权限、状态机、事务和幂等校验。
