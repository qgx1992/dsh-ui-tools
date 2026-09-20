# dsh-ui-tools

DSH Web 插件：六个 UI 工具合并成一个包，只动对应控件，不改 DSH 任何一行源码。

## 功能一：模型选择双按钮（原 dsh-model-select-style）

把输入框官方的「模型选择」控件替换为**两个独立按钮**，两级联动：

1. **「供应商」按钮** —— 点击弹出供应商列表（如 DeepSeek / SiliconFlow / OpenRouter）；
2. 选中某供应商后，「模型」按钮亮起；
3. **「模型」按钮** —— 点击只列出**当前所选供应商**的模型，点选即切换；
4. 模型支持推理时，模型按钮显示 `模型名 · 推理等级`（如 `deepseek-chat · 高`），面板内带「推理等级」区可调节思考强度。

选择逻辑完全复用官方组件（同一份模型目录、同一套选择提交、错误 Toast），只是把入口从单个按钮拆成两个。

## 功能二：侧边栏工作区折叠/展开（原 dsh-workspace-collapse）

在侧边栏**工作区列表下方**渲染「折叠全部 / 展开全部」工具条，一键折叠/展开所有工作区分组（纯 slot 渲染 + CSS 对齐，不搬动 DOM）。

## 功能三：会话主选项卡「修改的文件」（v0.2.0 新增；v0.3.1 起兼容 DSH 0.1.2-alpha.1；v0.4.2 起跨内核自适应）

> **内核要求**：需要 DSH `0.1.2-alpha.1+`。在 `0.1.1-rc.x` 上本功能**自动缺席**（不报错、不弹横幅），其余四个功能照常可用——见[内核兼容矩阵](#内核兼容矩阵)。

在会话头部主选项卡区（**对话 / 轨迹**之后）新增第三个选项卡 **「修改的文件」**，列出**当前会话改动过的所有文件**：

- 数据来自会话内容的 **chat target**（`ChatSnapshot.legacy` 的 `nodes` + `runningCalls`，即内核 target 体系下的 `assistant.blocks` 的 `tool-call` + `tool-result` 的 call 头 + 运行中的 `runningCalls`）；
- 只认会改动文件系统的工具（`edit` / `write` / `mkdir` / `delete` / `move` / `copy` / `rename` 等），从 `argsRaw` JSON 里提取路径并去重（统一分隔符 + 小写，兼容 Windows 大小写不敏感）；
- **run_code 支持（v0.4.3）**：当前 DSH agent 环境的所有工具调用都包在 `run_code` 里（工具名永远是 `run_code`、路径藏在 `code` 字符串中）。本功能从 `code` 里静态提取 `tools.edit/write/mkdir/move/copy/delete…` 内嵌调用的字面量路径（含字符串数组，如 `mkdir({ dirs: [...] })`），复用同一去重/徽标/打开链路。只认**字面量字符串路径**；模板串/变量拼接（`path + "/x"`）无法静态解析、shell 级写操作（pwsh 的 `Set-Content` / 重定向、gitbash 等）不可靠解析——这三类不计入；
- 按工作区相对路径展示，文件名 + 上级目录两行，右侧带操作徽标（编辑 / 写入 / 删除…，含次数）；
- **点击文件名经 Host 打开**该文件（复用官方 `workspaces.openPath` + `resolveWorkspacePath` 逻辑）；
- 空会话显示占位文案，加载中显示 loading。

**实现原理**：本功能注册进官方开放槽 **`conversation.view`** —— 这正是「轨迹」tab 的注册方式（`dsh-client-ui-trajectory` 插件用同样机制加 tab）。头部 tab 栏由该槽的 ledger 数据驱动渲染，点击切换 / 高亮 / 会话内持久化全部由框架处理，未知 view id 会自动回退到「对话」，**不需要改 DSH 任何一行源码**。我们的 tab 用 `order: 20`（对话=0、轨迹=10 之后），排在第三位。

## 功能四：会话标题旁工作区徽章（v0.3.0 新增）

在会话页头部**标题右侧**显示一个圆角徽章，标出当前会话所属工作区名（与侧边栏分组标题同名），一眼看出当前对话跑在哪个工作区：

- 数据：标准 kit 自带 `useWorkspaces`，从 `workspaces.items` 按 `sessionIds` 反查当前会话所属工作区，取 `title`；
- 未归入任何工作区（未分组 / 空白会话）时徽章不渲染，不占位；
- 徽章显示工作区显示名（改名后同步），`title`/`aria-label` 带可读文案。

**实现原理**：本功能注册进官方**纯增量 list 槽 `conversation.session.header.actions`**（session 作用域）——它是头部标题 cluster 内的动作行，位于面包屑标题右侧，正好是「标题旁」。list 槽是加性的（绝不替换标题、无占用冲突，当前该槽无其他插件占用），我们用负数 `order: -100` 让徽章排在其它交互动作之前、紧贴标题。纯 slot 渲染，不搬 DOM、不改源码。

## 功能五：插件设置页「DSH UI 工具」（v0.4.0 新增；v0.4.1 移除快捷命令条）

在官方**设置中心**新增一个「DSH UI 工具」页面，集中控制本包功能的偏好：

- **布局偏好**：工作区徽章开关、「修改的文件」紧凑单行显示、启动时默认折叠所有工作区分组；
- 偏好经 **localStorage** 持久化（`dsh-ui-tools:prefs:v1`），刷新/重启后保持；
- **能力感知（v0.4.2）**：功能三依赖的内核服务不可用时（`0.1.1-rc.x`），「修改的文件」那一行开关**灰显**并在标签下提示「需内核 0.1.2-alpha.1+」，不会出现一个点了没用的开关。可用性由 `alphaFeatures` 子 fiber 实际激活来置位（比在 apply 期一次性探测更可靠：官方 provider 可能比本插件晚激活）。

> 存储说明：官方 settings 命名空间需要 host 侧 `ctx.settings.register(ns, schema)` 声明 schema 才能持久化（参考 `ui-theme/src/index.ts`）；本插件刻意保持纯浏览器（`lib/index.js` 空入口、不引入 host 依赖与 schema 校验风险），故沿用浏览器插件社区惯例（同款 `dsh-better-sidebar`）的 localStorage。偏好仅当前浏览器生效；如需跨端/跨浏览器同步，可后续增加 host 半部迁移到 settings 文档。

**实现原理**：注册进官方 **`settings.section`**（root 作用域 list 槽），`id: "dsh-ui-tools"`、`order: 100`、`label` 走双语文案，设置导航自动出现该页。页面组件订阅同一个 localStorage 偏好仓库（`useSyncExternalStore`），所有开关写入即落盘；既有功能在 `apply()` 里注入同一偏好仓库：徽章/修改文件组件渲染时读开关，侧边栏折叠条在插件加载时按「默认折叠」偏好执行一次。

## 功能六：输出速度计 tok/s（v0.4.6 新增）

在**回合输出速度**上补一个常驻读数，两个位置：

- **回合结束后（精确值）**：在官方「**用时 xx秒**」pill **左侧**紧邻处显示 `⚡42 tok/s`，无需点开「本轮用时和速度」弹窗即可看到速度；
- **生成中（估算值）**：回合进行时在消息流末尾显示 `⚡≈ 25 tok/s 生成中估算`，每秒刷新。

数值口径（**精确值**）与内核「本轮用时和速度」弹窗里的 TPS **完全同源**：先按 `messageId` 定位回合，再折叠该回合全部已固化 assistant 节点，只累计**同时带 `timing.firstTokenTime` 与 `usage.outputTokens`** 的 step，按 `ΣoutputTokens ÷ Σ(completedTime − firstTokenTime)` 求值（对应内核 `deriveTurnMetrics` / `assistantStepReading`）；数据不足（无可计步、解码时长为 0）时**不显示**，绝不猜一个假值。

**为什么生成中只能给估算值**：内核在流式期间**不上报 token 数** —— `assistant/live-chunk` 里的 `usage` chunk 被 `publication: "none"` 抑制，不推给客户端。所以生成中按已输出字符折算（CJK 1 字符 ≈ 1 token，其余 4 字符 ≈ 1 token），并**始终带「≈」与「生成中估算」标注**，与精确值明确区分；回合一旦结束即让位给精确 pill，不重复显示。

**实现原理（不改源码的两条官方通道）**：

1. **精确 pill** 注册进官方 list 槽 **`conversation.chat.assistant-actions`**（session 作用域）。该槽的渲染位置就是 `MessageIconActions` 的 `extraActions` 位——**与官方「用时」pill 同一条动作条**，`order: -10` 使其排在官方 pill 之前（内核 list 槽按 `order` 升序渲染），即紧贴「用时」左侧。该槽当前亦被官方 `dsh-client-ui-message-feedback` 使用（`order: 10`），list 槽为加性，无占用冲突。节点数据经 `uiConversation.binding(sessionId).target("chat")` 读 chat target 快照（与官方 `useChat` 同源）。
2. **生成中估算条** 走官方 Definition 通道 `ctx.uiConversation.events.register(...)`（`ui-goal`、`ui-workflow-run` 同款机制）自建一个 `token-speed-live` chat 节点，并用 `ctx.slots.inject("conversation.chat.node")` 以该 kind 注册渲染器。**为什么不用 `conversation.chat.turnTail`**：该槽的数据源必须匹配到 `turn/end` 才产出节点（`tailData` 无 `turn/end` 即返回 `null`），生成期间根本不存在；`assistant-actions` 所在动作条同理。节点的排序锚点刻意取一个大于任何真实事件 seq 的常量，使其稳定落在本回合末尾（若锚在首个增量处会因 `anchorSeq` 比较跑到流式正文上方）。
3. Definition 通道是内核对等能力中较新的一个：形状不符时**只让生成中那段缺席**（`console.warn` 记录），绝不抛出——它与功能三同处一个子 fiber，抛错会让 `capability.alphaApi` 回滚、连「修改的文件」一起 FAIL。精确 pill 不依赖该通道。

**开关**：设置页「在「用时」旁显示输出速度计（tok/s）」，默认开；偏好字段 `tokenSpeedEnabled`（同一个 localStorage key）。旧内核上该开关与功能三一同灰显。

> **历史回合为什么可能没有读数**：`firstTokenTime` 来自流式增量（瞬态事件，不进持久化日志），因此**重新加载页面后看到的历史回合**通常缺该字段——此时精确值不可得，插件与内核「用时」弹窗**都不显示 TPS**（同一口径、同一结论）。在本回合刚跑完、未重载页面的情况下读数正常。

## 实现原理

- 官方模型组件照常注册在 `conversation.input.model`（数据/提交逻辑原样保留），用 CSS 隐藏官方触发按钮；
- 本插件通过 `modelDirectories` 服务读取同一份模型目录（groups = 供应商分组），注册到 `conversation.input.right`（list slot）追加双按钮；**v0.4.4**：该子作用域必须同时声明 `remote` **和** `remote.session`——内核对 `directoryFor()` 的实现会在**调用方**上下文里读 `this.ctx.remote.session`（cordis 的 Service tracker 会把 service 的 `this.ctx` 重绑到调用者），而 `remote.session` 是嵌套追踪服务，只声明 `remote` 仍会抛 `cannot get property "remote.session" without inject`；
- 选择模型/推理等级时调用官方 `directory.select(...)`，官方 store 同步更新，输入框状态与原生一致；
- 折叠条注册到 `sidebar.footer.action`——官方渲染位置就是 footer 顶部、紧贴工作区列表正下方，用 CSS（对齐 `--dsh-session-list-edge-inset` 内边距）贴合列表即可，**不搬动 DOM**。搬动 slot 渲染出来的节点会与框架重渲染互相触发，导致渲染进程 100% CPU 卡死（v0.1.0 全局观察器、v0.1.2 收窄观察器均因此卡死；v0.1.3 起彻底不搬）。
- 修改的文件 tab 注册进 `conversation.view`；节点数据经 `ctx.uiConversation.binding(...).target("chat")` 读 chat target，并通过 `ctx.uiSession.provide` 暴露 `useModifiedFiles` 标准 hook 给视图消费（与官方「对话」/「轨迹」同构）。
- **跨内核分层（v0.4.2）**：`uiConversation` / `uiSession` 是 `0.1.2-alpha.1` 才引入的服务，旧内核 store 里没有它们的提供方。因此这两个**硬依赖不写在 loader entry 的 `inject` 上**（写了会让整个 entry 停在 PENDING，被 boot 末尾只遍历 `ctx.loader.entries()` 的审计判为失败 → `web boot: 1 entry did not activate` + `Failed to load plugins` 横幅，五个功能一起丢），而是收进 `ctx.plugin(alphaFeatures)` **子 fiber**：入口层只声明五个跨内核服务，功能三整段注册（chat target 取数、`useModifiedFiles` hook、`conversation.view` 注册、MFS 文案）搬进子 fiber，`alphaFeatures.inject = ["uiConversation", "uiSession"]`。旧内核上该子 fiber 停在 PENDING——cordis 不执行其函数体、不注册其 effect、也不计入审计，服务（哪怕延后出现）就绪时自动激活，并随 entry dispose 一并释放。渲染方式完全不变（纯 slot，无观察器/定时器）。

- 工作区徽章注册进 `conversation.session.header.actions`（见功能四）。
- 设置页注册进 `settings.section`（见功能五）；所有偏好走 apply 期创建的一次性 localStorage 偏好仓库，组件经 `useSyncExternalStore` 订阅。

六个功能各自独立命名空间（locale / slot id / data-* 前缀），互不干扰。

## 内核兼容矩阵

| DSH 内核 | 入口 fiber | `alphaFeatures` 子 fiber | boot 审计 | 横幅 | 可用功能 |
|---|---|---|---|---|---|
| `0.1.2-alpha.1` 及更新¹ | active | active | pass | 无 | 全部 6 项 |
| `0.1.1-rc.1` / `0.1.1-rc.2` | active | pending（静默） | pass | 无 | 1 / 2 / 4 / 5（功能三与功能六缺席，设置页对应开关灰显） |

> ¹ 「更新」指 **同属 0.1.2-alpha.1 之后的发布线**（`0.1.2-alpha.1` / `0.1.2-*` / `0.1.3-*` / `0.1.5-*` / `0.1.6-*` 及更高）。DSH 的预发布版按 semver 只与**同一 `x.y.z` 元组**比较，所以字面区间 `>=0.1.2-alpha.1` 在真实 semver 下**并不匹配** `0.1.5-rc.2`——本包因此按发布线逐条声明，而不是写一个连续区间，详见下节。

### 机器可读的内核约束（`engines.dsh`）

`package.json` 同时声明两处（生态两种写法都在用，值必须一致）：

```json
"engines":      { "dsh": "^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0 || >=0.1.6-0" },
"dsh": { "engines": { "dsh": "^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0 || >=0.1.6-0" } }
```

- **谁在读**：`dshmarket` 的 `manifestFacts()` 读顶层 `engines.dsh`，缺失时回落到 `dsh.engines.dsh`；市场会据此在 **Discover 页展示宿主兼容性**，并在**安装/更新前直接拒绝**判定为不兼容的版本（`deriveHostCompatibility` → `incompatible` → 400）。
- **生效范围（请如实理解）**：市场是**按 npm 包名**向 registry 取这份事实的。本包目前以 `github:qgx1992/dsh-ui-tools` 分发，而该更新路径对 git 源不查 registry（`usesNpmUpdateTarget = !restore && !isGit`）；且 `dsh-ui-tools` 这个 npm 名字属于他人（另一作者的插件，无此声明）。所以这条声明当下的作用是**统一生态惯例、并为将来可能的 npm 发布备好**，**不构成本机 github 安装路径的运行时保险**——本包的旧内核自动降级是靠 `alphaFeatures` 子 fiber 实现的（见上），与这条声明无关。
- **为什么是逐条发布线而不是 `>=0.1.1-rc.1`**：semver 的预发布规则要求预发布版本只匹配**同 `x.y.z`** 的区间，因此 `>=0.1.1-rc.1` 会漏掉 `0.1.2-*`、`0.1.5-*` 等线；`^0.1.N-0` 每项覆盖一条线，末项 `>=0.1.6-0` 兜住此后所有新线，且**不硬顶未来内核**（把未来内核误判为不兼容会让市场拒绝合法升级）。
- **`-0` 后缀的作用**：`^0.1.1-0` 的下界取该线**最早的预发布**，否则区间会被预发布规则排除。
- 该区间已对 npm 上全部 21 个已发布内核版本 + 2 个未来哨兵逐项断言，并保证普通 semver 语义与市场侧 `includePrerelease` 语义**判决一致**（见下「自检」）。

> **验证口径**：`node tools/compat-check.mjs` 当前跑在 `0.1.6-alpha.2` 内核副本的**真实 cordis** 上（77/77 全绿），断言六个功能的槽位注册、子 fiber 状态与 boot 审计口径；`0.1.5-rc.2` / `0.1.2-alpha.3` 为历史验证点。真机（浏览器）行为另由 `tools/live-smoke.mjs` 覆盖，需自备 URL+token（`0.1.6-alpha.2` 已实测：入口无横幅、六功能标记在位、设置页四行开关均正常）。

## 自检

```bash
node --check lib/client.js       # 语法
node tools/compat-check.mjs      # 内核自适应回归（真实 cordis，四场景 + 功能六组件/口径断言）
node tools/live-smoke.mjs <URL+token>   # 真机冒烟（可选；自动探测本机 Chrome/Edge）
# 或一次跑完：npm run check
```

`tools/compat-check.mjs` 不开浏览器也不重启服务：它从本机已装内核副本里加载 cordis，搭一个最小宿主把 `lib/client.js` 的 entry 挂上去，在「旧内核 / 新内核 / 服务后到 / 内核不提供 remote」四种场景下复刻 boot 的审计口径（只看 loader entry fiber 是否停在 PENDING），断言入口激活、子 fiber 状态、各槽位注册、`useModifiedFiles` 取数、功能一目录冷解析、设置页能力位，以及**功能六的数值口径、Definition 状态机与两个组件的 DOM/开关门控**（后三项直接截取 bundle 源码段执行，测的就是被测 bundle）。

另含**声明层断言**（场景 0b）：用内核自带的真实 `semver` 校验 `engines.dsh` 覆盖全部已发布内核版本、不误伤未来内核，并保证普通语义与市场侧 `includePrerelease` 语义判决一致——手搓匹配器会把「被测语义」偷换成「我以为的语义」，故不用。可用 `DSH_SEMVER_ENTRY=<...>/semver/index.js` 指定匹配器。

`tools/live-smoke.mjs` 用 puppeteer-core 驱动本机 Chromium 内核浏览器（按 `DSH_SMOKE_CHROME` → ms-playwright 缓存 → 系统 Chrome/Edge → 常见类 Unix 路径依次探测），打开正在运行的 DSH Web 断言无加载横幅、各功能 DOM 标记在位、并截图。拿不到 URL/token 或找不到浏览器时 SKIP（exit 0）。

## 变更记录

- **v0.4.6（本次）**：新增**功能六「输出速度计 tok/s」**——回合结束后在官方「**用时 xx秒**」pill **左侧**常驻 `⚡42 tok/s`（无需点开「本轮用时和速度」弹窗），生成中在消息流末尾显示 `⚡≈ 25 tok/s 生成中估算`。精确值与内核同源同口径（`ΣoutputTokens ÷ Σ(firstTokenTime→completedTime)`，只计 timing 齐备的 step），生成中因内核流式期间不上报 token 数（`usage` chunk 被 `publication:"none"` 抑制）而按已输出字符折算并明确标注「≈ / 生成中估算」。**位置实现**：精确 pill 走 list 槽 `conversation.chat.assistant-actions`（`order: -10` → 紧贴「用时」左侧，渲染位即 `MessageIconActions.extraActions`）；生成中走官方 Definition 通道 `uiConversation.events.register` 自建 `token-speed-live` chat 节点 + `conversation.chat.node` 渲染器（**`turnTail` 槽在生成期间不渲染** —— 其数据源必须匹配到 `turn/end`，故不能用于实时）。排序锚点用大于任何真实 seq 的常量，避免节点跑到流式正文上方。设置页新增开关 `tokenSpeedEnabled`（默认开，旧内核随功能三一同灰显）。**实现过程中被自测抓到并修复一处真实缺陷**：Definition 通道形状不符时原先直接抛出，会让整个 `alphaFeatures` 子 fiber FAIL、把「修改的文件」一起拖下水 —— 现改为形状探测 + 只让生成中那段缺席。回归：compat-check **49 → 77 断言全绿**（新增数值口径、除零/空入参边界、Definition 状态机全流程、两组件 DOM 与开关门控），负向对照有效（改坏锚点 / 去掉形状守卫各触发 FAIL）；真机 live-smoke 在 `0.1.6-alpha.2` 上通过（入口无横幅、六功能标记在位、设置页四行开关正常，新增功能六断言）。**历史回合可能无读数属预期**：`firstTokenTime` 来自瞬态流式事件、不进持久化日志，重载页面后历史回合的 TPS 内核自身也不显示（同一口径）。`package.json` 版本 `0.4.5 → 0.4.6`。
- **v0.4.5（历史）**：新增**机器可读的内核版本约束** `engines.dsh`（同时写顶层与 `dsh.engines.dsh`，两者值一致），并修正 README 里「`0.1.2-alpha.1` 及更新」这一**在真实 semver 下不成立**的口径。背景：此前本包只在 README 与 `package.json` description 里用自然语言描述内核要求，没有任何字段可供工具读取——而生态实际消费的字段是 `engines.dsh`：`dshmarket` 的 `manifestFacts()` 读它（缺失时回落 `dsh.engines.dsh`），在 Discover 页展示宿主兼容性，并在**安装/更新前拒绝**判定为不兼容的版本。区间写成 `^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0 || >=0.1.6-0`：**不能**写成 `>=0.1.1-rc.1` 或 `>=0.1.2-alpha.1`——semver 要求预发布版只匹配**同 `x.y.z`** 区间，实测 `>=0.1.2-alpha.1` 不匹配 `0.1.5-rc.2`（本仓库当前实测内核），`>=0.1.1-rc.1` 也会漏掉 `0.1.2-*` / `0.1.5-*` 各线；逐条 `^0.1.N-0` 覆盖每条已发布线，末项 `>=0.1.6-0` 兜住后续新线且不硬顶未来内核（误判未来内核会让市场拒绝合法升级）。`-0` 后缀用于把下界取到该线最早的预发布。compat-check 新增场景 0b（6 条断言，合计 **49/49**）：用**内核自带真实 semver** 对 npm 上**全部 21 个**已发布内核版本 + 2 个未来哨兵逐项断言，并要求普通语义与市场侧 `includePrerelease` 语义判决一致（偏差即失败）。负向对照有效：把区间换回 `>=0.1.2-alpha.1` 触发 4 条 FAIL（含 `0.1.5-rc.2` 未被自身声明覆盖）。**未改动任何运行期逻辑**（`lib/client.js` 与 v0.4.4 逐字一致）；内核兼容行为与 v0.4.4 相同，当前实测内核 `0.1.5-rc.2`。
- **v0.4.4（本次）**：修复**功能一在 0.1.5-rc.1 内核上每次挂载会话抛一次 `cannot get property "remote.session" without inject`**。根因：内核 `ModelDirectoryResolver.directoryFor()` 内部要读 `this.ctx.remote.session` 构造 ModelDirectory，而 cordis 的 Service tracker 会把 service 的 `this.ctx` **重绑到调用方上下文**——所以调用方 fiber 必须自己声明 `remote`。本插件功能一的 `ctx.inject([...])` 只声明了 `slots/modelDirectories/sessions`，于是每次冷解析（新会话、会话切换）都抛未捕获错误；只因 `directoryFor` 开头有「已缓存则早返回」的短路，多数时候命中内核自建目录才没炸出可见故障（竞态相关）。修复：① 在该**子作用域**补声明 `remote` + `remote.session`（两者都要：后者是嵌套追踪服务，只补前者实测错误照旧；刻意都不进 loader entry 的 `inject`，否则会重新引入 v0.4.2 修掉的旧内核 entry 停 PENDING / 五功能全丢）；② 加 `mssResolveDirectory()` 兜底，解析失败不再冒泡成 pageerror，而是降级为「本座位不渲染 + 经 `html[data-ui-tools-model-seat="fallback"]` 把官方控件放回来」，避免「官方被 CSS 隐藏 + 插件座位缺席」两头皆空。同类语义对等插件 `dsh-vision-router` 已有防护代码。回归：compat-check 扩到**四场景 43 断言**（新增场景 D 用「内核不提供 remote」夹住依赖位置；功能一冷解析正向断言），live-smoke 新增 `remote.session` 与**座位真的渲染**两条真机断言（只断言「不报错」不够——兜底会把异常吞成 warn 并静默降级），并修复浏览器探测（原先只认 ms-playwright 写死路径，本机没装 Playwright 时静默 SKIP）。
- **v0.4.3（历史）**：「修改的文件」支持 **run_code 内嵌工具调用路径提取**——当前 DSH agent 环境的文件操作全部包在 `run_code` 里（工具名恒为 `run_code`，路径藏在 `code` 字符串），旧逻辑按工具名白名单匹配导致这类会话一律显示「0 个文件」。新增 `mfsExtractRunCodePaths`：从 `code` 静态提取 `tools.edit/write/mkdir/move/copy/delete…` 内嵌调用的字面量路径（含字符串数组参数），按内嵌工具映射回白名单 ops，复用去重/徽标/打开链路。字符扫描解析（无正则拼接），反斜杠转义原样保留（Windows 路径不因 `\t`/`\n` 语义被改写）；变量拼接、模板串、shell 级写操作（pwsh `Set-Content`/重定向、gitbash）不计入。compat-check 新增对应断言（当时 33/33 全绿）。
- **v0.4.2（历史）**：内核版本自适应（软依赖 + 子 fiber 隔离），修复「切到 0.1.1-rc.x 旧内核后 Web UI 顶部 `Failed to load plugins` / `web boot: 1 entry did not activate` 横幅、桌面端反复重载」——根因是入口 `inject` 硬声明了 `0.1.2-alpha.1` 才有的 `uiConversation` / `uiSession`，旧内核无提供方 → 整个 entry 停在 PENDING 被 boot 审计判失败，五个功能一起丢。现在入口只声明五个跨内核服务，功能三的整段注册搬进 `ctx.plugin(alphaFeatures)` 子 fiber（`alphaFeatures.inject` 承载这两个硬依赖），旧内核上子 fiber 静默停在 PENDING、其余四项照常；另加能力探测（子 fiber 激活即置位 `capability.alphaApi`）+ 设置页灰显提示「需内核 0.1.2-alpha.1+」+ 关键调用点形状探测与 try/catch 降级；新增 `tools/compat-check.mjs` 无头回归（真实 cordis，三场景）与 `npm run check`。行为与验收见[内核兼容矩阵](#内核兼容矩阵)。
- **v0.4.1（历史）**：按反馈移除 v0.4.0 的「composer 快捷命令条」——删除 `conversation.composer.dock` 注册、QCB 命名空间/CSS、偏好字段 `quickbarEnabled`/`quickbarItems` 及设置页快捷条编辑器；「DSH UI 工具」设置页保留（仅布局偏好：徽章开关 / 启动默认折叠 / 修改文件紧凑显示），插件回归五功能。
- **v0.4.0（历史）**：新增「composer 快捷命令条」——注册进官方 `conversation.composer.dock`（list 加性，order 10），输入框下方一排常用命令 chip，点击 = `inputActions.setDraft` + `submit` 填入并发送，命令列表可在设置页自定义；新增「DSH UI 工具」设置页——注册进官方 `settings.section`（root list 槽，id `dsh-ui-tools`、order 100），集中开关四个既有功能 + 快捷命令条，「修改的文件」新增紧凑单行模式、侧边栏新增「启动默认折叠」偏好；全部偏好经 localStorage 持久化（`dsh-ui-tools:prefs:v1`，沿用 `dsh-better-sidebar` 同款社区惯例；官方 settings 命名空间需 host 侧注册 schema，本插件保持纯浏览器故不采用）。v0.4.1 起快捷命令条已移除。
- **v0.3.4（历史）**：修复 DSH 0.1.2-alpha.1 上「折叠/展开」工具条错位（与余额挤在一行、「展开全部」被裁剪）——旧 CSS 里硬编码的侧边栏哈希类名 `.hHd-Xa_footerActions` 已失效，且 renderer 给 slot 套的 `div[data-slot]` 是 `display:contents`（不参与布局），原 `:has` 换行规则命中也无效。改用**哈希无关**的 `[class*="footerActions"]{flex-wrap:wrap !important}` 命中真实布局容器，内核升级不再失效。
- **v0.3.3**：真正修复 DSH 0.1.2-alpha.1 上的加载失败（`Failed to load plugins` / `client-modules: require(...) missed the module table`）——client bundle **不再 require `@deepseek-ai/dsh-client-runtime/client`**：`resolveWorkspacePath` 按官方 `dsh-client-ui-chat` 的做法**内联进 bundle**，空快照 `MFS_EMPTY_CHAT` 代替 `EMPTY_CHAT_SNAPSHOT`。该内核的 client 模块表严格校验，runtime 未必是 profile 的 graph 行，v0.3.2 用 `dsh.client.inject` 登记的方案实测不生效（已回退）。
- **v0.3.2**：尝试用 `package.json` 的 `dsh.client.inject` 把 `@deepseek-ai/dsh-client-runtime` 登记进 client 模块表以解决加载失败，实测在 0.1.2-alpha.1 上不生效（runtime 非 graph 行时 inject 是 no-op），已被 v0.3.3 取代。
- **v0.3.1**：兼容 DSH 0.1.2-alpha.1 内核——该内核把会话内容迁到 target 体系，`useSession` 不再提供 `nodes`/`runningCalls`；功能三「修改的文件」改经 `ctx.uiConversation.binding(...).target("chat")` 读 `ChatSnapshot.legacy` 取数，并注册 `useModifiedFiles` 标准 hook，写法与官方 `dsh-client-ui-chat` 同构。其余功能所用槽位/服务在内核中未变。
- **v0.3.0**：新增功能四「会话标题旁工作区徽章」——注册进官方 `conversation.session.header.actions` 增量 list 槽，在会话页标题右侧显示所属工作区名，纯 slot 渲染不改源码。
- **v0.2.0**：新增功能三「修改的文件」选项卡——注册进官方 `conversation.view` 开放槽，会话头部主选项卡区在「对话 / 轨迹」之后多出「修改的文件」，列出本会话改过的所有文件，点击经 Host 打开。
- **v0.1.4（2026-08-27）**：解决与余额插件（dsh-cost-meter）共用 `sidebar.footer.action` 时的同行冲突——纯 CSS 让容器换行、工具条占满整行，自动排到余额下方自己的行。
- **v0.1.3（2026-08-27）**：彻底放弃搬动 DOM——v0.1.2 的收窄观察器方案实测仍卡死（搬动 slot 节点与框架互搏）。改为纯 slot 渲染（工具条即官方 `sidebar.footer.action` 位置，紧贴工作区列表下方）+ CSS 对齐列表内边距。
- **v0.1.2（2026-08-27）**：尝试用收窄的 footer 观察器恢复 v0.1.0 的位置，实测仍卡死，回退。
- **v0.1.1（2026-08-27）**：修复 v0.1.0 卡死——移除全局 `document.body` MutationObserver 与 40ms 定时搬节点（工具条当时因此回到 footer 位置）。
- **v0.1.0**：合并 `dsh-model-select-style`（模型选择双按钮）+ `dsh-workspace-collapse`（侧边栏折叠/展开）。

## 安装

```bash
dsh plugin --profile web add github:qgx1992/dsh-ui-tools
```

或手动在 `~/.dsh/profiles/web/package.json`：
- dependencies 加 `"dsh-ui-tools": "github:qgx1992/dsh-ui-tools"`
- `dsh.profile.bundles` 加 `"dsh-ui-tools"`
- 在 profiles/web 目录执行 `pnpm install`，然后重启 DSH。

> 注意：首次登记进 profile 后需要重启一次 DSH；之后调整 `lib/client.js` 只需刷新页面。

## 从旧插件迁移

本包合并了 `dsh-model-select-style` 与 `dsh-workspace-collapse`。迁移时从 `~/.dsh/profiles/web/package.json` 移除这两个旧条目（dependencies 与 bundles），只保留 `dsh-ui-tools`，然后 `pnpm install` 并重启。

## 停用 / 卸载

- 临时停用（推荐，无需卸载）：在 `~/.dsh/profiles/web/cordis.patch.yml` 追加下面两行，重启 DSH 即可（要恢复就删掉这两行再重启）：
  ```yaml
  - id: ui-tools
    disabled: true
  ```
- 设置 → 插件 中的停用同样有效（五个功能同时关闭）。
- 彻底卸载：从 bundles 与 dependencies 移除条目、删除 node_modules 内链接与本地插件目录。

## 明确不覆盖的范围

- 输入框里输 `/model` 弹出的命令面板选择器走的是另一套 popupSelect 组件，本插件未涉及。
- 侧边栏折叠条只影响工作区分组展开状态，不改变其他侧边栏 UI。
- 「修改的文件」tab 只从 chat target 已固化的工具调用节点提取路径：运行中、以及被会话窗口截断（历史更早）的工具调用可能暂时缺失；读取（read/glob/grep）等只读工具不会计入修改列表。
- 偏好只存当前浏览器 localStorage，不会跨浏览器/跨设备同步。
