# smart-switch-model

> WorkBuddy 当前窗口模型切换 + 6004 频率限制自动切换工具集。
> 通过 Chrome DevTools Protocol（CDP）驱动**真实的模型选择器 UI**，等价于手动点击——真正改变当前窗口模型，且持久化不被回写覆盖。

> 适用环境：WorkBuddy 5.5.3（Electron 37 / Chromium 138）/ Windows。
> 若客户端升级改了 UI 类名，用 `scripts/cdp/probe.js` 重新探测即可（见 [排障](#排障)）。

---

## 这是什么 / 为什么

WorkBuddy 桌面端有几个"看似可行实则不行"的切模型路子（均已实测证伪，详见 [技术文档](docs/TECHNICAL-NOTES.md)）：

| 方法 | 结果 |
|---|---|
| 直写 `workbuddy.db` 的 `sessions.model` | ❌ db 只是下游镜像，下一条消息发出去就被 UI 回写覆盖 |
| Windows UI Automation（UIA） | ❌ Electron 网页内容默认不向 UIA 暴露控件 |
| **CDP 点击真实模型选择器（本仓库）** | ✅ UI 标签 + 持久化双层验证通过 |

在此基础上，还内置了一套**反应式自动切换**：当撞上 6004 频率限制横幅时，页面内监听器第一时间自动切到回落模型，不用手动点。以及配套的止血/刷新/清理工具（都来自一次真实的"误切模型"事故，见[技术文档第 6 节](docs/TECHNICAL-NOTES.md#6-事故复盘v1-检测器为何乱切模型)）。

## 功能一览

- **手动切模型**：`switch.js <模型名>`，内置别名（`hy3`、`step-5-preview`、`fast`、`balanced`、`ultra`…），也接受下拉框显示名
- **列出模型与费率**：`list_models.js`，直接从真实下拉框读取当前全部模型 + 消费倍率（x）
- **6004 自动切换**：`autoswitch.js`（test / arm / watch 三模式，v2 检测器，带回归测试）
- **配套工具**：`neuter_switch.js`（止血）、`reload_page.js`（安全刷新）、`cleanup_fake6004.js`（清理测试残留）
- **积分余额查询（附赠）**：`query_quota.js`，同源 fetch 查询 credits / 奖励包 / 并发智能体

## 环境要求（一次性）

CDP 需要渲染进程暴露调试端口。**单实例锁**会让第二次启动只激活旧实例（无调试端口），所以必须：

```powershell
# 1) 完全退出 WorkBuddy（任务管理器结束 WorkBuddy.exe）
# 2) 带调试端口启动
& "C:\Program Files\WorkBuddy\WorkBuddy.exe" --remote-debugging-port=9222
```

```bash
# 验证端口（注意用 localhost，127.0.0.1 会被 Chrome 返回 403）
curl -s http://localhost:9222/json/version
```

Node ≥ 22（自带全局 `WebSocket`，无需装任何包）。本仓库脚本默认用
`C:/Users/adminlocal/.workbuddy/binaries/node/versions/22.22.2-2/node.exe`，换成你机器上的 node 即可。

## 快速开始

```bash
cd scripts/cdp

# 列出当前下拉框所有模型 + 费率
node list_models.js

# 切换当前窗口模型
node switch.js step-5-preview     # 或 hy3 / fast / balanced / ultra / 直接写显示名

# 6004 自动切换：先跑回归测试（dry-run，不真切）
node autoswitch.js test
# 注入到当前页，真实模式，立即生效（页面刷新后失效）
node autoswitch.js arm
# 常驻看门：每 5s 自愈重装 + WebSocket 断线自动重连
node autoswitch.js watch
```

### 查状态 / 拆除

在 WorkBuddy 页面上下文（DevTools Console 或 CDP evaluate）：

```js
window.__wbAutoSwitch.status()   // { armed, detector, current, fallbacks, dryRun, fires, lastEvent }
delete window.__wbAutoSwitch     // 摘除句柄（注意：停不掉已注入的 observer，见下）
```

**要彻底停掉已经 arm 的监听器**：`delete` 只删句柄，停不了闭包里的 MutationObserver。
两条真路：`node neuter_switch.js`（屏蔽程序化点击，真人鼠标不受影响）或刷新页面（`node reload_page.js` / 重启 WorkBuddy）。

### 配套工具

| 脚本 | 用途 |
|---|---|
| `neuter_switch.js` | **止血**：屏蔽模型选择器上的程序化 `.click()`（脚本驱动的点击被拦），真人鼠标点击不受影响（原生事件分发不经过 JS 的 click 方法）。页面刷新后自动失效。 |
| `reload_page.js` | **安全刷新**：清掉关不掉的僵尸监听器。默认 90s 后、且**连续两次检测到空闲**（无进行中的对话）才刷，绝不打断对话；刷新同时会把被误删的 DOM 从持久化状态重建。延迟可用 `WB_RELOAD_DELAY_MS` 调。 |
| `cleanup_fake6004.js` | 清理 `test` 模式残留的假横幅。**只删带 `[data-test="fake-6004"]` 标记的节点**，绝不启发式扫描聊天文本。 |

### 附赠：积分余额查询

```bash
node query_quota.js   # 需调试端口；通过 workbuddy.cn 同源 iframe fetch，自动带鉴权
```

可查：总 credits、CreditGroups、奖励包明细、并发智能体额度。**频率限制（6004）不可提前查询**——服务端按请求实时判定，客户端无计数器；只有真撞了才能从那次响应的 `Retry-After` 拿到重置时间。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `WB_FALLBACKS` | `Hy3,GLM-5.3-Flash,Step-5-Preview` | 自动切换的回落顺序（自动跳过当前模型） |
| `WB_COOLDOWN_MS` | `15000` | 两次自动切换的最小间隔 |
| `WB_RELOAD_DELAY_MS` | `90000` | 安全刷新的首次检查延迟 |

示例：

```bash
WB_FALLBACKS="Hy3,Step-5-Preview" WB_COOLDOWN_MS=30000 node autoswitch.js watch
```

## 开机自启看门（可选）

监听器在页面重载/重登后会丢，用 Windows 计划任务在登录时把 `watch` 模式拉起来（自愈重装 + 断线重连）：

```
schtasks /Create /TN "WorkBuddy AutoModelSwitch" /SC ONLOGON /F /TR "\"<node.exe 路径>\" \"<本仓库>/scripts/cdp/autoswitch.js\" watch"
```

> 前提：WorkBuddy 仍须以 `--remote-debugging-port=9222` 启动，否则 watch 连不上。

## 排障

- **`no page target` / 连不上**：WorkBuddy 没带调试端口启动，或重启后 page id 变了——脚本每次动态从 `http://localhost:9222/json` 取目标，一般无需手工干预。
- **切了没反应 / 类名失效**：客户端升级改了 DOM 结构。跑 `node probe.js` / `node open_dropdown.js` 重新探测类名，改脚本里的 `.cr-model-selector__*` 选择器。
- **自动切换不触发**：v2 检测器是保守设计（宁可漏、不可乱切）。跑 `node autoswitch.js test` 看回归测试是否 PASS；若真实横幅命中不了，放宽 `isRateLimitBanner` 里的 class 匹配（见技术文档 v2 设计）。
- **模型自己乱跳**：看 `window.__wbAutoSwitch.status().fires` 与 `lastEvent`。若在涨且没有真实横幅，说明检测器误报——立即 `node neuter_switch.js` 止血，然后 `node reload_page.js` 清场。

## 安全提示

- `--remote-debugging-port=9222` 会暴露本地渲染进程，**本机任何进程都能连**。实验完建议正常退出并以不带调试端口的方式重启 WorkBuddy。
- 所有脚本只点 UI / 只读查询，不改 WorkBuddy 数据库；切换可逆（再点一次即可）。

## 文档

- [技术文档 TECHNICAL-NOTES.md](docs/TECHNICAL-NOTES.md)：CDP 原理、DOM 结构与逆向发现、费率/配额/错误码机制、自动切换架构、v2 检测器设计、事故复盘
- [SKILL.md](SKILL.md)：WorkBuddy Agent Skill 格式的操作手册（可直接放进 `~/.workbuddy/skills/switch-model/`）

## 目录结构

```
smart-switch-model/
├── README.md                # 本文件（使用说明）
├── SKILL.md                 # WorkBuddy Skill 格式文档
├── docs/
│   └── TECHNICAL-NOTES.md   # 技术文档（逆向结论 + 架构 + 事故复盘）
└── scripts/cdp/
    ├── cdp.js               # 最小 CDP 客户端（connect/send/evaluate）
    ├── switch.js            # 手动切模型
    ├── list_models.js       # 列出模型与费率
    ├── autoswitch.js        # 6004 自动切换（v2 检测器；test/arm/watch）
    ├── neuter_switch.js     # 止血：屏蔽程序化点击
    ├── reload_page.js       # 安全刷新（空闲感知）
    ├── cleanup_fake6004.js  # 清理测试假横幅（仅删标记节点）
    ├── query_quota.js       # 积分余额查询（附赠）
    ├── probe.js             # DOM 结构探测（客户端升级后用）
    └── open_dropdown.js     # 打开下拉框并 dump 选项（探测用）
```
