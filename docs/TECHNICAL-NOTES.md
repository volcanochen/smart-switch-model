# 技术文档：WorkBuddy 模型切换与 6004 自动切换

> 本文档记录 smart-switch-model 的全部技术细节：证伪记录、CDP 原理、逆向发现、
> 自动切换架构设计、v2 检测器设计依据，以及 2026-10-19 误切模型事故的完整复盘。
> 实测环境：WorkBuddy 5.5.3 / Electron 37 / Chromium 138 / Windows 11。

---

## 1. 证伪记录：两条走不通的路

### 1.1 直写 `workbuddy.db` 的 `sessions.model` ❌

`~/.workbuddy/workbuddy.db` 的 `sessions.model` 只是 UI / 服务端状态的**下游镜像**。
实测：外部写 `step-5-preview` 后，用户发送下一条消息，db 被回写成 UI 当前选中的模型。
db 不是权威状态源，写它等于写日志。仅保留只读诊断用途。

### 1.2 Windows UI Automation（UIA）❌

WorkBuddy 是网页应用，内容在 Chromium 渲染层，默认不向 UIA 暴露 web 控件
（除非以 `--force-renderer-accessibility` 启动）。另外部分沙箱环境禁止 `Add-Type`
加载 .NET 程序集。Electron 上 UIA 不可靠，弃用。

## 2. CDP 方案原理（可行路径 ✅）

WorkBuddy 是 Electron/Chromium 应用，以 `--remote-debugging-port=9222` 启动后，
任意本地进程可通过 Chrome DevTools Protocol 连入渲染进程。

关键点：

1. **单实例锁**：第二次启动只会激活旧实例（无调试端口）。必须先完全退出 WorkBuddy，
   再带端口启动一次。验证：`curl -s http://localhost:9222/json/version`
   （注意用 `localhost`，`127.0.0.1` 会被 Chrome 返回 403）。
2. **目标定位**：从 `http://localhost:9222/json` 动态取 `type=page` 的
   `webSocketDebuggerUrl`（形如 `ws://localhost:9222/devtools/page/<PAGE_ID>`）。
   页面重载后 target id 不变，但旧 WebSocket 会死，需重连。
3. **注入执行**：`Runtime.enable` + `Runtime.evaluate` 在页面主执行上下文跑 JS。
4. **React 事件委托**：WorkBuddy 前端是 React，事件委托挂在根节点上——对 DOM 元素
   调用原生 `.click()` 会正常冒泡并触发 React 的 `onClick`，等价于用户手动点击。
5. **双层验证**：切换后回读 `.cr-model-selector__trigger-label`（UI 层）+
   查 `sessions.model`（持久层），且下一条消息后确认未被回写。✅ 实测通过。

### 2.1 模型选择器 DOM 结构（5.5.3 实测）

```
.cr-model-selector
├── .cr-model-selector__trigger              触发按钮（text = 模型名）
│   └── .cr-model-selector__trigger-label    干净的模型名文本
│   （展开时加 .cr-model-selector__trigger--open）
└── .cr-model-selector__item                 下拉项（仅展开时存在于 DOM）
    ├── .cr-model-selector__item-name        干净模型名
    └── .cr-model-selector__item--selected   当前选中项
```

> ⚠️ 客户端升级可能改类名。探测工具：`scripts/cdp/probe.js`、`open_dropdown.js`。

## 3. 逆向发现：模型、费率与配额

### 3.1 模型与费率快照（2026-10-19，会随运营变化）

从真实下拉框提取（`list_models.js`），共 21 个模型。费率 = 消费倍率，成本 = 基础积分 × 倍率：

| 模型 | 费率 | 备注 |
|---|---|---|
| Hy3 | 0.00x | 限时免费 |
| Step-5-Preview | 0.00x | 独家限免 |
| GLM-5.3-Flash | 0.06x | |
| Deepseek-V4.1-Flash | 0.11x | 夜间折扣 |
| MiMo-V2.6-Pro | 0.13x | |
| MiniMax-M3 | 0.25x | |
| Hy4 preview | 0.29x | 夜间免费 |
| 快速 | 0.21x / 均衡 0.65x / 极致 1.20x | 三档预设 |
| Space-Bunny | 0.08x | |
| Deepseek-V4-Pro | 0.51x | 夜间折扣 |
| Kimi-K2.7-Code | 0.57x / K2.8-Preview 0.77x / **K3 1.62x** | |
| GLM-5.2 / 5.1 / 5.3 | 0.79x | |
| GLM-5v-Turbo | 0.71x | |
| qwen3.5-9b@think | — | 本地模型 |

> 解析坑：倍率要从**干净模型名之后**的剩余文本里匹配（`GLM-5.3` + `0.79x` 连起来会
> 误匹配成 `30.79x`）。

### 3.2 配额查询 API（同源 fetch，自动带鉴权）

WorkBuddy 的积分余额**本地 db 里没有**，必须走服务端。渲染进程里有一个
`www.workbuddy.cn` 的同源 iframe，在其中 `fetch(endpoint, {credentials:'include'})`
自动带 cookie/鉴权（`query_quota.js` 的实现方式）：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/billing/meter/get-user-resource-summary` | POST | 总 credits + CreditGroups |
| `/billing/meter/get-user-resource-free-packages` | POST | 需 `PackageCodes` + `pageNumber` + `pageSize`，否则 400 |
| `/v2/user/cloudagent/quota` | GET | 并发智能体额度（agentLimit / used） |

实测快照（体验版/未付费）：总剩余 1354.59 credits；套餐基础积分 500 已用尽；
剩余全来自「平台奖励积分」，按月周期重置（约每月 12 日）。

### 3.3 三类限制并存（积分池之外的独立闸门）

| 机制 | 错误码 | 能否提前查 | 解法 |
|---|---|---|---|
| 共享积分池 | 6003 | ✅ 能（3.2 的接口） | 充值 / 切 0.00x 免费模型 |
| 频率/用量限制 | 6004 / 6005 | ❌ **不能** | 等重置 / 切模型 / 花积分 / 升级 |
| 容量队列 | `capacityQueueBlock` | ❌ | 等待 / 取消 / 切换 / 升级插队 |

**6004 机制**（逆向自 app.asar）：免费模型 = "免费用量"上限。触发时响应带 `Retry-After` 头，
客户端 `parseRetryAfterToMills` 动态计算重置时间。i18n 文案
（`error.rateLimitCap.freeTitle`，zh）：

> 当前您在{model}模型的免费使用量已超出频率限制，可在{time} 重置可用。您可切换其他模型或消耗积分继续使用该模型

相关变体：`nonFreeTitle` / `freeTitleNoModel` / `nonFreeTitleNoModel`；
CTA：`error.rateLimitCap.usePaid`（消耗积分继续用）、`switchAuto`（切 Auto）。
横幅相关 class：`cr-widget-error-message`、`cr-status-error`、`cr-system-notice`、
`cr-input-notification-banner--error`。

**能否预知**：不能。客户端无计数器（`freeQuota` / `freeLimit` / `limitPer` 等字段
count=0），模型配置接口（`/config/models`、`/v2/enterprises/personal/models`）跨域
取不到且不含限额数值。服务端按请求实时判定——**只有真撞了才能从那次响应拿到重置时间**。

## 4. 自动切换架构：反应式，不是计划式

### 4.1 为什么不用 WorkBuddy 定时任务/automation

WorkBuddy 的定时任务按计划跑**独立的 agent 轮次**：既不能在对话中途实时反应，
也无法预知限流。它在这套设计里只配当**看门者**——负责把页面内监听器装回去
（页面重载/重登/重启后监听器会丢），即 `schtasks /SC ONLOGON` 跑 `autoswitch.js watch`。

### 4.2 分层设计

```
┌─ Windows 计划任务（看门者，可选）──────────────┐
│  登录时拉起 autoswitch.js watch（常驻进程）      │
│    · 每 5s 检查 window.__wbAutoSwitch 是否还在  │
│    · WS 断线自动重连后重装（页面重载自愈）        │
└──────────────┬────────────────────────────┘
               │ CDP 注入
┌──────────────▼────────────────────────────┐
│  页面内 MutationObserver（反应式核心）        │
│    · 监听 document.body childList+subtree   │
│    · v2 检测器判定真实 6004 横幅（见第 5 节）  │
│    · doSwitch: 打开选择器 → 找回落项 → 点击   │
│    · 冷却 15s；只切模型、不自动重发失败轮次    │
└───────────────────────────────────────────┘
```

### 4.3 切换执行细节

- 回落顺序 `WB_FALLBACKS` 依次找**不等于当前模型**的第一个可用项（下拉项按
  `.cr-model-selector__item-name` 文本精确匹配，大小写不敏感）。
- 下拉项只在展开后才存在于 DOM → 先 `trigger.click()` 展开，400ms 后查找，点击后
  700ms 回读确认。
- 只切模型、**不自动重发**失败那轮（避免误触发送）；用户点"继续/重发"时用的已是新模型。

## 5. v2 检测器设计

### 5.1 设计目标

**必须能区分"真实错误横幅"和"聊到这个错误的文本"**——这是 v1 事故的直接教训。

### 5.2 五条规则（全部满足才触发）

1. **文本 < 300 字**：横幅是一行话；长篇大论不是。
2. **含 `6004` 或命中 i18n 强特征短语**：`超出频率限制` / `exceeded the rate limit` /
   `重置可用` / `can reset at` / `切换其他模型` / `switch models`。
3. **不在对话子树里**：`.cr-markdown`（回复正文/表格/代码）、`.cr-reasoning` /
   `.cr-collapse`（深度思考）、`.monaco-editor`（artifact 面板）、
   `[class*="artifact"]`、`[class*="detail-panel"]`、`[class*="sidebar"]`、
   `.cr-session`、`textarea`、`[contenteditable]`、`.cr-composer`、`.cr-input`——
   我们自己的对话文本全住这些区域。
4. **必须挂在 error/notice/banner 类挂件里**（正向结构信号）：
   `[class*="error"],[class*="notice"],[class*="banner"],[class*="alert"],
   [class*="toast"],[class*="notification"],[class*="widget"]`。
   真实横幅 class 如 `cr-widget-error-message`（已从 asar 证实存在）。
5. **横幅点名的模型仍是当前模型**：横幅文案里带模型名（"当前您在 X 模型…" /
   "usage of X"），若当前模型已不是 X（说明已切走），忽略——防止横幅重渲染造成
   反复触发的"打摆子"。

### 5.3 权衡（有意为之）

若真实横幅的 class 链不含 error/notice/banner 等字样，v2 保持沉默
（不自动切，用户手动切），**而不是**再犯"乱切"的错。宁漏勿误。
客户端升级后先用 `node autoswitch.js test` 验证回归测试，再按需放宽第 4 条。

### 5.4 回归测试（`node autoswitch.js test`）

- 注入**逼真**假横幅（真实 i18n 文案 + `cr-widget-error-message` class + body 级挂载）
  → **必须命中**（dry-run，不真切）。
- 注入两条含同样关键词但放在 `.cr-markdown` 里的聊天文本 → **必须 0 误报**。
- 判定输出 `VERDICT: PASS`。
- 额外的活体证据：arm 后静默观察，推理流式输出大量 6004 相关文本，`fires` 应恒为 0。

## 6. 事故复盘：v1 检测器为何乱切模型（2026-10-19）

### 6.1 现象

用户报告"当前 session 莫名其妙自己切模型"。排查进程列表：**无任何后台进程**。
页面状态显示 `fires=9`——一天内监听器误触发 9 次，模型在 Hy3 ↔ GLM-5.3-Flash
之间打摆子，**没有一次是真撞了 6004**。

### 6.2 病根

v1 检测规则 = "新增 DOM 文本含 `6004` + 频率/重置等字样即切"。但该会话**全程在讨论
6004 错误本身**——回复、对比表格、深度思考里的代码块、侧边栏会话摘要，满是这些词。
页面每次重新渲染/流式输出（包括 agent 自己的推理文本），MutationObserver 都看到
"新增了含 6004 的节点" → 误触发。**检测器把自己的对话内容当成了错误横幅。**

### 6.3 处置过程中的关键认知

1. **`delete window.__wbAutoSwitch` 停不掉已注入的 observer**。observer 与其回调
   都在闭包里，外部只持有 `window.__wbAutoSwitch` 句柄；删句柄后监听器继续跑。
   真停只有两条路：屏蔽其执行路径，或刷新页面。
2. **实例级 `.click()` 覆盖是完美的止血术**：`trigger.click = () => {}` 拦掉的是
   **程序化** JS 调用；真人鼠标点击走原生事件分发（不经过 JS 的 click 方法），
   完全不受影响。即"机器人点不动，人照样点得动"。
3. **安全刷新必须是空闲感知的**：渲染进程刷新会杀掉进行中的对话轮次。
   `reload_page.js` 等到无 `.cr-agent--processing` 且**连续两次**检查空闲才刷
   （防单次检测的闪烁误判），绝不打断对话。
4. **清理脚本绝不启发式扫描聊天文本**：事故当日 v1 清理脚本用"隐藏 + 含 6004"
   启发式找假横幅，结果把折叠的深度思考区里 19 个对话节点当假横幅删了。
   修复版只删带 `[data-test="fake-6004"]` 标记的节点。

### 6.4 沉淀

- v2 检测器（第 5 节）+ 回归测试内置于 `autoswitch.js test`。
- `neuter_switch.js`（止血）、`reload_page.js`（清场）、`cleanup_fake6004.js`
  （安全清理）三个工具从事故中诞生，进入常规工具链。

## 7. 已知限制

- **类名耦合**：`.cr-model-selector__*` 与检测器的 class 特征随客户端升级可能变化，
  用 `probe.js` 重新探测。
- **检测器保守**：可能漏掉结构异常的真实横幅（设计取舍，见 5.3）。
- **只切模型不重发**：失败那轮需要用户手动"继续/重发"。
- **watch 模式跨页面重载**：已实现断线重连；但 WorkBuddy 完全退出后需重新拉起
  （计划任务 ONLOGON 只覆盖登录时机）。
- **调试端口安全**：9222 端口本机任意进程可连，用完建议关（正常退出后不带端口重启）。
