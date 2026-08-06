# pi-web-frq

本地运行的多模型 AI coding 工作台：三栏界面，支持项目管理、历史会话、流式对话、文件工作区与 Git。

## 能做什么

- **多模型对话**：选择 Provider 与模型、调节思考强度，SSE 流式输出（含打字机速度显示）。
- **项目与会话**：项目级隔离工作区；会话自动保存、可恢复、重命名、删除、分支续聊。
- **文件工作区**：只读文件树、内容搜索、文件预览（Markdown 可格式化阅读）、Git 状态/差异/提交。
- **系统提示词**：全局 `AGENTS.md` + 每项目专属指令，所见即所得编辑器。
- **运行资源**：管理 Pi 的模型 Provider、Skills 与 Plugins。
- **手机可用**：响应式布局，手机端抽屉式导航。

## 怎么启动

前置条件：Node.js 22+，并已配置至少一个 pi 模型（用 pi CLI 登录，或配置 `~/.pi/agent/models.json`）。

### 一键启动（推荐）

```powershell
npm install        # 首次
```

之后每次双击 **`start.bat`** 即可：自动构建（首次）→ 启动服务 → 自动打开浏览器。

- `start-hidden.vbs`：后台静默启动（日志写 `server.log`）
- `stop.bat`：停止服务

### 手动启动

```powershell
npm install
npm run build      # 生产构建（首次）
npm run start      # 启动服务
```

开发模式：`npm run dev`。

### 访问

- 本机：`http://127.0.0.1:30142`
- 局域网 / Tailscale：`http://本机IP:30142` 或 `http://设备名:30142`

端口和默认工作区可在「全局设置 → 系统」修改，保存到 `service.json`，重启后生效。

## 安全提示

- 服务无登录认证：局域网内设备都能访问。**请勿通过公网穿透（如 Tailscale Funnel、ngrok）直接暴露**，除非自行加访问令牌或反向代理鉴权。
- 启用的 Plugin 以本机 Node 权限运行，只启用可信来源的插件。
