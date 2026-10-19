# smart-switch-model

**让 WorkBuddy 桌面端听懂“换个模型”这句话**——通过 Chrome DevTools Protocol 驱动真实的模型选择器 UI，把当前窗口切换到指定模型；并在撞上 6004 频率限制时，自动切换到回落模型，全程不打断你的对话。

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
| 经常撞 6004，想全自动 | `node autoswitch.js arm` | 撞频率限制自动切到回落模型，对话不中断 |
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

## 获得什么

- **省时间**：切模型从“点开下拉、翻 21 项、找免费”变成一条命令；Agent 模式下就是一句话。
- **不中断**：真撞 6004 时自动切到回落模型（默认 Hy3 → GLM-5.3-Flash → Step-5-Preview），失败那轮点“继续”即可，不用手动救火。
- **可预期**：随时查看模型费率快照与积分余额，额度规划从盲猜变成明账。
- **可复用/可迁移**：纯 Node 脚本 + CDP，无任何第三方依赖；SKILL.md 是 Anthropic Skills 兼容格式，可被任何支持 Skills 的 LLM 工具直接加载使用。
- **踩过的坑都写下来了**：包括一次把“聊到 6004 的文本”误判成错误横幅导致一天误切 9 次模型的事故，检测器已重写并内置回归测试——你不必再踩一遍。

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
    ├── autoswitch.js         #   6004 自动切换（含回归测试）
    ├── neuter_switch.js      #   止血：拦停异常切换
    ├── reload_page.js        #   安全刷新：清理僵尸监听器
    ├── cleanup_fake6004.js   #   清理测试残留
    ├── query_quota.js        #   积分余额查询
    └── probe.js / open_dropdown.js   # DOM 探测（客户端升级后用）
```

## 安全提示

调试端口会暴露本地渲染进程（本机任意进程可连），用完建议以不带端口的方式重启 WorkBuddy。所有脚本只操作 UI / 只读查询，不改 WorkBuddy 数据库，切换可逆。
