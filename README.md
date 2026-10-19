# smart-switch-model

**让 WorkBuddy 桌面端听懂“换个模型”这句话**——通过 Chrome DevTools Protocol 驱动真实的模型选择器 UI，把当前窗口切换到指定模型；并在撞上 6004 频率限制时，自动切换到回落模型、自动续跑，全程不打断你的对话。

> 适用环境：WorkBuddy 5.5.3+（Electron / Chromium）/ Windows / Node 22+

---

## 这是什么

一套开箱即用的脚本工具集 + 一份给 AI Agent 看的技能手册（SKILL.md）。它解决两件事：

1. **切换当前窗口的模型**：一条命令，把 WorkBuddy 当前会话切到任意可用模型（Hy3、Step-5-Preview、GLM-5.3-Flash…21 个模型任选），切换真实生效且持久化。
2. **6004 频率限制自动兜底**：免费模型撞频率限制（错误码 6004）时，页面内的监听器自动切到回落模型，你什么都不用点。

它同时是一份 **Anthropic Skills 兼容格式的技能包**——把 `SKILL.md` 放进任何支持 Agent Skills 的 AI 工具（WorkBuddy、Claude 等），模型就能自己读懂并执行整套流程。

## 背景：为什么需要它

WorkBuddy 的免费额度模型（0.00x 的 Hy3、Step-5-Preview）用得好好的，但有两个现实痛点：

- **切模型要点好几下**：模型选择器在输入框旁，每次遇到额度/频率问题都要手动翻 21 个模型的下拉框，找哪个免费、哪个便宜。
- **撞了 6004 才知道**：频率限制（6004）**无法提前查询**，服务端按请求实时判定，撞上时对话直接中断，只能手动切模型重来。而“还剩多少积分”倒是能查，但本地数据库里没有，要走服务端接口。

调研中我们还实测证伪了两条看似合理的路：**直写本地数据库**（会被 UI 回写覆盖）、**Windows UI 自动化**（Electron 不暴露网页控件）。最终确认唯一可靠的路是 **CDP 驱动真实 UI**——等价于用户亲手点，因此真正生效、不被覆盖。整套方案连同一次“误切模型”事故的复盘，都记录在 [技术文档](docs/TECHNICAL-NOTES.md) 里。

## 用途：能用来干什么

| 场景 | 动作 | 效果 |
|---|---|---|
| 积分快见底了 | `node switch.js hy3` | 一键切到 0.00x 免费模型，不烧积分继续用 |
| 挑花眼，不知道哪个模型便宜 | `node list_models.js` | 列出全部 21 个模型及实时费率（0.00x ~ 1.62x） |
| 经常撞 6004，想全自动 | `node autoswitch.js arm` | 撞频率限制自动切到回落模型并自动续跑，对话不中断 |
| 想随时知道余额 | `node query_quota.js` | 查总 credits / 奖励包 / 并发智能体额度 |
| 让 AI Agent 替你管模型 | 安装 `SKILL.md` | Agent 自动完成上述所有操作 |

## 怎么操作

**第一步：给 WorkBuddy 开调试端口**（一次性，需先完全退出再启动）：

```powershell
& "C:\Program Files\WorkBuddy\WorkBuddy.exe" --remote-debugging-port=9222
```

**第二步：跑命令**（脚本目录下，Node 22+，零依赖）：

```bash
cd scripts/cdp
node switch.js step-5-preview    # 切到 Step-5-Preview
node list_models.js              # 看所有模型和费率
node autoswitch.js test          # 先自检自动切换（dry-run，不真切）
node autoswitch.js arm           # 开启 6004 自动切换
```

**第三步（可选）：让 AI 接管。** 把 `SKILL.md` 放入技能的 skills 目录（如 `~/.workbuddy/skills/smart-switch-model/`），之后直接对 Agent 说“切到 Hy3”“查一下余额”“开启自动切换”即可。

详细参数、回落顺序配置、开机自启、排障，见 **[SKILL.md](SKILL.md)**（操作手册）；逆向细节与踩坑，见 **[技术文档](docs/TECHNICAL-NOTES.md)**。

## 实战场景：Agent 撞了 6004，自动切模型接着跑

**场景**：你在某个 session 里让 Agent 跑一个长任务，跑到一半，当前模型撞上频率限制（6004），Agent 停下报错。此时页面里的监听器**自动**把窗口切到回落模型，并**自动**发一句"继续"——Agent 就用新模型从断点接着跑。你全程无感：不用手动翻模型下拉框、不用研究哪个模型还有免费额度、甚至不用知道刚刚发生过 6004。

> **监听器的作用范围**：监听器注入在**当前 WorkBuddy 窗口**的页面里（MutationObserver 挂整个 `document.body`），对**该窗口内的所有 session / 所有任务类型**生效——不管哪个会话弹 6004 横幅，都会自动切模型并续跑。它与"哪个 session、跑什么任务"无关。注意它是**按窗口**生效的：如果同时开多个 WorkBuddy 窗口，需要给每个窗口分别 `arm`。

### 全流程时序

```
① 开启监听（arm/watch）      ② 在 session 里发任务，Agent 开跑
        │                              │
        │                   ③ 撞 6004：Agent 停下，界面出现限流横幅
        │                              │
        │                 ④ 监听器秒级自动切换模型（如 → Hy3）
        │                              │
        └──────────────┐   ┌───────────┘
                       ▼   ▼
        ⑤ 监听器自动发"继续" ──► ⑥ Agent 用新模型接着跑完
```

### 操作步骤（每步附预期输出）

**Step 0 · 一次性前置**：WorkBuddy 带调试端口启动（见上文），确认 `curl -s http://localhost:9222/json/version` 有返回。

**Step 1 · 开启监听**：

```bash
cd scripts/cdp
node autoswitch.js test     # 先自检，必须看到 VERDICT: PASS（dry-run，不真切）
node autoswitch.js arm      # 注入监听器，真实模式，立即生效
```

预期输出：

```
arm: armed  fallbacks=Hy3 > GLM-5.3-Flash > Step-5-Preview  resume="继续"
listening for 6004 banners + resume requests... (Ctrl+C to stop)
```

`arm` 现在是**常驻进程**（前台运行，Ctrl+C 停止）：它既要往页面里注入监听器，也要在 6004 发生时亲自完成"输入继续 + 点发送"（原因见下文"关键设计点"）。想让它在页面刷新/重登后也不丢，同样用它自带的看门逻辑（每 5s 自愈重装 + 断线重连）；要开机自启，用计划任务拉 `watch` 模式。

**Step 2 · 正常跑 Agent**：在该 session 里发你的任务，Agent 开始跑。这一步你无需任何操作。

**Step 3 · 撞 6004**：跑到某个时刻，模型触发频率限制，界面出现限流横幅（形如“当前您在 X 模型的免费使用量已超出频率限制，可在 … 重置可用。您可切换其他模型或消耗积分继续使用该模型”），Agent 本轮就此停下。

**Step 4 · 监听自动切换**：横幅出现的同一时刻，页面里的 MutationObserver 命中检测器，自动完成：打开模型选择器 → 按回落顺序选第一个可用模型 → 点击。全程约 1 秒，你基本无感知。

切换过程随时可查（页面 DevTools Console，或让我查）：

```js
window.__wbAutoSwitch.status()
// {"armed":true,"detector":"v2","current":"Hy3","fallbacks":["Hy3","GLM-5.3-Flash","Step-5-Preview"],
//  "dryRun":false,"fires":1,
//  "lastEvent":{"reason":"6004","before":"Step-5-Preview","after":"Hy3","at":"2026-10-19T..."}}
```

`fires` 每自动切一次 +1，`lastEvent` 记录最近一次的 before → after。

**Step 5 · 自动续跑（无需操作）**：切换成功、且刚才确实有一轮 Agent 任务被 6004 打断（90 秒内有过运行中的任务、现已停下），监听器会自动完成：把"继续"输入聊天框（走 CDP 可信输入管道，Slate 编辑器真实落字）→ 等发送键就绪 → 点击发送 → 确认新轮次启动。这一轮由**新模型**接手，从断点继续把任务跑完。

续跑过程随时可查（跑 `autoswitch.js` 的终端会打印，页面里也可查）：

```js
window.__wbAutoSwitch.status()
// {"armed":true,"detector":"v2","current":"Hy3","fallbacks":["Hy3","GLM-5.3-Flash","Step-5-Preview"],
//  "dryRun":false,"resume":true,"resumeText":"继续","fires":1,
//  "lastEvent":{"reason":"6004","before":"Step-5-Preview","after":"Hy3","resumeRequested":true,"resumed":"resumed","at":"..."}}
```

`fires` 每自动切一次 +1，`lastEvent` 记录最近一次的 before → after；`resumed` 为续跑结果（`resumed` = 已确认新轮次启动；`clicked-unconfirmed` = 已点发送但未确认；其他值为失败原因）。

**Step 6 · 收尾（可选）**：任务跑完后想关掉监听：

```bash
# 页面里执行（或让我执行）
delete window.__wbAutoSwitch
```

注意：这只摘除句柄，**停不了已经注入的监听器**——要彻底停用，跑 `node neuter_switch.js` 止血，或直接刷新页面（`node reload_page.js`）。长期不用，建议以不带调试端口的方式重启 WorkBuddy，一切恢复原状。

### 关键设计点（为什么流程是这样）

- **为什么能零操作切换**：监听器在页面内反应式等待横幅出现，不是定时轮询，所以是秒级；WorkBuddy 自带的定时任务/自动化干不了实时反应，只能当"看门者"（刷新后重装监听器）。
- **为什么"继续"由 Node 侧发，而不是页面内发**：聊天输入框是 **Slate 编辑器**。实测（2026-10-19）：页内所有合成编辑事件（`beforeinput` insertText、`paste` 剪贴板事件、甚至先可信 click 再派发）都会被消费（preventDefault）但**永不落字**；`execCommand('insertText')` 更是绕过 Slate 模型直接改 DOM——那样点发送会发出**空消息**。唯一可靠的是 CDP `Input.insertText`（浏览器可信输入管道）。所以分工：**切换在页面内做（点击没问题），打字必须由 `autoswitch.js` 进程经 CDP 完成**——这也是 `arm` 必须常驻的原因。
- **自动续跑的安全闸**：三道。① 只在"切换成功 + 90 秒内确有任务在跑且现已停下"时才续跑，不会平白发起新轮次；② 打字后**必须验证文字真的落进了输入框**，验证不过绝不点发送（绝不发送空消息）；③ 点击后确认新轮次真的启动，结果记入 `lastEvent.resumed`。
- **回落顺序**：默认 `Hy3 → GLM-5.3-Flash → Step-5-Preview`，自动跳过当前模型，选第一个可用的；用环境变量 `WB_FALLBACKS` 可自定义（比如把最便宜的放最前）。续跑文字可用 `WB_RESUME_TEXT` 改，自动续跑可用 `WB_RESUME=0` 关掉（回到"只切模型"）。
- **防打摆子**：如果横幅点名的是旧模型、而当前模型已经切走，监听器不会重复触发（检测器 v2 规则），不会出现"切过去又被自己的切换动作触发、来回横跳"。

## 获得什么

- **省时间**：切模型从“点开下拉、翻 21 项、找免费”变成一条命令；Agent 模式下就是一句话。
- **真·无感续跑**：撞 6004 时自动切到回落模型（默认 Hy3 → GLM-5.3-Flash → Step-5-Preview）并自动发“继续”，失败那轮由新模型从断点接手，你既不用手动救火、也不用知道这事发生过。
- **可预期**：随时查看模型费率快照与积分余额，额度规划从盲猜变成明账。
- **可复用/可迁移**：纯 Node 脚本 + CDP，无任何第三方依赖；SKILL.md 是 Anthropic Skills 兼容格式，可被任何支持 Skills 的 LLM 工具直接加载使用。
- **踩过的坑都写下来了**：包括一次把“聊到 6004 的文本”误判成错误横幅导致一天误切 9 次模型的事故，检测器已重写并内置回归测试；以及 Slate 输入框“合成事件不落字”的完整实测——你不必再踩一遍。

## 目录结构

```
smart-switch-model/
├── README.md                 # 本文件：是什么 / 背景 / 用途 / 操作 / 收益
├── SKILL.md                  # Agent Skills 兼容技能手册（给 LLM 用）
├── docs/
│   └── TECHNICAL-NOTES.md    # 技术文档：方案细节、逆向发现、踩坑记录
└── scripts/cdp/              # 全部脚本（Node 22+，零依赖）
    ├── cdp.js                #   最小 CDP 客户端
    ├── switch.js             #   切换模型
    ├── list_models.js        #   模型 + 费率列表
    ├── autoswitch.js         #   6004 自动切换 + 自动续跑（含回归测试）
    ├── neuter_switch.js      #   止血：拦停异常切换
    ├── reload_page.js        #   安全刷新：清理僵尸监听器
    ├── cleanup_fake6004.js   #   清理测试残留
    ├── query_quota.js        #   积分余额查询
    └── probe.js / open_dropdown.js / probe_composer.js   # DOM 探测（客户端升级后用）
```

## 安全提示

调试端口会暴露本地渲染进程（本机任意进程可连），用完建议以不带端口的方式重启 WorkBuddy。所有脚本只操作 UI / 只读查询，不改 WorkBuddy 数据库，切换可逆。
