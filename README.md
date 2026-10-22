# OMP UI (`omp-ui`)

<p align="center">
  <strong>现代化高级夜航玻璃拟态（Nocturne Glassmorphism）图形客户端，专为 Oh My Pi (OMP) 与 Agent Client Protocol (ACP) 打造。</strong>
</p>

<p align="center">
  <a href="https://github.com/yanzhe-Xiao/omp-ui/releases"><img src="https://img.shields.io/github/v/release/yanzhe-Xiao/omp-ui?color=E4B863&label=Release" alt="Release" /></a>
  <a href="https://github.com/yanzhe-Xiao/omp-ui/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" /></a>
  <a href="https://agentclientprotocol.com/"><img src="https://img.shields.io/badge/Protocol-ACP%20v1-7C9CC4" alt="ACP" /></a>
</p>

---

> ℹ️ **鸣谢与开源溯源 (Fork Attribution)**:  
> 本项目 Fork 自开源客户端 **[acp-ui](https://github.com/formulahendry/acp-ui)**（作者 Jun Han）。我们由衷感谢 `acp-ui` 提供的优秀的 ACP 协议基础与多 Agent 架构。  
> **OMP UI** 在此基础上进行了全面的架构升级与视觉革新：深度适配终端 Coding Agent **Oh My Pi (OMP)**、全界面重构为极具电影质感的**高级夜航玻璃拟态（Nocturne Glassmorphism）**设计系统、实现全链路原生截图粘贴与多模态图片传输、消除所有前端硬编码、打造自适应动态模型/思考等级与技能发现系统。

---

## 🌟 核心特性 (Key Features)

### 1. 🌌 高级夜航玻璃拟态 (Nocturne Glassmorphism)
- **场景先于玻璃**：深墨夜景底色（`#0B1322` / `#060A13`）搭配柔和月光蓝天光（Light Wells），绝无通用 AI 紫粉渐变与纯色假玻璃；
- **物理光学材质**：5%~12% 低透明度白玻璃表面，辅以 `backdrop-blur-[60px]` 高斯模糊与 `backdrop-saturate-[180%]` 饱和度增强；
- **真实方向性光影**：顶边白色高光受光（`inset 0 1px 0 rgba(255,255,255,0.22)`）+ 底边暗缘背光（`inset 0 -1px 0 rgba(2,6,16,0.35)`）+ 柔和深景外阴影；
- **颗粒噪点质感**：全景叠加 2.5% SVG `feTurbulence` 颗粒噪点，彻底消除塑料感；
- **克制香槟金强调色**：唯一强调色香槟金（`#E4B863` / `#F3DCA8`）专用于主要操作、关键数字与高亮标记；
- **流体动效**：所有卡片交互与上浮均采用物理弹簧曲线 `cubic-bezier(0.16, 1, 0.3, 1)`。

### 2. ⚡ 深度原生集成 Oh My Pi (OMP)
- **开箱即用，默认首选**：后台 Agent 优先绑定 `Oh My Pi`，启动即走本地 `omp acp` 极速 `stdio` 通道，零网络延迟；
- **远程 SSH 实例支持**：轻松连接远程 Linux 服务器上的 OMP 实例，本地 UI 舒适操控；
- **智能工具调用看板**：阅读文件、编辑代码、运行 Shell 命令、检索文件（`es.exe`）等工具行为结构化展示，单步清晰可见。

### 3. 🖼️ 原生截图粘贴与多模态图片传输
- **截图即粘（Ctrl + V）**：输入框支持直接粘贴系统剪贴板中的截图；
- **文件拖拽（Drag & Drop）**：直接拖拽图片文件到输入区即可放入待发送队列；
- **浮动预览架**：输入卡片上方配有独立的圆角玻璃缩略图架，支持悬浮预览与单键移除；
- **历史图片自动恢复**：从 `~/.omp/agent/blobs/` 中自动将 `blob:sha256:...` 二进制恢复并渲染为高清缩略图，重温历史会话无缝呈现。

### 4. 🧠 100% 动态无硬编码模型与思考强度
- **动态读取本地认证账号**：自动读取 `~/.omp/agent/agent.db` 活跃账号凭证与 `~/.omp/agent/models.db` 缓存，绝不在前端写死模型；
- **欢迎页与对话页无缝热切换**：
  - 欢迎页预选模型即刻响应；
  - 对话中通过标准 `session/set_config_option`（`configId: "model"`）实时热切模型（如 `Claude Opus 4.6`, `Claude Sonnet 4.6`, `Gemini 3.8 Flash`, `GPT-OSS 120B` 等）；
  - 思考强度（`ThinkingPicker`）自适应向上展开，告别视口遮挡。

### 5. 🎯 动态技能与指令库 (Dynamic Skills)
- **本地技能自动扫描**：启动时自动扫描 `~/.omp/agent/skills/` 目录，解析 `SKILL.md` 元数据；
- **自动注册斜杠指令**：根据安装的真实技能自动生成 `/skill:everything`, `/skill:paper-analyzer`, `/skill:ppt-master`, `/skill:zotero-cli-cc` 等指令及中文说明；
- **智能场景卡片**：根据已安装技能在欢迎页动态生成场景推荐。

### 6. 📁 项目工作区树形管理 (Workspace Tree)
- **文件夹自动归纳**：非临时目录的会话按所属项目根目录分门别类归集；
- **一键新建项目会话**：每个项目文件夹行右侧常驻香槟金加号（`+`），点击即刻锁定该项目工作区并开启对话；
- **零丢失会话删除确认**：优雅的玻璃拟态防误触确认弹窗，彻底杜绝数据意外丢失。

---

## 📥 下载与安装 (Downloads)

最新编译产物可前往 **[GitHub Releases](https://github.com/yanzhe-Xiao/omp-ui/releases)** 下载：

| 平台 | 安装包形式 | 说明 |
| :--- | :--- | :--- |
| **Windows 桌面端** | `omp-ui-setup.exe` | 完整 Windows 安装向导程序（推荐） |
| **Windows 便携版** | `omp-ui.exe` | 绿色单文件便携可执行程序，双击即开 |
| **Web 网页版** | Vite Web 生产产物 | 支持在浏览器端直接打开并配合 WebSocket 使用 |

---

## 🚀 快速上手 (Quick Start)

### 前置要求
1. 安装 **Oh My Pi (OMP)**：
   - **Windows (PowerShell)**:
     ```powershell
     irm https://raw.githubusercontent.com/can1357/oh-my-pi/main/install.ps1 | iex
     ```
   - **macOS / Linux**:
     ```bash
     curl -fsSL https://raw.githubusercontent.com/can1357/oh-my-pi/main/install.sh | bash
     ```
2. 在终端首次配置模型并登录：
   ```bash
   omp
   ```
   按照提示完成模型厂商（如 Google Antigravity, OpenAI, Anthropic, DeepSeek 等）凭据绑定。

### 启动 OMP UI
- **桌面版**：直接双击运行 `omp-ui.exe`，应用会自动探测到已安装的 `omp`、已登录的模型和技能；
- **网页版（开发模式）**：
  ```bash
  npm install
  npm run dev:web
  ```
  浏览器打开 `http://localhost:5173/` 即可体验。

---

## 🛠️ 本地编译与构建 (Build from Source)

### 编译网页版
```bash
npm run build:web
```
构建产物输出于 `dist-web/` 目录。

### 编译桌面客户端 (Tauri)
```bash
npm run build:desktop
```
构建成功后可执行程序将生成于 `src-tauri/target/release/` 及 `src-tauri/target/release/bundle/nsis/`。

---

## 📄 开源许可证 (License)

本项目采用 [MIT 许可证](LICENSE)。再次感谢上游项目 [acp-ui](https://github.com/formulahendry/acp-ui) 的开拓性工作。
