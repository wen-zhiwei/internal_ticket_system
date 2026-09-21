# AI 操作记录：Codex 开发记录展示页

日期：2026-09-21

## 目标

把客服协作工作台的开发过程整理成可以对外介绍的材料，重点说明：

- Codex 如何依靠项目规则和会话状态持续工作。
- 需求如何拆成 Feature、代码如何修改、验证如何执行。
- AI 助手为什么使用结构化工具，而不是直接执行数据库或 CLI。
- 如何在不暴露 API Key、数据库密码、Token 和本机路径的前提下展示开发过程。

## 展示方式

- `docs/codex-development-record.html`：适合现场演示，包含项目概览、系统演示视频、架构图、Feature 时间线、操作日志和打印功能。
- 本文件：作为展示页的文字来源和项目档案。
- `README.md`：说明如何打开 HTML 展示页和视频。
- `.ai/SESSION.md`：记录当前项目进度和下一次会话的恢复点，不进 Git。

## Codex 的实际工作闭环

```text
用户需求
  -> 读取 AGENTS.md 和 .ai/SESSION.md
  -> 检查当前代码和已有 Feature
  -> 给出实现计划
  -> 修改前端 / 后端 / 迁移 / 测试
  -> 运行 format-check / lint / test / build
  -> 检查 git diff --check
  -> 更新 .ai/SESSION.md
  -> 进入下一轮
```

## 三个持续记录文件的分工

| 文件 | 作用 | 是否进入 Git |
| --- | --- | --- |
| `AGENTS.md` | 稳定的技术约定、安全规则、开发流程和验收要求 | 是 |
| `.ai/SESSION.md` | 当前已完成、进行中、验证结果和下一步 | 否 |
| `docs/ai/*.md` | 每个 Feature 的目标、决策、变更、测试和遗留问题 | 是 |

如果新会话开始，先读取 `.ai/SESSION.md`，再检查它提到的实际文件；如果文档和代码不一致，以实际代码为准。

## 视频文件

展示页使用 HTML5 `<video>` 引用项目根目录的：

```text
省时版：系统演示视频.MOV
```

不把视频转成 Base64，也不复制一份到 HTML 中，避免展示页体积膨胀。分享整个项目时，需要同时保留这个视频文件。

## 本次展示页验证

已执行：

```text
HTMLParser 解析检查：通过
视频相对路径检查：通过
敏感信息扫描：通过
make format-check：通过
make lint：通过
make test：通过，前端 9 个测试文件、30 个测试通过
make build：通过，Go build 和 Vite production build 通过
git diff --check：通过
```

## 脱敏边界

展示材料不包含：

- `.env` 内容和 API Key
- 数据库密码
- Token 或认证头
- 本机绝对路径
- 不必要的真实客户隐私

展示页保留的是“如何开发、如何决策、如何验证”的工程证据，而不是把所有运行环境信息原样公开。
