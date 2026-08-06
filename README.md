# pi-web-frq

一个本地运行的多模型 Web coding-agent 工作台，以 [pi coding agent](https://github.com/earendil-works/pi-mono) SDK 驱动。它提供 pi-web 风格的三栏聊天界面、模型选择、thinking level 选择和可靠的 SSE 流式输出。

> 当前版本复用本机 pi 的已配置模型与凭据，向模型提供固定 workspace 内的受控文件工具，并提供独立管理的 Skills 与 Plugins。

## 已实现

- 多模型：自动发现 pi 已认证的内置 Provider、OAuth/API Key 模型和 `models.json` 中的 OpenAI/Anthropic/Google 兼容模型。
- 模型与推理控制：会话发起时可选择 Provider、模型和该模型支持的 thinking level。
- SSE 流式对话：逐段显示用户可见正文、受控运行状态和最终状态；私有 thinking 与工具内容不返回对话区。客户端支持任意网络分块、CRLF、心跳与中断检测。
- 深色中文三栏界面：左侧会话与运行配置、中间 Markdown 聊天、右侧 Codex 风格工作台（资源、搜索、Git、会话检查器）；小屏自动切换为单栏，手机端改为抽屉式布局（聊天全屏，会话/工作区从左右滑出），并按实际视口动态计算高度、适配安全区与横竖屏。
- 网络访问：服务默认监听全部网络接口；模型凭据在 Provider 管理界面中可配置，API Key 不会在读取接口中返回。
- 受控运行：固定且规范化的工作目录、禁用项目自动发现的 extensions/skills 和 bash；只启用自定义 workspace 工具及用户显式启用的 pi-web-frq 插件工具，拒绝绝对路径、路径穿越、链接/重解析点、隐藏文件与敏感凭据路径。
- 项目隔离：项目拥有独立的固定工作区；Pi 会话、模型文件工具、附件、右侧文件树、文件搜索和 Git 面板均使用该项目根目录。首轮回复后使用 pi 原生 JSONL 保存，可在项目内恢复、重命名、复制或删除历史会话；右侧会话检查器可展开安全脱敏后的会话结构，从用户/助手消息创建独立副本，或选择节点让下一条消息从该点继续分支。
- Skills 与 Plugins：左下角标签会扫描 pi 默认目录、当前 workspace 的项目目录以及用户手动配置的绝对目录。pi-web-frq 自建资源可创建、编辑、启用、停用和删除；扫描到的外部资源只读但可启用。Skills 的完整 `SKILL.md` 会在下一次运行注入 agent 指令；Plugins 是 pi 原生 TypeScript Extensions，可注册自定义工具和生命周期事件。

## 系统提示词

- **全局指令**：编辑 `~/.pi/agent/AGENTS.md`（全局设置 → 全局 AGENTS 指令），由 Pi 自动加载，对所有项目所有会话生效。
- **项目专属指令**：每个项目工作区下的 `.pi-web/project-system-prompt.md`（聊天框右侧书签按钮 → 项目提示词），仅注入该项目会话。
- 两者均通过所见即所得 Markdown 编辑器编辑；保存后对所有后续新消息生效（包括已有会话），但已有会话是否遵循最新指令取决于模型，建议在新会话中验证。

## 服务配置

服务端口、默认工作区与项目保存根目录持久化在 `~/.pi/agent/workbench/service.json`（全局设置 → 系统 可修改，重启后生效）。默认监听 `0.0.0.0:30142`。

## 前置条件

- Node.js `>= 22.19.0`
- 已配置至少一个 pi 模型。可以通过 pi CLI 完成 OAuth/API Key 登录，或配置 `~/.pi/agent/models.json`。

例如，Ollama 可在 `~/.pi/agent/models.json` 添加：

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [{ "id": "qwen2.5-coder:7b" }]
    }
  }
}
```

## 安装与运行

```powershell
npm install
$env:PI_WEB_WORKSPACE = "D:\Program\agent\pi\pi-web-ui"
npm run dev
```

打开 http://127.0.0.1:30142 。生产模式：

```powershell
npm run build
npm run start
```

`PI_WEB_WORKSPACE` 必须是一个存在的绝对目录。若未设置，应用使用进程当前目录；它仅作为未归类旧会话的默认工作区。通过左侧“项目”创建新项目时，若未填写工作区路径，应用会创建独立工作区到当前用户的 `Documents/Pi/<项目名>`；填写已有绝对目录时则直接绑定该目录。项目工作区不能与默认工作区或其他项目目录重叠，且一旦创建不可迁移（项目改名不会改动现有工作目录名）。默认服务脚本监听 `0.0.0.0:30142`，可通过本机或局域网地址访问，例如 `http://192.168.1.38:30142`。`npm run dev:lan` 与 `npm run start:lan` 是对应默认脚本的兼容别名。不要提交 `.env.local`。

默认会开放 `workspace_read`、`workspace_list`、`workspace_find` 和 `workspace_grep` 给模型，并限制读取为 1 MiB/2000 行、目录与 find 为 500 项、grep 为 100 个匹配。`workspace_read` 支持 `offset` 和 `limit` 分页读取长文件。浏览器还可通过 `GET /api/workspace/file?path=` 预览 UTF-8 文本（最大 1 MiB、前 2000 行）、`GET /api/workspace/files?query=` 搜索文件名（查询最长 200 字符、最多 50 项）以及内容搜索（支持忽略大小写/正则，带 500ms 时间预算防恶意正则）；两者禁用缓存、忽略敏感路径和链接。只有显式设置 `PI_WEB_ALLOW_WRITES=true` 后，才会额外注册 `workspace_write` 和 `workspace_edit`；写入内容限制为 1 MiB。工具仅接受相对路径，拒绝 `.git`、`.pi`、`.env*`、私钥与常见凭据路径，以及 symlink、junction 和其他 reparse point。

## 检查

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

## 项目结构

```text
src/
├─ app/                    Next.js 页面与 API 路由
│  ├─ api/chat/            受保护的 SSE chat endpoint
│  ├─ api/models/          仅返回可用模型元数据
│  └─ api/workspace/       受控 workspace 单层目录浏览
├─ client/                 POST-SSE 解析与 React 流式状态
├─ components/             Markdown 与工具活动视图
├─ server/                 workspace、请求校验、pi SDK、SSE 编码
└─ contracts.ts            前后端共享协议
```

## Skills 与 Plugins 目录

默认扫描的目录：

- Skills：`~/.pi/agent/skills`、`~/.agents/skills`、`<workspace>/.pi/skills`、`<workspace>/.agents/skills`
- Plugins：`~/.pi/agent/extensions`、`<workspace>/.pi/extensions`

在“技能”或“插件”弹窗的“扫描目录”中可添加任意已有绝对目录。目录配置当前仍写入 `~/.pi/agent/workbench/resources.json`，以兼容已有资源配置；仅用于 pi-web-frq 发现与启用资源，从默认或手动目录扫描到的文件不会被 pi-web-frq 改写或删除。

## 当前限制与下一步

- 点击“新会话”会创建本地草稿；pi 在第一条 assistant 回复后才把原生 JSONL 会话写入磁盘，因此随后才会出现在历史列表。
- 已实现历史会话恢复、多轮续聊、重命名、复制、删除、只读会话树、指定用户/助手消息 Fork、原会话从节点继续分支与受限纯文本导出。查看历史节点会进入只读预览，必须明确选择“从此继续”后才能发送，避免误续聊 active leaf。会话修改请求与流式运行共用进程内锁，运行期间会返回忙状态。
- 浏览器内可管理 Provider、Base URL、API 类型、模型列表、推理和图片能力；API Key 仅写入 `auth.json`，不会通过读取接口返回。
- workspace API 仅提供单层目录项与能力标志；它以及工具输出绝不返回本机 workspace 的绝对路径。
- 受控工具不是操作系统沙箱：可信本机用户仍应只对可信 workspace 启用 `PI_WEB_ALLOW_WRITES=true`。
- 右侧工作台提供当前项目相对路径的懒加载文件树、受控文件搜索、只读 Git 状态和工作区/暂存区 diff（无 Git 仓库时安全降级），以及会话检查器。项目间不会共享会话或工作区文件，已保存会话不能跨项目移动；项目需先删除其中的会话才能删除。检查器分别显示目标分支的累计计费用量与基于 SDK 上下文消息的 token 估算、模型窗口百分比和压缩标记；估算不包含未发送草稿。聊天标题也会显示当前会话累计 tokens、成本和计费记录数。
- 为保持大历史会话可用，详情 API 与 UI 只投影最近 160 条可见消息和 160 个安全树节点，并明确提示截断；旧记录中的 `<thinking>`、工具结果、工作区引用封套和本机绝对路径不会返回浏览器。
- 右侧会话树可只读查看指定 user/assistant 节点的历史路径；“从此继续”只会在下一条消息发送时创建新分支，不会因查看而改写 JSONL。
- 可导出当前 active/预览分支的受限纯文本快照：仅包含用户与公开助手内容，排除 thinking/reasoning、工具结果、摘要、内部引用封套、绝对路径和常见凭据。Git worktree 和更完整的上下文统计属于下一阶段。

## 安全说明

这不是一个操作系统级沙箱。即使文件工具实施了相对路径、敏感目录、符号链接和 reparse point 检查，仍应仅对可信工作区启用，尤其不要在不可信仓库中开启 `PI_WEB_ALLOW_WRITES=true`。pi-web-frq 禁止自动发现项目 Extensions/Skills，但用户启用的 Plugin 会以 Node.js 权限执行其 TypeScript 代码；只启用可信来源的 Plugin。

**当前没有 LAN 访问认证**：服务监听 `0.0.0.0`，局域网内任意设备均可读取会话/配置、发消息消耗模型额度并触发工作区工具。仅在可信网络中使用，或自行加反向代理鉴权。
