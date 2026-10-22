# OMP-UI 集成 Oh My Pi (OMP) 使用指南与排查手册

欢迎使用 **OMP-UI**！本项目 Fork 自开源项目 [acp-ui](https://github.com/formulahendry/acp-ui)，并在其基础上进行了全面的高级夜航玻璃拟态（Nocturne Glassmorphism）视觉重构、无硬编码自适应架构升级、原生截图粘贴与多模态图片收发支持、模型/思考强度热切换与项目工作区管理。

---

## 一、功能介绍

### 1. 什么是 OMP-UI？
**OMP-UI** 是一个专为 **Oh My Pi (OMP)** 及 Agent Client Protocol (ACP) 生态打造的高颜值现代化图形客户端（基于 Vue 3、TypeScript 和 Tauri 构建）。它提供媲美专业 IDE 的交互界面，支持截图粘贴、文件拖放、实时工具调用展示、会话分支管理与权限拦截。
### 2. 什么是 Oh My Pi (OMP)？
**Oh My Pi（OMP）** 是一个功能强大的终端 AI 编程智能体（Coding Agent）。它不仅能够像 ChatGPT 那样回答问题，还能自主阅读你的项目代码、编辑与生成文件、运行测试与终端命令。

### 3. 二者是如何连接的？
ACP-UI 与 OMP 遵循统一的标准协议 —— **Agent Client Protocol (ACP)**：
* **桌面客户端（Windows / macOS / Linux）**：ACP-UI 桌面版直接通过系统的标准输入输出（`stdio`）在本机后台拉起 `omp acp` 进程，双方通过 JSON-RPC 2.0 消息高速互传，速度极快且完全运行在本地。
* **ACP 核心流程**：
  1. `initialize`：双方协商协议版本、声明客户端能力（如读写文件）；
  2. `session/new`：OMP 针对指定工作目录初始化会话，并返回可用模型、模式（Default/Plan）和思考等级；
  3. `session/prompt`：你在界面发送消息，OMP 实时流式吐字或发起工具调用。

### 4. 什么情况下需要 WebSocket 桥接？
* **桌面端应用**：默认直接运行 `omp acp` 的本地进程，**不需要** WebSocket 桥接。
* **网页版 / 移动端**：由于浏览器和移动应用安全沙箱无法直接启动本地操作系统的终端子进程，如果你需要在纯浏览器（Web）或手机端连接运行在本地电脑或远程服务器上的 OMP，需要借助桥接工具（例如 `@rebornix/stdio-to-ws`）把本地 `omp acp` 转为 WebSocket 服务，然后在 ACP-UI 中配置该 WebSocket 地址（如 `ws://127.0.0.1:3000`）。

---

## 二、安装与准备步骤

### 步骤 1：安装 Oh My Pi (OMP)
请根据你使用的操作系统，在终端中安装 OMP：

* **Windows 用户（PowerShell）**：
  ```powershell
  # 按照官方安装脚本执行，或通过已有的安装包安装
  irm https://raw.githubusercontent.com/can1357/oh-my-pi/main/install.ps1 | iex
  ```
* **macOS / Linux 用户**：
  ```bash
  curl -fsSL https://raw.githubusercontent.com/can1357/oh-my-pi/main/install.sh | bash
  ```

### 步骤 2：检查 `omp` 命令是否可用
打开一个新的终端窗口（Windows 终端、PowerShell 或 CMD），运行以下命令：
```bash
omp --version
```
如果能看到类似 `omp/18.12.1` 的版本号输出，说明安装成功且已加入环境变量 `PATH`。

再输入以下命令验证 ACP 服务端模式支持：
```bash
omp acp --help
```
终端应输出 `Run omp as an ACP (Agent Client Protocol) server over stdio`。

> **注意**：直接运行 `omp acp` 时，它会静默等待来自客户端的通信消息，终端看起来像“卡住”或无输出，这是完全正常的，按下 `Ctrl + C` 退出即可。

### 步骤 3：首次配置 OMP 模型与认证
在第一次打开 ACP-UI 图形界面之前，**务必先通过 OMP 原生命令行完成模型与 API Key 的配置**：
1. 打开系统终端，直接输入：
   ```bash
   omp
   ```
2. 按照 OMP 终端界面的向导提示，选择你希望使用的 AI 模型提供商（如 Google Gemini、Anthropic Claude、OpenAI、DeepSeek、本地 Ollama 等），并根据提示输入对应的 API Key 或完成登录授权。
3. 在终端中发送一条测试问答，确认 OMP 能够正常回复后，输入 `/exit` 退出终端。

> **提示**：OMP 会将认证状态保存在用户目录下的 `~/.omp/` 中。配置完成后，ACP-UI 启动 OMP 时会自动沿用这些配置，无需在图形界面中重新输入密钥。

### 步骤 4：运行 ACP-UI 桌面版
1. 启动 ACP-UI 桌面客户端。
2. 首次启动时，程序会自动读取并生成配置文件，默认列表中已内置包含 **Oh My Pi**。

### 步骤 5：选择 Oh My Pi Agent 并开启会话
1. 在 ACP-UI 主界面顶部的 **Agent 下拉菜单** 中，选择 **Oh My Pi**。
2. 在 **Workdir**（工作目录）输入框中，输入或点击选择你希望 AI 协助的项目根目录（必须为合法的绝对路径，例如 `D:\Project\my-app` 或 `/Users/name/my-app`）。
3. 点击 **New Session**（新建会话）按钮。
4. 稍等片刻，会话创建成功后，底部输入框即变为可用状态。顶部还会展示当前模型选择器和模式选择器（Default / Plan）。

---

## 三、配置方法与配置结构

ACP-UI 的配置文件保存于系统默认配置目录：
* **Windows**：`%APPDATA%\acp-ui\agents.json`（即 `C:\Users\<你的用户名>\AppData\Roaming\acp-ui\agents.json`）
* **macOS**：`~/Library/Application Support/acp-ui/agents.json` 或 `~/.config/acp-ui/agents.json`
* **Linux**：`~/.config/acp-ui/agents.json`

### 1. 默认内置配置示例
ACP-UI 中 Oh My Pi 的默认标准配置如下：
```json
{
  "version": 1,
  "agents": {
    "Oh My Pi": {
      "command": "omp",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

### 2. 字段解释
* `command`: 要执行的系统程序名称。默认为 `omp`。如果系统 PATH 找不到该命令，可以填写 `omp` 的绝对文件路径。
* `args`: 传给命令的参数列表。对于 OMP，**必须** 为 `["acp"]`。
* `env`: 为该 Agent 单独注入的环境变量字典。例如如果需要配置网络代理，可以配置：
  ```json
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:7890",
    "HTTPS_PROXY": "http://127.0.0.1:7890"
  }
  ```

### 3. 如何指定自定义 `omp` 安装路径？
如果你的电脑提示找不到 `omp` 命令，你可以在系统终端运行 `where omp`（Windows）或 `which omp`（macOS/Linux）找到它的完整路径，并在 `agents.json` 中配置绝对路径：

**Windows 示例**：
```json
{
  "command": "C:\\Users\\你的用户名\\AppData\\Local\\omp\\omp.exe",
  "args": ["acp"],
  "env": {}
}
```

**macOS / Linux 示例**：
```json
{
  "command": "/usr/local/bin/omp",
  "args": ["acp"],
  "env": {}
}
```

> **特别提醒**：
> 手动编辑 `agents.json` 时，请只添加或修改 `"Oh My Pi"` 条目，**千万不要删除或覆盖原有的其他 Agent 配置**，注意保持 JSON 语法的逗号和括号闭合。


### 4. 界面图形化配置全局网络代理（新增功能）
ACP-UI 现已在 **设置（Settings ⚙）** 面板中提供了专门的 **网络代理（Network Proxy）** 配置区域：
1. 点击左侧边栏顶部的 **⚙ 设置** 按钮打开设置面板；
2. 找到 **Network Proxy / 网络代理** 区域；
3. 勾选 **启用全局网络代理 (Enable Global Proxy)**；
4. 点击快捷预设（如 `Clash / Mihomo (7890)`、`v2rayN (10809)`、`SOCKS5`），或手动输入你的本地代理地址（如 `http://127.0.0.1:7890`）；
5. 点击 **保存代理** 按钮；
6. 开启后，ACP-UI 启动 Oh My Pi 及其他本地 stdio Agent 时，会自动将 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 注入子进程中，无需再手动修改配置文件！

### 5. 通过 SSH 远程连接服务器上的 OMP（支持自定义前置脚本）
你完全可以把 OMP 部署在云端 Linux 服务器（或公司开发机）上，然后用本地的 ACP-UI 图形界面远程控制它！

#### 核心原理
由于操作系统自带的 `ssh` 客户端天然就是一条基于标准输入输出（stdio）的加密管道，ACP-UI 可以直接通过调用本地 `ssh` 命令无缝对接远程服务器上的 `omp acp`。

#### 操作配置步骤
1. **前置要求**：本地电脑配置好免密 SSH 登录（通过 `ssh-copy-id user@your-server-ip` 或公钥认证），确保在终端输入 `ssh user@your-server-ip` 时不需要手动交互输密码。
2. **方式 A：在远程服务器上编写启动包装脚本（强烈推荐）**：
   在服务器上创建脚本，例如 `/home/ubuntu/start-omp.sh`：
   ```bash
   #!/bin/bash
   set -e

   # --- [自定义前置脚本区] 在 OMP 打开前执行任何你想执行的代码 ---
   source ~/.bashrc
   # 例如：激活特定的 Python/Conda 虚拟环境
   # source ~/miniconda3/bin/activate myenv
   # 例如：设置服务器的网络代理或环境变量
   export HTTP_PROXY="http://127.0.0.1:7890"
   export HTTPS_PROXY="http://127.0.0.1:7890"
   # 例如：拉取最新代码或执行自定义准备工作
   # cd /home/ubuntu/my-project && git pull

   # --- [启动 OMP] 启动 ACP 协议服务端 ---
   exec omp acp
   ```
   给脚本添加执行权限：`chmod +x /home/ubuntu/start-omp.sh`。
3. **在 ACP-UI 中添加远程 Agent**：
   * 打开 ACP-UI 设置（⚙），点击 **+ Add Agent**；
   * **Name**：`Server OMP (SSH)`
   * **Transport**：`stdio`
   * **Command**：`ssh`
   * **Arguments**：`-T user@your-server-ip "/home/ubuntu/start-omp.sh"`
     *(注意：参数 `-T` 用于关闭分配伪终端，确保 JSON-RPC 数据纯净)*
   * 点击 **Save**。
4. **直接在 Arguments 中内联执行命令（方式 B）**：
   如果不希望在服务器上存脚本，也可以直接在 Arguments 中内联脚本代码：
   ```
   -T user@your-server-ip "bash -c 'source ~/.bashrc && export HTTP_PROXY=http://127.0.0.1:7890 && omp acp'"
   ```

---

### 6. 编译后的可执行文件位置（已正式命名为 omp-ui）
程序已打包完毕，位于项目根目录，为你提供了两种最便捷的使用方式：

* **方式 1：标准安装向导（强烈推荐，全自动处理依赖）**：
  ```
  D:\Project\omp-ui\omp-ui-setup.exe
  ```
  直接双击该安装包，会自动安装到电脑并创建桌面快捷方式，所有依赖组件（包含 WebView2Loader 等）全自动安装完毕，永久免除缺少 DLL 的烦恼！

* **方式 2：绿色免安装便携版**：
  ```
  D:\Project\omp-ui\omp-ui.exe
  ```
  配套文件：`D:\Project\omp-ui\WebView2Loader.dll`（已配套放置在同一目录下）。
  直接双击 `omp-ui.exe` 即可免安装秒开运行！

* **原始编译产物完整归档目录**：
  ```
  D:\Project\omp-ui\src-tauri\target\x86_64-pc-windows-gnullvm\release\bundle\nsis\omp-ui_0.1.16_x64-setup.exe
  D:\Project\omp-ui\src-tauri\target\x86_64-pc-windows-gnullvm\release\omp-ui.exe
  ```
---

## 四、常见问题与新手排查步骤

### 1. 提示“未找到 omp 命令，请先安装 Oh My Pi，并确认其已加入系统 PATH”
* **原因**：ACP-UI 启动后台进程时，系统在环境变量 `PATH` 中没有找到名为 `omp` 的可执行文件。
* **排查步骤**：
  1. 重新打开一个命令提示符（CMD），输入 `omp --version`。如果命令行同样提示“不是内部或外部命令”，说明 OMP 未安装或安装路径未加到环境变量。
  2. 找到 OMP 的安装位置（通常在 `C:\Users\<用户名>\AppData\Local\omp\` 或 `~/.local/bin`）。
  3. 将该目录添加到系统的 `PATH` 环境变量中，并**完全重启 ACP-UI**。
  4. 或者直接在 ACP-UI 的设置中，将 `command` 改为 OMP 文件的绝对路径（见前节）。

### 2. 创建会话失败或长时间连接超时
* **原因**：大模型 API 网络连接受阻，或者 OMP 没有可用的网络代理。
* **排查步骤**：
  1. 如果你在国内使用海外模型（如 Google Gemini、Claude、OpenAI），确保本机代理客户端已开启。
  2. 在 `agents.json` 的 `env` 字段中显式添加代理设置：
     ```json
     "env": {
       "HTTP_PROXY": "http://127.0.0.1:7890",
       "HTTPS_PROXY": "http://127.0.0.1:7890",
       "ALL_PROXY": "socks5://127.0.0.1:7890"
     }
     ```
  3. 重启 ACP-UI 后再次新建会话。

### 3. 提示“Oh My Pi 模型或认证未配置”或没有任何回答
* **原因**：OMP 本身尚未配置大模型的 API Key 或认证凭据。
* **排查步骤**：
  1. 关闭 ACP-UI。
  2. 打开系统终端，运行 `omp`。
  3. 在 OMP 的控制台中根据提示设置 Provider 和 API Key，发送一句话测试能够回复后退出。
  4. 重新打开 ACP-UI 即可。

### 4. 权限确认后工具执行卡住或无响应
* **原因**：ACP-UI 在 Agent 执行写文件或终端操作时会弹窗询问用户授权。如果请求被取消或异步处理超时可能会出现等待状态。
* **排查步骤**：
  1. 检查界面中央是否弹出了带有允许/拒绝按钮的权限卡片，点击其中一项继续。
  2. 点击输入框旁的红色 **Cancel**（取消）按钮中断当前操作。
  3. ACP-UI 已经对权限拒绝做了优雅保护，即使你选择拒绝，OMP 也会妥善收到拒绝提示并告知你原因，不会破坏任何代码。

### 5. 提示“工作目录无效”或会话创建被拒绝
* **原因**：ACP 协议要求工作目录（cwd）必须是已存在的本地合法绝对路径。
* **排查步骤**：
  1. 确保填写的路径在资源管理器中能正常打开。
  2. 不要使用相对路径（如 `./` 或 `../`）。
  3. 在 Windows 上确保包含盘符（如 `D:\MyProject`）。

### 6. 网页版或手机端无法连接本地 Agent
* **原因**：网页浏览器无法直接调起操作系统的命令行工具。
* **排查步骤**：
  1. 在电脑上运行 WebSocket 桥接器：
     `npx @rebornix/stdio-to-ws "omp acp"`
  2. 记下桥接器打印的端口（如 `ws://localhost:3000`）。
  3. 在网页端 ACP-UI 的配置中添加一个类型为 `websocket` 的 Agent，填入上述地址连接。

---

## 五、功能支持情况总览

| 功能模块 | 支持状态 | 说明 |
| :--- | :---: | :--- |
| **启动与连接 (`omp acp`)** | **完整支持** | 原生 stdio 进程启动与 JSON-RPC 2.0 双向通信已全面验证 |
| **ACP 初始化 (`initialize`)** | **完整支持** | 协议版本协商、客户端读写文件能力、Agent 能力握手正常 |
| **创建会话 (`session/new`)** | **完整支持** | 传入绝对路径工作目录，成功获取会话 ID 与配置项 |
| **多轮普通聊天** | **完整支持** | 中英文对话均能顺畅交互，连续上下文保持正常 |
| **流式消息输出** | **完整支持** | 文字打字机式实时呈现，Token 用量实时更新 |
| **读取文件工具 (`fs/read_text_file`)** | **完整支持** | 客户端安全代读本地文件并返回给 Agent |
| **写入与创建文件 (`fs/write_text_file`)** | **完整支持** | 客户端写入文件并上报工具执行状态 |
| **工具状态更新 (Tool Cards)** | **完整支持** | 修复了工具调用先于文本到达时的挂载与更新显示 |
| **权限控制 (`session/request_permission`)** | **完整支持** | 允许与拒绝均有保护，拒绝时明确通知 Agent 且不偷渡修改 |
| **模型切换与选择** | **完整支持** | 自动解析 OMP 的 `configOptions`，并在模型菜单中切换当前模型 |
| **会话模式 (Default / Plan)** | **完整支持** | 支持切换标准模式与只读规划模式 |
| **思考等级 (Thinking Level)** | **已识别** | OMP 暴露了 thinking 级别，由 Agent 服务端自主管理 |
| **任务中断/取消 (`session/cancel`)** | **完整支持** | 可随时停止正在执行或生成中的耗时任务 |
| **会话恢复 (`session/load`)** | **完整支持** | 重新打开后支持加载旧会话，自动恢复历史模型与模式 |
| **老用户配置无缝兼容** | **完整支持** | 升级不覆盖已有 Agent，避免重复添加，尊重用户主动删除 |
