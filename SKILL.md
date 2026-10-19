---
name: smart-switch-model
description: 切换 WorkBuddy 桌面端当前窗口（当前会话）的运行模型，并可在撞上 6004 频率限制时自动切换到回落模型。通过 Chrome DevTools Protocol（CDP）驱动真实的模型选择器 UI，等价于用户手动点击——会真正改变当前窗口模型并持久化（db 直写会被 UI 回写覆盖，UIA 在 Electron 上不可靠，均已证伪）。当用户要求"换个模型/切到某个模型/当前是什么模型/有哪些模型和费率/查积分余额/开启模型自动切换"时使用本技能。
---

# smart-switch-model — WorkBuddy 模型切换与 6004 自动切换

## 概述

用 CDP 操控 WorkBuddy 真实模型选择器。两条能力：

1. **切换/查询当前窗口模型**：`scripts/cdp/switch.js`、`list_models.js`
2. **6004 频率限制自动切换**：`scripts/cdp/autoswitch.js`（页面内 MutationObserver，反应式）

附带事故处置工具（`neuter_switch.js`、`reload_page.js`、`cleanup_fake6004.js`）和积分查询（`query_quota.js`）。
方案细节、逆向发现与踩坑记录见 `docs/TECHNICAL-NOTES.md`，本文件只讲怎么用。

## 何时使用 / 不使用

**使用**：用户要求换模型、切回某模型、问当前模型、列模型/费率、查积分余额、开启或关闭自动切换、排查"模型自己乱跳"。
**不使用**：用户只是闲聊模型话题；或环境不满足前置条件（见下）且用户不愿重启 WorkBuddy。

## 前置条件（每次操作前先确认）

1. WorkBuddy 以 `--remote-debugging-port=9222` 启动。单实例锁导致必须**先完全退出再带端口启动**：
   `& "C:\Program Files\WorkBuddy\WorkBuddy.exe" --remote-debugging-port=9222`
2. 验证：`curl -s http://localhost:9222/json/version`（必须用 `localhost`，`127.0.0.1` 会 403）。
3. Node ≥ 22（自带全局 WebSocket，脚本零依赖）。在 `scripts/cdp/` 目录下执行。

## 快速参考

| 任务 | 命令 | 预期输出 |
|---|---|---|
| 切换模型 | `node switch.js <目标>` | `{"before":"...","target":"...","after":"...","switched":true}` |
| 列模型+费率 | `node list_models.js` | 全部模型名 + 倍率（0.00x ~ 1.62x） |
| 查积分余额 | `node query_quota.js` | 总 credits / 奖励包 / 并发智能体 |
| 自动切换自检 | `node autoswitch.js test` | `VERDICT: PASS`（dry-run，不真切） |
| 开启自动切换 | `node autoswitch.js arm` | `arm: armed`（真实模式，刷新页面后失效） |
| 常驻看门 | `node autoswitch.js watch` | 每 5s 自愈重装 + 断线重连 |
| 查监听器状态 | 页面内 `window.__wbAutoSwitch.status()` | `{armed, detector, current, fires, lastEvent, ...}` |

## 操作流程

### A. 切换当前窗口模型

1. 先 `node list_models.js` 确认目标模型存在（拿显示名，如 `Step-5-Preview`）。
2. `node switch.js <目标>`。内置别名：`hy3`、`step-5-preview`、`hy4`、`fast`、`balanced`、`ultra`；也可直接传下拉框显示名。
3. 校验输出里 `switched:true` 且 `after` 等于目标；若 `after` 未变，执行"排障"。
4. 告诉用户：下一条消息即由新模型接手。

### B. 开启 6004 自动切换

1. 先 `node autoswitch.js test` 跑回归测试（必须 `VERDICT: PASS` 再往下）。
2. `node autoswitch.js arm` 注入监听器（真实模式）。
3. 可选：`node autoswitch.js watch` 常驻（页面刷新/重登后自动重装）；或建开机计划任务：
   `schtasks /Create /TN "WorkBuddy AutoModelSwitch" /SC ONLOGON /F /TR "\"<node.exe>\" \"<repo>/scripts/cdp/autoswitch.js\" watch"`
4. 行为说明：撞 6004 横幅 → 按 `WB_FALLBACKS`（默认 `Hy3,GLM-5.3-Flash,Step-5-Preview`，自动跳过当前模型）切到第一个可用项；冷却 15s；**只切模型、不自动重发**失败那轮。
5. 常用配置：`WB_FALLBACKS`、`WB_COOLDOWN_MS`（环境变量）。

### C. 查积分余额

`node query_quota.js`（需调试端口；经 workbuddy.cn 同源 iframe fetch 自动带鉴权）。
**注意：频率限制 6004 无法提前查询**，只有真撞了才能从那次响应的 `Retry-After` 拿到重置时间。

### D. 紧急处置：模型在自己乱跳

1. 页面内查 `window.__wbAutoSwitch.status()`：`fires` 在涨且无真实横幅 = 检测器误报。
2. 立即止血：`node neuter_switch.js`（屏蔽模型选择器上的程序化 click，真人鼠标点击不受影响）。
3. 清场：`node reload_page.js`（默认 90s 后、连续两次检测到空闲才刷新；清掉僵尸监听器、重建被误删的 DOM）。
4. 汇报 `fires`/`lastEvent` 给用户，勿在未确诊前反复 arm。

## 排障

| 症状 | 原因 | 处置 |
|---|---|---|
| `no page target` | 没开调试端口 / page id 变了 | 重启 WorkBuddy 带端口；脚本每次动态从 `/json` 取目标 |
| 切换无反应 / 类名失效 | 客户端升级改了 DOM | `node probe.js`、`node open_dropdown.js` 重新探测 `.cr-model-selector__*` 类名 |
| 自动切换不触发 | v2 检测器保守设计（宁漏勿误） | 先 `node autoswitch.js test`；仍不命中则按技术文档 v2 设计放宽 class 匹配 |
| `delete window.__wbAutoSwitch` 后还在切 | **删句柄停不了已注入的 observer**（闭包不可达） | 用 `neuter_switch.js` 止血或 `reload_page.js` 刷新 |
| watch 连不上 | WorkBuddy 没带端口启动 | 重启带 `--remote-debugging-port=9222` |

## 红线（勿做）

- ❌ 直写 `workbuddy.db` 的 `sessions.model`（会被回写覆盖，且用户明令禁止碰 db）。
- ❌ 用 UIA 操控（Electron 不可靠）。
- ❌ 用“隐藏 + 含 6004”之类启发式在页面里找假横幅（误删过 19 个对话节点）——只删 `[data-test="fake-6004"]` 标记节点。
- ❌ 未经用户确认切换模型或注入监听器；切换只点 UI、可逆。

## 安全

调试端口 9222 本机任意进程可连，实验完建议不带端口重启 WorkBuddy。所有脚本只操作 UI / 只读查询。
