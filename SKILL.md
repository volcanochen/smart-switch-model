---
name: switch-model
description: 切换/读取 WorkBuddy 当前窗口（当前会话）的运行模型。可用方法：通过 CDP（--remote-debugging-port）在页面上下文里点击真实的模型选择器，等价于用户手动点——会真正改变当前窗口模型，下一条消息由新模型接手。已知 db 直写会被 UI 回写覆盖、UIA 在 Electron 上不可靠。当用户要求"换模型/切回某模型/当前是什么模型/在两个模型间切换"时使用。
agent_created: true
---

# switch-model — 切换/读取当前窗口运行模型

## ✅ 核心结论（先读）

**可以脚本化切换当前窗口模型，办法是驱动真实的模型选择器 UI，而不是写数据库。**

实测可用的路径：**Chrome DevTools Protocol（CDP）**。WorkBuddy 是 Electron/Chromium 应用，
用 `--remote-debugging-port=9222` 启动后，可用一个独立进程（Node WebSocket 客户端）连接渲染进程，
在页面上下文里执行 JS，点击输入框的模型选择器并选目标项。这等价于用户在 UI 上手动点，
因此会真正改变**内存中的当前选中模型 + 持久化的 `sessions.model`**，且不会被回写覆盖。

> 验证（2026-10-17，WorkBuddy 5.5.3 / Electron 37 / Chrome 138）：
> 在 Hy3 对话里运行 CDP 脚本把当前窗口切到 Step-5-Preview，
> 回读 UI 选择器标签 = `Step-5-Preview`，DB `sessions.model` = `step-5-preview`，
> 发送下一条消息后未被回写。✅ 流程打通。

## ⚠️ 两条“看似可行实则不行”的路（已证伪，勿用）

1. **直写 `~/.workbuddy/workbuddy.db` 的 `sessions.model`** —— db 只是 UI/服务端状态的
   **下游镜像**，发送消息时 UI 用自己选中的模型调用服务端并回写，外部写入会被覆盖。
   实测：写 `step-5-preview` 后下一条消息 db 又被回写成 `hy3`。所以 `switch_model.py`
   那条路**不可靠**，仅保留为只读/诊断用途（`--list-sessions` / `--list-models`）。

2. **Windows UI Automation（UIA）** —— WorkBuddy 是网页应用，内容在 Chromium 渲染层，
   默认不向 UIA 暴露 web 控件（除非 `--force-renderer-accessibility`）；且本 agent 沙箱禁止
   `Add-Type` 加载 .NET 程序集，在此无法运行。Electron 上 UIA 不可靠，弃用。

## 前置条件（一次性）

CDP 需要渲染进程暴露调试端口。**单实例锁**会让第二次启动只激活旧实例（无调试端口），
因此必须：**先完全退出 WorkBuddy，再用调试端口启动一次**。

```powershell
# 1) 完全退出 WorkBuddy（任务管理器结束 WorkBuddy.exe）
# 2) 用调试端口启动（全新实例才会监听端口）
& "C:\Program Files\WorkBuddy\WorkBuddy.exe" --remote-debugging-port=9222
```

验证端口已起（注意用 `localhost`，`127.0.0.1` 会被 Chrome 返回 403）：
```bash
curl -s http://localhost:9222/json/version   # 应返回 Browser/Chrome 信息
```
页面目标（title="WorkBuddy"）的 `webSocketDebuggerUrl` 形如
`ws://localhost:9222/devtools/page/<PAGE_ID>`，脚本里已硬编码当前值；
若端口重启后 page id 变化，从 `curl http://localhost:9222/json` 重新取。

## 切换当前窗口模型（推荐方法）

脚本在 `scripts/cdp/`，用受管 Node（`C:/Users/adminlocal/.workbuddy/binaries/node/versions/22.22.2-2/node.exe`，
Node 22 自带全局 `WebSocket`，无需装包）。

```bash
cd "C:/Users/adminlocal/.workbuddy/skills/switch-model/scripts/cdp"
# 列出当前下拉框所有可选模型
node switch.js --list
# 切换到 Step-5-Preview（即 step-5-preview）
node switch.js step-5-preview
# 切回 Hy3
node switch.js hy3
```

别名映射（脚本内置）：`step-5-preview/step5/step-5 → Step-5-Preview`，
`hy3 → Hy3`，`hy4 → Hy4 preview`，`fast → 快速`，`balanced → 均衡`，`ultra → 极致`；
也可直接传下拉框里的**显示名**（如 `Step-5-Preview`、`Hy3`）。

输出示例：
```json
{ "before": "Hy3", "target": "Step-5-Preview", "after": "Step-5-Preview", "switched": true }
```

## 原理（CDP 点击真实选择器）

1. `Runtime.enable` 后，`Runtime.evaluate` 在页面主执行上下文跑 JS。
2. 找到 `.cr-model-selector__trigger`（输入框模型选择器按钮），`click()` 打开下拉。
3. 在下拉项 `.cr-model-selector__item` 中按 `.cr-model-selector__item-name` 文本匹配目标，
   `click()` 选中。React 事件委托在根节点，原生 click 会冒泡触发 `onClick`。
4. 回读 `.cr-model-selector__trigger-label` 确认标签已变。

> 当前 UI 类名（5.5.3）：`cr-model-selector`、`cr-model-selector__trigger`、
> `cr-model-selector__trigger--open`、`cr-model-selector__trigger-label`、
> `cr-model-selector__item`、`cr-model-selector__item-name`、
> `cr-model-selector__item--selected`。**若客户端升级改了类名，需重新用
> `probe.js` / `open_dropdown.js` 探测。**

## 验证“真的切换成功”（而非假成功）

旧方法（db 直写）的坑是“写了 db 但没切真模型”。正确验证两步：
- **UI 标签**：CDP 回读 `.cr-model-selector__trigger-label`（脚本已做）。
- **持久化**：`sqlite3 ~/.workbuddy/workbuddy.db "SELECT model FROM sessions WHERE id='<session>'"`，
  且**用户发送下一条消息后**再次查，确认仍是新值（未被回写）。

## “先有鸡先有蛋”的接力设计（已验证可行）

脚本由 Bash 子进程执行，与“当前是哪个模型在跑”无关——任何模型都能调用它。
因此可在 Hy3 对话里把窗口切到 step-5-preview，下一条用户消息由 step-5-preview 接手；
step-5-preview 再运行同一脚本切回 Hy3，形成两模型互切的接力。这正是用户最初设想的链路。

## 自动切换：撞 6004 频率限制时自动换模型（autoswitch.js）

频率限制（错误码 6004，详见 workbuddy-quota skill）触发时可让页面**自动切到回落模型**，省去手动点。
做法是往页面注入 MutationObserver（反应式）——**不是靠定时任务轮询**：WorkBuddy 定时任务/自动化
干不了实时反应（按计划跑独立轮次、且限流无法预知），它在整套设计里只配当"看门者"（重装监听器）。

```bash
cd ".../switch-model/scripts/cdp"
node autoswitch.js test    # dry-run 回归测试：伪造逼真 6004 横幅（必须命中）+ 聊天文本假阳性（必须不命中）
node autoswitch.js arm     # 注入监听器到当前页（真实模式，立即生效，直到页面重载）
node autoswitch.js watch   # 常驻：注入 + 每 5s 自愈重装 + WS 断线重连（重载/重登后自动恢复）
```

- 回落顺序：`WB_FALLBACKS="Hy3,GLM-5.3-Flash,Step-5-Preview"`（自动跳过当前模型，选第一个可用）。
- 冷却 `WB_COOLDOWN_MS=15000`，防同一条错误重复切。
- **只切模型、不自动重发**失败那轮（避免误触发送）；用户点"继续/重发"时用的就是新模型。
- 查状态：页面 `window.__wbAutoSwitch.status()`（含 `detector`/`fires`/`lastEvent`）。

### 检测器 v2（2026-10-19 事故后重写，必读）

**v1 事故复盘**：v1 只要"新增 DOM 含 `6004` + 频率/重置字样"就切。但**讨论 6004 的会话本身**
（回复、表格、深度思考代码块、侧边栏摘要）满是这些词，每次重新渲染/流式输出都误触发——
实测一天内误切 9 次模型，全程没有一次真撞 6004。**教训：检测器必须能区分"错误横幅"和"聊到错误的文本"。**

v2 需**同时满足**才触发（任一不满足即忽略）：
1. 文本 <300 字（横幅是一行话，长篇大论不是）；
2. 含 `6004` **或**命中应用 i18n 强特征短语（`超出频率限制` / `exceeded the rate limit` /
   `重置可用` / `can reset at` / `切换其他模型` / `switch models`）；
3. **不在**这些子树里：`.cr-markdown, .cr-reasoning, .cr-collapse, .monaco-editor,
   [class*="artifact"], [class*="detail-panel"], [class*="sidebar"], .cr-session,
   textarea, [contenteditable], .cr-composer, .cr-input`（我们自己的对话文本都住这些区域）；
4. **必须**挂在 error/notice/banner 类挂件里（正向结构信号：
   `[class*="error"],[class*="notice"],[class*="banner"],[class*="alert"],[class*="toast"],
   [class*="notification"],[class*="widget"]`，真实横幅 class 如 `cr-widget-error-message`）；
5. 横幅点名的模型仍是当前模型才切（防止"已切走又被横幅重渲染触发"打摆子）。

权衡：若真实横幅的 class 链不含 error/notice/banner 等字样，v2 会保持沉默（不自动切、用户手动切），
而不是再犯"乱切"的错。改客户端后若发现不灵，先用 `test` 模式验证，再按第 4 条放宽 class 匹配。

### 配套工具（scripts/cdp/）

| 脚本 | 用途 |
|---|---|
| `neuter_switch.js` | **止血**：屏蔽模型选择器上的**程序化** `.click()`（僵尸监听器走这条路），真人鼠标点击不受影响（原生事件分发不调 JS click 方法）。页面刷新后自动失效。 |
| `reload_page.js` | **安全刷新**：清掉关不掉的僵尸 MutationObserver（`delete window.__wbAutoSwitch` 停不了已 arm 的 observer！）。默认 90s 后、连续两次检测到空闲（无 `.cr-agent--processing`）才刷，绝不打断进行中的对话；刷新同时修复被误删的 DOM（从持久化状态重建）。`WB_RELOAD_DELAY_MS` 可调延迟。 |
| `cleanup_fake6004.js` | 清理 test 模式残留的假横幅。**只删带 `[data-test="fake-6004"]` 标记的节点**——v1 曾用"隐藏+含6004"启发式扫描，误删过 19 个对话节点，已废弃该做法。 |

### 看门任务（定时任务的正确用法）

监听器在页面重载/重登/重启后会丢，需要"看门者"装回去。
用 Windows 计划任务登录时跑 watch 模式（自愈重装 + 断线重连）：
```
schtasks /Create /TN "WorkBuddy AutoModelSwitch" /SC ONLOGON /F /TR "\"C:\Users\adminlocal\.workbuddy\binaries\node\versions\22.22.2-2\node.exe\" \"C:\Users\adminlocal\.workbuddy\skills\switch-model\scripts\cdp\autoswitch.js\" watch"
```
> ⚠️ 前提：WorkBuddy 仍须以 `--remote-debugging-port=9222` 启动，否则 watch 连不上、装不了。
> 停用：`schtasks /Delete /TN "WorkBuddy AutoModelSwitch" /F`；或页面里 `delete window.__wbAutoSwitch` 立即 disarm。
> **注意**：disarm 只删句柄，**停不了已经 arm 的 MutationObserver**——要真停，用 `neuter_switch.js`
> 屏蔽点击，或直接刷新页面（`reload_page.js` / 重启 WorkBuddy）。

## 安全与回滚

- 切换脚本只点 UI、不改 db，可逆（再点一次即可）。
- 调试端口会暴露本地渲染进程，实验完建议正常退出并以**不带调试端口**的方式重启 WorkBuddy。
- 不要手工编辑 `sessions` 表；不要删 db。
