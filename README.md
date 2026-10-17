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

## 功能三：会话标题旁工作区徽章（v0.3.0 新增）

在会话页头部**标题右侧**显示一个圆角徽章，标出当前会话所属工作区名（与侧边栏分组标题同名），一眼看出当前对话跑在哪个工作区：

- 数据：标准 kit 自带 `useWorkspaces`，从 `workspaces.items` 按 `sessionIds` 反查当前会话所属工作区，取 `title`；
- 未归入任何工作区（未分组 / 空白会话）时徽章不渲染，不占位；
- 徽章显示工作区显示名（改名后同步），`title`/`aria-label` 带可读文案。

**实现原理**：本功能注册进官方**纯增量 list 槽 `conversation.session.header.actions`**（session 作用域）——它是头部标题 cluster 内的动作行，位于面包屑标题右侧，正好是「标题旁」。list 槽是加性的（绝不替换标题、无占用冲突，当前该槽无其他插件占用），我们用负数 `order: -100` 让徽章排在其它交互动作之前、紧贴标题。纯 slot 渲染，不搬 DOM、不改源码。

## 功能四：插件设置页「DSH UI 工具」（v0.4.0 新增；v0.4.1 移除快捷命令条）

在官方**设置中心**新增一个「DSH UI 工具」页面，集中控制本包功能的偏好：

- **布局偏好**：工作区徽章开关、启动时默认折叠所有工作区分组、在「用时」旁显示输出速度计（tok/s）；
- 偏好经 **localStorage** 持久化（`dsh-ui-tools:prefs:v1`），刷新/重启后保持；
- **能力感知（v0.4.2）**：速度计依赖的内核服务不可用时（`0.1.1-rc.x`），那一行开关**灰显**并在标签下提示「需内核 0.1.2-alpha.1+」，不会出现一个点了没用的开关。可用性由 `alphaFeatures` 子 fiber 实际激活来置位（比在 apply 期一次性探测更可靠：官方 provider 可能比本插件晚激活）。

> 存储说明：官方 settings 命名空间需要 host 侧 `ctx.settings.register(ns, schema)` 声明 schema 才能持久化（参考 `ui-theme/src/index.ts`）；本插件刻意保持纯浏览器（`lib/index.js` 空入口、不引入 host 依赖与 schema 校验风险），故沿用浏览器插件社区惯例（同款 `dsh-better-sidebar`）的 localStorage。偏好仅当前浏览器生效；如需跨端/跨浏览器同步，可后续增加 host 半部迁移到 settings 文档。

**实现原理**：注册进官方 **`settings.section`**（root 作用域 list 槽），`id: "dsh-ui-tools"`、`order: 100`、`label` 走双语文案，设置导航自动出现该页。页面组件订阅同一个 localStorage 偏好仓库（`useSyncExternalStore`），所有开关写入即落盘；既有功能在 `apply()` 里注入同一偏好仓库：徽章/速度计组件渲染时读开关，侧边栏折叠条在插件加载时按「默认折叠」偏好执行一次。

## 功能五：输出速度计 tok/s（v0.4.6 新增）

在**回合输出速度**上补一个常驻读数，两个位置：

- **回合结束后（精确值）**：在官方「**用时 xx秒**」pill **左侧**紧邻处显示 `⚡42 tok/s`，无需点开「本轮用时和速度」弹窗即可看到速度；
- **生成中（估算值）**：回合进行时在消息流末尾显示 `⚡≈ 25 tok/s 生成中估算`，每秒刷新。

数值口径（**精确值**）与内核「本轮用时和速度」弹窗里的 TPS **完全同源**：先按 `messageId` 定位回合，再折叠该回合全部已固化 assistant 节点，只累计**同时带 `timing.firstTokenTime` 与 `usage.outputTokens`** 的 step，按 `ΣoutputTokens ÷ Σ(completedTime − firstTokenTime)` 求值（对应内核 `deriveTurnMetrics` / `assistantStepReading`）；数据不足（无可计步、解码时长为 0）时**不显示**，绝不猜一个假值。

**为什么生成中只能给估算值**：内核在流式期间**不上报 token 数** —— `assistant/live-chunk` 里的 `usage` chunk 被 `publication: "none"` 抑制，不推给客户端。所以生成中按已输出字符折算（CJK 1 字符 ≈ 1 token，其余 4 字符 ≈ 1 token），并**始终带「≈」与「生成中估算」标注**，与精确值明确区分；回合一旦结束即让位给精确 pill，不重复显示。

**实现原理（不改源码的两条官方通道）**：

1. **精确 pill** 注册进官方 list 槽 **`conversation.chat.assistant-actions`**（session 作用域）。该槽的渲染位置就是 `MessageIconActions` 的 `extraActions` 位——**与官方「用时」pill 同一条动作条**，`order: -10` 使其排在官方 pill 之前（内核 list 槽按 `order` 升序渲染），即紧贴「用时」左侧。该槽当前亦被官方 `dsh-client-ui-message-feedback` 使用（`order: 10`），list 槽为加性，无占用冲突。节点数据经 `uiConversation.binding(sessionId).target("chat")` 读 chat target 快照（与官方 `useChat` 同源）。
2. **生成中估算条** 走官方 Definition 通道 `ctx.uiConversation.events.register(...)`（`ui-goal`、`ui-workflow-run` 同款机制）自建一个 `token-speed-live` chat 节点，并用 `ctx.slots.inject("conversation.chat.node")` 以该 kind 注册渲染器。**为什么不用 `conversation.chat.turnTail`**：该槽的数据源必须匹配到 `turn/end` 才产出节点（`tailData` 无 `turn/end` 即返回 `null`），生成期间根本不存在；`assistant-actions` 所在动作条同理。节点的排序锚点刻意取一个大于任何真实事件 seq 的常量，使其稳定落在本回合末尾（若锚在首个增量处会因 `anchorSeq` 比较跑到流式正文上方）。
3. Definition 通道是内核对等能力中较新的一个：形状不符时**只让生成中那段缺席**（`console.warn` 记录），绝不抛出——它处在 `alphaFeatures` 子 fiber 内，抛错会让 `capability.alphaApi` 回滚、连设置页的可用性提示一起判定为不可用。精确 pill 不依赖该通道。

**开关**：设置页「在「用时」旁显示输出速度计（tok/s）」，默认开；偏好字段 `tokenSpeedEnabled`（同一个 localStorage key）。旧内核上该开关灰显。

> **历史回合为什么可能没有读数**：`firstTokenTime` 来自流式增量（瞬态事件，不进持久化日志），因此**重新加载页面后看到的历史回合**通常缺该字段——此时精确值不可得，插件与内核「用时」弹窗**都不显示 TPS**（同一口径、同一结论）。在本回合刚跑完、未重载页面的情况下读数正常。

## 功能六：会话 / 工作区列表右键菜单（v0.4.13 新增）

在侧边栏的**会话行**与**工作区行**上按右键，弹出上下文操作菜单。实现参考社区插件 [`@baihejiangnan/dsh-session-context-menu`](https://www.npmjs.com/package/@baihejiangnan/dsh-session-context-menu) 的能力面，但**代码完全自写**——不 `import`、不 `require`、不引用对方的包名与全局注册表，也不依赖对方的事件名（已由断言钉死）。

**会话行右键**（6 项）：

| 菜单项 | 行为 |
| --- | --- |
| 重命名 | 走官方重命名入口（点开官方行内编辑，不自造提交逻辑） |
| 归档会话 | `workspaces.archiveSession(id)` |
| 创建会话分支 | `sessions.fork({ sessionId, increaseTitle: true })` |
| 复制会话 ID | 写剪贴板 |
| 复制工作目录 | 写 `session.cwd` |
| 刷新页面 | `ctxReload()`（`location.reload()` + 兜底） |

**工作区行右键**（4 项）：新建会话（`uiWorkspace.startSession(id)`）、复制工作区路径（`workspace.path` → 剪贴板）、归档工作区全部会话（逐个 `archiveSession`）、刷新页面。

> ⚠ **服务契约（v0.4.13 首发踩过的坑）**：`新建会话` 只能走官方 `uiWorkspace.startSession(id)` —— `sessions` 上**没有** `startSession`；切会话同理只能走 `uiWorkspace.openSession(id)`，`sessions` 上那个 `open` **不收会话 id**。首发版误写成 `workspaces.startSession` / `sessions.open`，异常被 `ctxToast` 吞掉，用户看到的就是「点了没反应」。现在由 `tools/check-context-menu.mjs` 第 14 节的**真实方法表**逐条钉死。

**选中文本时右键**（2 项）：复制所选文本、发送所选文本到输入框（填入输入框，不自动发送）。

### 目标识别：为什么不能用 `aria-label`

判据是官方渲染时**写死**的 `data-row-key` 前缀 —— `session:<id>` / `workspace:<id>`，**不看 `aria-label`、不看界面语言**。这一条来自参考插件注释里指出的坑：官方 `row-actions` 按钮在**空白会话**与**已归档会话**上根本不渲染，若靠「这一行有没有『会话操作』按钮」判定，这类行会被判成非会话行，菜单直接退化、拿不到 session。（同一结论、自写实现。）

### 解析：三级降级 + 唯一性保护

`ctxResolveSession(sessions, row, workspace)` 依次尝试：

1. **DOM 行 id** —— `data-row-key` 命中，最可靠；
2. **当前选中行** —— `aria-selected="true"` 时取 store 的 `current`；
3. **标题兜底** —— 按 `aria-label` / `title` 在库中匹配，**只在唯一命中时采用**。

**任一级无法唯一确定就返回 `null`，调用方据此保留浏览器原生菜单 —— 绝不猜。** 尤其第 3 级：标题命中多个会话时同样返回 `null`，宁可不管，也不操作错会话。

### 实现原理（纯 DOM，不注册 slot）

- 只挂 **document 级** 三个监听：`contextmenu`、`pointerdown`、`keydown`；菜单节点 `appendChild` 到 `body`；
- **不注册任何 slot**，因此旧内核上也照常可用（无 alpha 依赖，不进 `alphaFeatures` 子 fiber）；用到的 `sessions` / `workspaces` 本就在入口 `inject` 里，官方 `uiWorkspace` 走**可选获取**（`ctx.get("uiWorkspace")`，缺席时返回 `undefined` 并降级）—— **绝不把可选服务写进入口 `inject`**（见下方说明，守 R3）；
- **R2 合规**：不搬动、不包裹 slot 渲染出来的任何节点，**无 `MutationObserver`、无轮询定时器** —— 菜单节点是本插件新建的，不是搬运既有节点；
- 全部监听由 `installContextMenu()` 返回的拆卸函数解除，**插件卸载后不留补丁**（断言逐项核对 `contextmenu` / `pointerdown` / `keydown` 三类监听是否解绑干净）；
- 动作抛错被捕获并转成提示，**不冒泡成未捕获异常**；事件已被 `preventDefault()` 时不再接管，与其他右键类插件共存不打架。

### ⚠ 为什么 `uiWorkspace` 必须走可选获取，不能写进 `inject`

这是 v0.4.13 首发后**真实发生**的一次事故，代价是**六个功能全部消失**：

`uiWorkspace` 由官方 `dsh-client-ui-workspace` 提供，在精简 bundle / 旧内核里**可能不存在**。cordis 的 `inject` 数组语义是「**必须等到**这些服务就绪才开始」，任何一个等不到，**整条 fiber 就停在 PENDING** —— 所以把 `"uiWorkspace"` 加进入口 `inject` 的后果不是「右键菜单少一个功能」，而是：

```
dsh-ui-tools: pending (waiting for services: uiWorkspace)
```

即插件整体不激活：**五个既有功能一起消失 + 顶部加载横幅**，boot 审计报 `1 entry did not activate`。用户看到的现象是「右键菜单里的项都没效果」——极易误诊成菜单自身的事件 bug，实际菜单**根本没装上**。（这与 v0.4.2 在 `uiConversation` 上踩的是同一个坑。）

**正解** —— 在子作用域里可选获取，配能力探测干净降级：

```js
ctx.inject(["sessions", "workspaces"], (scope) => {
  const uiWorkspace = ctx.get("uiWorkspace");   // 缺席时是 undefined，不抛错
  // 每个调用点都探测：typeof uiWorkspace?.startSession === "function"
});
```

`ctx.get(name)` 在服务缺席时返回 `undefined` 而**不抛错**（cordis 内部 `const impl = key && this.store[key]; if (!impl) return;`），因此这条路径是干净的降级而不是崩溃。

**已由断言钉死**：把 `"uiWorkspace"` 塞回入口 `inject`，`compat-check` 从 **101/101 掉到 50/85**，并精确报出 `pending (waiting for services: uiWorkspace)`。

### 交互与无障碍

`role="menu"` / `role="menuitem"`、`tabindex="-1"` + roving tabindex（打开即聚焦首项）；支持 <kbd>Esc</kbd> 关闭、<kbd>↑</kbd>/<kbd>↓</kbd> 移动、<kbd>Home</kbd>/<kbd>End</kbd> 跳转、点击菜单外部关闭；归档等危险项走独立样式类 `dsh-ctx-item--danger`；**空菜单被拒绝**，不会弹出一个空白方块。

**开关**：设置页「会话 / 工作区列表右键菜单」，默认开；偏好字段 `ctxMenuEnabled`。**关掉时一根监听都不挂**，浏览器原生右键菜单原样保留；门控显式订阅偏好仓库，因此**改开关即时生效、无需刷新页面**，卸载时订阅与监听一并清理。

## 实现原理

- 官方模型组件照常注册在 `conversation.input.model`（数据/提交逻辑原样保留），用 CSS 隐藏官方触发按钮；
- 本插件通过 `modelDirectories` 服务读取同一份模型目录（groups = 供应商分组），注册到 `conversation.input.right`（list slot）追加双按钮；**v0.4.4**：该子作用域必须同时声明 `remote` **和** `remote.session`——内核对 `directoryFor()` 的实现会在**调用方**上下文里读 `this.ctx.remote.session`（cordis 的 Service tracker 会把 service 的 `this.ctx` 重绑到调用者），而 `remote.session` 是嵌套追踪服务，只声明 `remote` 仍会抛 `cannot get property "remote.session" without inject`；
- 选择模型/推理等级时调用官方 `directory.select(...)`，官方 store 同步更新，输入框状态与原生一致；
- 折叠条注册到 `sidebar.footer.action`——官方渲染位置就是 footer 顶部、紧贴工作区列表正下方，用 CSS（对齐 `--dsh-session-list-edge-inset` 内边距）贴合列表即可，**不搬动 DOM**。搬动 slot 渲染出来的节点会与框架重渲染互相触发，导致渲染进程 100% CPU 卡死（v0.1.0 全局观察器、v0.1.2 收窄观察器均因此卡死；v0.1.3 起彻底不搬）。
- **跨内核分层（v0.4.2；v0.4.9 收窄）**：`uiConversation` 是 `0.1.2-alpha.1` 才引入的 client target 体系服务，旧内核 store 里没有它的提供方。因此这个**硬依赖不写在 loader entry 的 `inject` 上**（写了会让整个 entry 停在 PENDING，被 boot 末尾只遍历 `ctx.loader.entries()` 的审计判为失败 → `web boot: 1 entry did not activate` + `Failed to load plugins` 横幅，其余功能一起丢），而是收进 `ctx.plugin(alphaFeatures)` **子 fiber**：入口层只声明五个跨内核服务，功能五（速度计）整段注册（chat target 取数、`conversation.chat.assistant-actions` 注册、Definition 通道、TSP 文案）放在子 fiber 内，`alphaFeatures.inject = ["uiConversation"]`。旧内核上该子 fiber 停在 PENDING——cordis 不执行其函数体、不注册其 effect、也不计入审计，服务（哪怕延后出现）就绪时自动激活，并随 entry dispose 一并释放。渲染方式完全不变（纯 slot，无观察器/定时器）。

- 工作区徽章注册进 `conversation.session.header.actions`（见功能三）。
- 设置页注册进 `settings.section`（见功能四）；所有偏好走 apply 期创建的一次性 localStorage 偏好仓库，组件经 `useSyncExternalStore` 订阅。

六个功能各自独立命名空间（locale / slot id / data-* 前缀），互不干扰。

> **v0.4.9 移除「修改的文件」选项卡**：它原本注册进官方 `conversation.view` 槽（v0.2.0 引入、v0.4.9 整体删除）。移除原因：其取数是同一份 chat target 快照的又一遍解析，与速度计重复；维护成本集中在 `run_code` 内嵌路径提取这类易碎逻辑上（模板串、变量拼接、shell 级写操作都解析不了）。随之下线的还有 `uiSession.provide` 暴露的 `useModifiedFiles` hook、`workspaces.openPath` 打开链路、`mfsCompact` 偏好与 `conversation.view` 槽注册——`alphaFeatures` 子 fiber 的 `inject` 因此收窄为 `["uiConversation"]`，跨内核降级机制本身完全未变。

## 内核兼容矩阵

| DSH 内核 | 入口 fiber | `alphaFeatures` 子 fiber | boot 审计 | 横幅 | 可用功能 |
|---|---|---|---|---|---|
| `0.1.2-alpha.1` 及更新¹ | active | active | pass | 无 | 全部 5 项 |
| `0.1.1-rc.1` / `0.1.1-rc.2` | active | pending（静默） | pass | 无 | 1 / 2 / 3 / 4（功能五缺席，设置页速度计开关灰显） |

> ¹ 「更新」指 **同属 0.1.2-alpha.1 之后的发布线**（`0.1.2-alpha.1` / `0.1.2-*` / `0.1.3-*` / `0.1.5-*` / `0.1.6-*` 及更高）。DSH 的预发布版按 semver 只与**同一 `x.y.z` 元组**比较，所以字面区间 `>=0.1.2-alpha.1` 在真实 semver 下**并不匹配** `0.1.5-rc.2`——本包因此按发布线逐条声明，而不是写一个连续区间，详见下节。

### 机器可读的内核约束（`engines.dsh`）

`package.json` 同时声明两处（生态两种写法都在用，值必须一致）：

```json
"engines":      { "dsh": "^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0 || ^0.1.6-0 || ^0.1.7-0 || ^0.2.0-0 || >=0.3.0-0" },
"dsh": { "engines": { "dsh": "^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0 || ^0.1.6-0 || ^0.1.7-0 || ^0.2.0-0 || >=0.3.0-0" } }
```

- **谁在读**：`dshmarket` 的 `manifestFacts()` 读顶层 `engines.dsh`，缺失时回落到 `dsh.engines.dsh`；市场会据此在 **Discover 页展示宿主兼容性**，并在**安装/更新前直接拒绝**判定为不兼容的版本（`deriveHostCompatibility` → `incompatible` → 400）。
- **生效范围（请如实理解）**：市场是**按 npm 包名**向 registry 取这份事实的。本包目前以 `github:qgx1992/dsh-ui-tools` 分发，而该更新路径对 git 源不查 registry（`usesNpmUpdateTarget = !restore && !isGit`）；且 `dsh-ui-tools` 这个 npm 名字属于他人（另一作者的插件，无此声明）。所以这条声明当下的作用是**统一生态惯例、并为将来可能的 npm 发布备好**，**不构成本机 github 安装路径的运行时保险**——本包的旧内核自动降级是靠 `alphaFeatures` 子 fiber 实现的（见上），与这条声明无关。
- **为什么是逐条发布线而不是 `>=0.1.1-rc.1`**：semver 的预发布规则要求预发布版本只匹配**同 `x.y.z`** 的区间，因此 `>=0.1.1-rc.1` 会漏掉 `0.1.2-*`、`0.1.5-*` 等线；`^0.1.N-0` 每项覆盖一条线，末项 `>=0.3.0-0` 兜住此后所有新线，且**不硬顶未来内核**（把未来内核误判为不兼容会让市场拒绝合法升级）。
- **`-0` 后缀的作用**：`^0.1.1-0` 的下界取该线**最早的预发布**，否则区间会被预发布规则排除。
- 该区间已对 npm 上全部 **29 个**已发布内核版本 + 3 个未来哨兵逐项断言，并保证普通 semver 语义与市场侧 `includePrerelease` 语义**判决一致**（见下「自检」）。
- **v0.4.8 修正**：此前区间写作 `… || >=0.1.6-0`，其末项在**普通语义**下**不覆盖**任何 `0.1.7-*` / `0.2.0-*` 预发布版（只在 `includePrerelease` 下才成立），实测有 **6 条分流**（`0.1.7-alpha.1/2`、`0.1.7-rc.1/2`、`0.2.0-rc.1/2`）。原因同上一节：预发布版只与同 `x.y.z` 的元组比较，而 `>=0.1.6-0` 的下界落在 0.1.6 线。更隐蔽的是——当时 0b 的版本表**只列了 21 个**，恰好漏掉整条 0.1.7/0.2.0 线，于是「两种语义判决一致」那条断言**假绿**。现改为逐条发布线 `^0.1.6-0 || ^0.1.7-0 || ^0.2.0-0 || >=0.3.0-0` 并**全量列表**，令同类裂缝无处可藏。

> **验证口径**：`node tools/compat-check.mjs` 跑在本机已装内核副本的**真实 cordis** 上（当前实测 `0.2.1-alpha.2`，**101/101** 全绿；断言计数随内核枚举动态变化，门槛是**零 FAIL** 而非某个具体数字，因此别把它当固定指标读），且场景 B3 会**逐内核遍历**本机全部可发现内核（`kernels/*` 各副本 + **`app.asar` 内桌面版自带内核**），断言五个功能的槽位注册、子 fiber 状态与 boot 审计口径；`0.1.7-rc.2` / `0.1.5-rc.2` / `0.1.2-alpha.3` 为历史验证点（这些内核副本**已不在本机**，本机现存副本为 `0.2.1-alpha.1` 与 `0.2.1-alpha.2`，B3 会跳过缺席者）。真机（浏览器）行为另由 `tools/live-smoke.mjs` 覆盖，需自备 URL+token（`0.2.1-alpha.2` 已实测：入口无横幅、五功能标记在位、设置页三行开关均正常）。

> **profile 安装漂移**：`tools/check-profile-drift.mjs` 会比对 `~/.dsh/profiles/*/` 三处口径——`package.json` 的声明、`pnpm-lock.yaml` 的 specifier 与 resolved 版本、`node_modules` 里实际安装的版本。三者不一致时必须先修 profile，否则「改了代码、刷新页面、毫无变化」——因为真实 GUI 跑的是 profile 里的安装副本，而 `compat-check.mjs` 读的**永远是仓库 `lib/client.js`**，两者是两份文件。

## 自检

```bash
node --check lib/client.js       # 语法
node tools/check-hooks-order.mjs  # Hook 顺序钉：条件 return 不得夹在 Hook 之间（防 React 卸载期抛错）
node tools/check-model-seat-hug.mjs  # 功能一「座位紧贴听写按钮」的选择器回归钉（手写 DOM 骨架 + 求值真实 CSS）
node tools/check-context-menu.mjs    # 功能六右键菜单钉：判据/三级降级/菜单组装/事件分发/键盘/拆卸/开关门控（手写 DOM 测试台）
node tools/check-profile-drift.mjs   # profile 安装漂移钉：声明 / lock / 实装三者须一致
node tools/compat-check.mjs      # 内核自适应回归（真实 cordis，场景 0/0b/A/B/B2/B3/C/D + 速度计组件/口径断言）
node tools/live-smoke.mjs <URL+token>   # 真机冒烟（可选；自动探测本机 Chrome/Edge）
# 或一次跑完：npm run check
```

`tools/check-hooks-order.mjs` 专治一类**只在特定状态切换时才炸**的崩溃：React 靠「Hook 调用顺序 + 数组下标」识别 Hook，而它**从不清空 hook 数组**，只按 `hookIndex++` 覆盖——于是 `if (!cond) return null;` 夹在两个 Hook 之间时，`cond` 为假的那次渲染里后续 Hook 槽位残留上一次的值（若上次该槽是 `undefined`，卸载时 React 执行 `destroy()` 直接抛 `undefined is not a function`）。脚本用纯词法扫描（不引入 babel/typescript，守 R6）切出每个函数组件的函数体、跟踪最外层 `return` 与 `useXxx(` 调用的相对位置，命中即 FAIL；并自带双向负向对照（违规样例必红 + 合规写法不误报），确保断言本身不会退化成同义反复。

`tools/check-context-menu.mjs` 用**手写 DOM 测试台**（零依赖，不引 jsdom）跑功能六的 82 条断言：从 `lib/client.js` 里按花括号配平**取出真实函数**注入沙箱执行，并把 `CTX_ZH` 词典求值出来做文案核对（断言看的是用户真正会看到的字，不是 stub 返回的键名）。覆盖判据识别（含「工作区行不被误判成会话行」）、三级降级与**标题歧义必须返回 null**、菜单组装与空菜单拒绝、三类目标的右键分发、键盘与外部点击、卸载后三类监听全部解绑且补丁摘干净、**动作真的调到官方服务而非空壳**、动作抛错不冒泡、不引用参考插件包名、CSS 并入共享标签、开关门控语义。**负向对照必须真的变红**：判据改坏的方式是把源码文本改掉后重新编译沙箱（给 `env.ctxSessionRowId` 重新赋值是**无效**的——闭包内的调用走词法绑定，改不到；这一点本身就是踩过的坑）。另外，凡是「代码里不许出现 X」的断言都先**剥离注释**再比对，否则文件顶部写明「参考插件：@baihejiangnan/…」「无 MutationObserver」会把注释当代码判红。

`tools/check-profile-drift.mjs` 专治一类**排查成本极高的假象**：profile 的 `package.json` 写着 `#v0.4.11`，而 `pnpm-lock.yaml` 仍钉在旧 commit——下次 `pnpm install` 会把插件**无声回退**；更常见的是「改了仓库代码、刷新页面毫无变化」，因为真实 GUI 加载的是 profile 里的安装副本。脚本只读不写，逐 profile 比对声明 / lock specifier / lock resolved 版本 / `node_modules` 实装版本，找不到 `~/.dsh/profiles` 时优雅 SKIP。

`tools/check-model-seat-hug.mjs` 专治一类**静态阅读看不出来**的样式 bug：它把手写 DOM 骨架建成内核 `InputBar` 右侧动作区的真实层次（座位在 `div.standardControls` 内、听写按钮嵌在兄弟容器 `div.activity` 的 `span.triggerAnchor` 里），**求值** `MSS_CSS` 模板串（而不是只读源码文本）后用自写选择器匹配器逐条核对：座位父容器被推到最右、横缝收到 0、中英两套 `aria-label` 都命中、无座位/听写缺席时不误伤、CSS 里不出现内核哈希类名、官方模型按钮仍被隐藏。它也守住「模板串被反引号提前闭合」这类事故——那种情况下求值会失败或留下未展开的 `${...}`。本仓库零依赖，不引入 jsdom。

`tools/compat-check.mjs` 不开浏览器也不重启服务：它从本机已装内核副本里加载 cordis，搭一个最小宿主把 `lib/client.js` 的 entry 挂上去，在「旧内核 / 新内核 / 服务后到 / 内核不提供 remote」四种主场景（外加声明层 0/0b、速度计 B2、真内核装配器 B3）下复刻 boot 的审计口径（只看 loader entry fiber 是否停在 PENDING），断言入口激活、子 fiber 状态、各槽位注册、功能一目录冷解析、设置页能力位（含三条「`conversation.view` / `uiSession.provide` / `workspaces.openPath` 永不被调用」的逆向钉），以及**功能五的数值口径、Definition 状态机与两个组件的 DOM/开关门控**（后三项直接截取 bundle 源码段执行，测的就是被测 bundle）。

另含**声明层断言**（场景 0b）：用内核自带的真实 `semver` 校验 `engines.dsh` 覆盖全部已发布内核版本、不误伤未来内核，并保证普通语义与市场侧 `includePrerelease` 语义判决一致——手搓匹配器会把「被测语义」偷换成「我以为的语义」，故不用。可用 `DSH_SEMVER_ENTRY=<...>/semver/index.js` 指定匹配器。

`tools/live-smoke.mjs` 用 puppeteer-core 驱动本机 Chromium 内核浏览器（按 `DSH_SMOKE_CHROME` → ms-playwright 缓存 → 系统 Chrome/Edge → 常见类 Unix 路径依次探测），打开正在运行的 DSH Web 断言无加载横幅、各功能 DOM 标记在位、并截图。拿不到 URL/token 或找不到浏览器时 SKIP（exit 0）。

## 变更记录

- **v0.4.18（本次）**：修掉功能一弹出列表的「**文字不自适应**」（用户实测：按钮弹窗的列表文字发灰、选中项看不清）。
  - **问题**：v0.4.16 只把**面板根节点**的文字换成了字面值，而面板里的子元素仍在引用内核 token：`.mss-group-title` / `.mss-empty` / `.mss-loading` 用 `--dsw-alias-label-tertiary`，`.mss-row .mss-desc` 用 `--dsw-alias-label-caption`。查内核主题源码（`@deepseek-ai/dsh-client-ui-theme/lib/client.js`）得两组 token 的两套取值：`label-tertiary` 浅色 `#81858c` / 深色 `#adb2b8`，`label-caption` 浅色 `#adb2b8` / 深色 `#81858c`。而本插件面板实底是**自己写死的** `#f8f9fa` / `#2c2c2e`，两套体系一不同步就翻车：浅色面板 `#f8f9fa` 配 `#81858c` 只有约 3.3:1，11px 小字直接发灰；深色面板 `#2c2c2e` 配 caption `#81858c` 约 3.2:1。同一根因还带出三个隐性可见问题：选中底用 `color-mix(in srgb, var(--dsw-alias-brand-primary) 12%)`，而本机 `brand-primary` 解析成**近黑**（bluish-1000），浅色面板上那层选中底几乎看不见；勾选色用 `--dsw-alias-brand-text`（本机同样近黑），在深色面板上等于隐形；hover 底用 `--dsw-alias-interactive-bg-hover`（浅色 `#2631480f`），是给内核表面调的，落在本插件实底上偏薄。
  - **改法**：把面板内**每一个文字层**（面板根 / 分组标题 / 选项描述 / 空态+加载态）与**三种交互底**（hover / 选中 / 选中+hover）以及勾选色全部改成**字面值、深浅各一套**，用 `[data-ds-dark-theme]` 属性选择器切档（比 `light-dark()` 兼容性稳，DSH 桌面端不保证 Chrome 123+）。取色都按对各自实底的 WCAG 对比度反推：分组标题 `#5f6469` 浅 5.67:1 / `#b9bec6` 深 7.46:1，描述 `#6a7079` 浅 4.74:1 / `#a7adb6` 深 6.17:1，勾选 `#4176e6` 浅 4.02:1 / `#6a9bff` 深 5.14:1，选中底浅 `rgba(65,118,230,.12)` / 深 `rgba(90,140,250,.22)`。由此**面板配色完全自洽**，不再与内核任何一次主题改动产生牵动。
  - **为什么不用 `var(--x, fallback)` 兜底**：兜底只在 token 缺席时生效，而本机 token 恰恰是「存在但取值不适合这套实底」，兜底永远轮不到。
  - **断言（`tools/check-model-seat-hug.mjs` 32 → 38 条）**：新增 §6.1 六条按**实际解析出的颜色算 WCAG 对比度**的断言——分组标题/选项描述/空态浅深各 ≥ 4.5:1、选中底深浅 alpha 必须可见、勾选色 ≥ 3:1、**面板范围内不许再出现任何 `label-*` / `brand-*` / `interactive-bg` 内核 token**（负向兜底：想改回引 token 立刻变红）。同时把两条旧断言从「必须写某个 token」改成按实际颜色判定（深色面板文字按相对亮度 ≥ 0.6、面板根文字对实底 ≥ 4.5:1），并修正了旧版把**半透明交互底**误当成「面板底色」判红的取样范围 bug（只认选择器最后一级就是 `[data-mss-panel]` 的规则）。
  - **需要刷新页面**：本次改了 `lib/client.js` 的 CSS，属于客户端 bundle 变更。

- **v0.4.17（历史）**：只动**断言工具**，插件运行时（`lib/client.js` / `lib/index.js`）一行未改。
  - **问题**：`tools/compat-check.mjs` 的「未知依赖模块兜底桩」写成 `new Proxy({}, { get: () => () => ({}) })` —— 任何属性都返回一个普通函数。内核 bundle 里有 `class X extends SomeBase` 这类写法，而普通函数不可当基类，于是抛 `Class extends value () => ({}) is not a constructor`；该异常又被外层的 `catch` 静默吞掉，整段 B3 判为空，最终对外表现成「本机找不到内核副本，本节跳过」。**这是断言工具自己的假绿，不是内核缺失**。
  - **改法**：换成「可调用 + 可构造 + 任意属性返回自身」的 Proxy 兜底（`apply` 返回自身、`construct` 返回空对象、`prototype` 返回空对象、`then`/`toJSON`/`Symbol.toPrimitive` 返回 `undefined` 以免被当成 thenable），并补齐 `react-dom` 与 `useLayoutEffect` / `useReducer` / `useTransition` / `useDeferredValue` / `useId` / `useDebugValue` / `createContext().Provider` 等形状。
  - **效果**：断言数 86/87（B3 整组被吞）→ **91/91**，五个真内核断言全部真跑：流式增量后节点物化为 visible、`settleAssistant` 收尾不抛 withdrew、收尾后节点转 hidden、多回合连续会话全程无异常、每回合都重新物化出可见读数。
  - **不需要重新构建或刷新**：本次只改 `tools/` 下的校验脚本与文档，客户端 bundle 无变化。

- **v0.4.16（历史）**：功能一两个主按钮点开的面板改成**真正写死的实底**（用户第二次确认：「两个按钮直接改成实底的，不用加设置项」，即不加开关、直接落成默认行为）。
  - **为什么要再改一次**：v0.4.13 已经把毛玻璃（`color-mix(...)` + 两条 `backdrop-filter`）换成「不透明实底」，但底色取的是 `var(--dsw-specific-menu)`。查内核主题源码（`@deepseek-ai/dsh-client-ui-theme/lib/client.js`）后发现这个 token 并不是稳定实色：它在非 darwin 平台上就是 `--dsw-menu-surface-fill`，取值为 `#f8f9fa94`（浅色，约 58% 不透明）/ `#43454a73`（深色，约 45% 不透明）—— **引用它等于把半透明底重新引回来**，面板会透出背后的 composer 与输入框文字。这也正好解释了用户看到的「弹出是透明背景」。
  - **改法**：基础规则写死 `background: #f8f9fa`（= 内核浅色 `--dsw-static-neutral-bluish-50`）；另加一组深色主题规则 `html[data-ds-dark-theme] [data-mss-panel], [data-ds-dark-theme] [data-mss-panel] { background: #2c2c2e; color: var(--dsw-alias-label-primary-foreground, #fff); }`（#2c2c2e = 内核 `--dsw-static-neutral-bluish-850`），同时把深色下的面板文字换成浅字——否则深底配基础规则里的近黑字会看不清。描边 / 圆角 12px / 三级投影原样保留，浮层与 composer 仍有明确分层。**不加任何设置项**，也不挂开关。
  - **断言（`tools/check-model-seat-hug.mjs` 28 → 32 条）**：新增「底色必须是字面实色、不许引用 `--dsw-specific-menu` / `--dsw-menu-surface-fill`」「必须存在带 `data-ds-dark-theme` 的面板实底规则且不含半透明」「深色规则里必须把文字换成 `label-primary-foreground`」三条；原来那条「底色不许含 transparent / rgba 半透明」保留（负向：改回引用菜单 token → 立刻变红）。
  - **同批第二个要求：两个主按钮加淡描边 + 文字色自适应**（用户第二次要求：「加淡描边，文字颜色自适应」）。
    - **描边**：`border` 由 `none` 改为 `1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))` —— 该 token 深色为 `#ffffff1f`、浅色为 `#0000001a`，两套主题都有可见但极淡的轮廓。
    - **文字色去向**：`color` 由 v0.4.13 写死的 `#fff` 改为 `var(--dsw-alias-label-primary, inherit)`。这个 token 本身是主题自适应的：浅色解析 `--dsw-static-neutral-bluish-1000`（近黑）、深色解析 `--dsw-static-neutral-bluish-50`（近白）。**顺带修掉一个潜伏缺陷**：写死白字在浅色主题下会变成「白字 + 近白 composer 底」直接隐形（v0.4.13 的注释里自己就写着「若日后切浅色要改回来」，这次直接按自适应解决）。
    - **底色仍是 `transparent`**：描边已经提供可点性提示，不再加实心底；`hover` / 展开态的半透明反馈保持不变。
    - **断言改动**：§5 由「常态文字色必须纯白」整节改写为 v0.4.16 口径 —— ① 文字色必须是 `--dsw-alias-label-primary`（若为纯白直接判红并说明「浅色主题下会隐形」）；② 必须有 `1px solid var(--dsw-alias-border-l2, ...)` 淡描边（`border: none` 判红）；③ **全表不得再出现任何纯白 `color` 规则**；④ 箭头仍 `color: inherit`；⑤ 描边/文字色规则不得牵连面板下拉项。条数 31 → 32。
  - **预览同步**：`demo/two-button.html`、`demo/two-button-model-open.html`、`demo/two-button-provider-open.html` 里陈旧的 `color-mix(... 90%, transparent)` 一并换成 `#f8f9fa`（面板），遗留的 `backdrop-filter` 删掉，按钮补 1px 描边、文字色改 token，并在深色 `.composer` 内覆写 `--dsw-alias-label-primary` / `--dsw-alias-border-l2` 为内核深色取值，避免预览页出现近黑字配深底。
  - `package.json` 版本 `0.4.15 → 0.4.16`。只改 `lib/client.js`、`tools/check-model-seat-hug.mjs`、三份 demo 与文档（客户端 bundle，**无构建步骤**），刷新页面或等热更新即生效。
- **v0.4.15（历史）**：修掉**功能六（右键菜单）两个互相独立的真实缺陷** —— 用户实测「右键工作区 → 复制工作区路径」与「刷新页面」两项都没反应（两条抱怨其实是两个不同的 bug，第 ① 条还会让**所有**菜单项一起失效）。
  - **① 所有菜单项都点不动**：视口监听写成 `window.addEventListener("blur", onViewportChange, true)`。`blur` 不冒泡，但**有捕获阶段**，挂在 `window` 上的**捕获**监听因此会收到**元素级**失焦：按下鼠标时焦点从菜单第一项（菜单打开时 `first.focus()` 留在它身上）移到被点的那一项，前一项触发 `blur` → `closeCtxMenu()` 把菜单节点从 `body` 摘掉 → 紧接着的 `pointerup` / `mouseup` 落到菜单**背后**的列表行上 → **`click` 永远不会派发**。真机 HUD 轨迹是铁证：`C:pointerdown>span IN_MENU ON_ITEM` → `C:mousedown>span` → `C:pointerup>div.hIlkoa_projectRow[rk=workspace:…]` → `MENU_CLOSED`，**全程没有 `C:click`**；同一机制也解释了方向键导航「一按菜单就消失」（`next.focus()` 引发前一项 `blur`）。
    - **修法**：只监听**窗口自身**失焦 —— `const onWindowBlur = (event) => { if (event.target !== window) return; closeCtxMenu(); };` + `window.addEventListener("blur", onWindowBlur)`（**不加** capture）；`resize` 仍保留捕获监听，拆卸段对称 `removeEventListener("blur", onWindowBlur)`。
  - **② 刷新页面只弹一条 `t is not defined`、页面纹丝不动**：`ctxReload()` 位于**模块作用域**，函数体第一行 `ctxToast(t("toast.reloading"))` 却引用了 `installContextMenu(scope, t, uiWorkspace)` 的**形参** `t` —— 那个作用域里根本没有 `t`，`ReferenceError` 又在 `try` **之外**抛出，于是 `window.location.reload()` 与 150ms 的 `location.replace` 兜底**一次都没跑到**，只剩菜单项 `catch` 弹出的那条报错（真机截图里的 toast 文案就是 `t is not defined`）。
    - **修法**：`ctxReload(reloadingText)` 改为收参数，三个调用点（选中文本 / 工作区行 / 会话行）统一传 `ctxReload(t("toast.reloading"))`。
  - **断言（`tools/check-context-menu.mjs` 94 → 109 条）**：新增 §8b（**元素级** `blur` 不许关菜单、窗口自身失焦仍要关；负向对照：改回带 capture 的写法必须变红）与 §8c（点「刷新页面」不抛异常、`window.__reloaded === true`、toast 含「刷新」；负向对照：`ctxReload` 改回引用 `t` 必须复现 `t is not defined` 且不刷新）；§14 新增静态断言「`ctxReload` 剥注释后不得出现 `t(`」「三处调用点必须传 `t("toast.reloading")`」「`window` 的 `blur` 监听不得带 capture」。顺带修掉测试台**一个从未被发现**的自身缺陷：4 处负向对照沿用上一节的 DOM，`querySelector(".dsh-ctx-menu")` 命中残留的旧菜单节点（点到旧闭包），负向对照因此恒以「没弹菜单」假红 —— 改为每节重建 DOM 后才真正生效。
  - **负向对照实测（本轮真跑，不是推断）**：基线 **109/109**；把 `blur` 监听改回带 capture 的旧写法 → **106/109**；把 `ctxReload` 改回引用 `t` → **106/109**；把三个调用点改回无参 `ctxReload()` → **107/109**。三组全部真红，改完即还原（文件 SHA256 与部署版一致）。
  - **真机验收（真实鼠标输入，非消息注入）**：`复制工作区路径` → 剪贴板由哨兵值变为该工作区真实路径（`D:\888yhxy`）；`刷新页面` → 抓到底部「HARNESS / Loading plugins…」启动画面、约 1.4s 后窗口标题恢复为会话名、无错误对话框、宿主 boot 标识不变。`npm run check` 退出码 0：钩子钉 7/7 + 座位钉 28/28 + **右键钉 109/109** + 漂移钉 4/4 + compat-check 101/101 + live-smoke SKIP。
  - **⚠ 真机踩坑（热更新 vs 整页 reload）**：把 `profiles/desktop` 里的实装 `client.js` **就地改掉**之后，靠 DSH 对插件 bundle 的**热更新**（约 10s 自动重跑新代码、不必刷新页面）验证是安全的；但此时若再触发**整页 reload**，shell 的 boot 审计会报 `dsh-ui-tools: import failed (see console for the import error)` 并弹出「应用无法启动」原生对话框（`logs/crash-*-web-boot.log` 只有摘要行、没有底层异常栈），而**冷启动同一份文件完全正常** —— 怀疑是宿主进程启动时算出的插件 rev 与磁盘现文件不一致。结论：改完实装文件后，要么只靠热更新验证，要么连宿主一起重启，别在改完实装文件的当下立刻整页 reload。
  - `package.json` 版本 `0.4.14 → 0.4.15`。只改 `lib/client.js`、`tools/check-context-menu.mjs` 与文档（客户端 bundle，**无构建步骤**），刷新页面或等热更新即生效。
- **v0.4.14（历史）**：修掉功能六首发后暴露的两类真实缺陷（详见下条 v0.4.13 的「首发后修复」）。
- **v0.4.13（历史）**：新增**功能六「会话 / 工作区列表右键菜单」**——插件由五功能变为六功能。
  - **来源**：用户要求「加个右键功能」，参考社区插件 `@baihejiangnan/dsh-session-context-menu`。**只借鉴能力面与那条 `data-row-key` 判据经验，代码完全自写**：不 `import` / 不 `require` / 不引用对方包名与全局注册表（`dsh.session-context-menu.extensions`）、不依赖对方自定义事件（`dsh:session-context-menu`）——四条都由断言钉死，防止以后手滑把参考插件变成硬依赖。
  - **菜单内容**：会话行 6 项（重命名 / 归档会话 / 创建会话分支 / 复制会话 ID / 复制工作目录 / 刷新页面）；工作区行 4 项（新建会话 / 复制工作区路径 / 归档工作区全部会话 / 刷新页面）；选中文本时 2 项（复制所选文本 / 发送所选文本到输入框）。
  - **判据不依赖界面语言**：用官方写死的 `data-row-key` 前缀（`session:` / `workspace:`）识别目标，而不是「这一行有没有『会话操作』按钮」或 `aria-label` —— 官方 `row-actions` 在**空白会话 / 已归档会话**上不渲染，靠按钮存在性判定会把这类行判成非会话行（该坑由参考插件注释指出，此处按同一结论自写实现）。
  - **绝不猜**：解析三级降级（DOM 行 id → `aria-selected`→`current` → 标题唯一命中），**任何一级无法唯一确定就返回 `null` 并保留浏览器原生菜单**；标题命中多个会话时同样拒绝——宁可不管，也不操作错会话。
  - **纯 DOM，守 R2/R3**：只挂 document 级 `contextmenu` / `pointerdown` / `keydown` 三个监听，菜单 `appendChild` 到 `body`，**不注册任何 slot、不搬动也不包裹 slot 节点、无 `MutationObserver`、无轮询定时器**；用到的 `sessions` / `workspaces` 本就在入口 `inject` 内，官方 `uiWorkspace` 走**可选获取**（`ctx.get`，缺席时降级）——**不往入口 inject 里加任何可选服务**。因此旧内核上照常可用（无 alpha 依赖，不进 `alphaFeatures` 子 fiber）。卸载时三类监听全部解绑，不留补丁。
  - **健壮性**：动作抛错被捕获并转成用户可见提示（不冒泡成未捕获异常）；已 `preventDefault()` 的事件不再接管（与其他右键插件共存）；空菜单被拒绝（不弹空白方块）；危险项独立样式类。无障碍：`role=menu`/`menuitem`、roving tabindex、<kbd>Esc</kbd>/方向键/<kbd>Home</kbd>/<kbd>End</kbd>、点击外部关闭。
  - **新增设置页开关**：「会话 / 工作区列表右键菜单」（`ctxMenuEnabled`，默认开）。**关掉时一根监听都不挂**，浏览器原生右键菜单原样保留；门控**显式订阅偏好仓库**（`prefs` 是普通 Set 仓库、不是 cordis 追踪服务，`scope.effect` 不会自动收集它），所以改开关即时生效、无需刷新页面，卸载时订阅与监听一并清理。
  - **新增守护断言** `tools/check-context-menu.mjs`（首发 **82/82**，本批加固后 **94/94**）并纳入 `npm run check`：手写 DOM 测试台，从 bundle 里按花括号配平取出真实函数注入沙箱执行，并求值 `CTX_ZH` 词典以核对用户真正看到的文案；覆盖判据/降级/组装/分发/键盘/拆卸/真实服务调用/异常吞掉/不引用参考插件/CSS 合并/开关门控。
  - **断言自身的两个坑（已修，值得记下）**：① 「代码里不许出现 X」类断言必须先**剥离注释**——文件顶部与历史注释里的「参考插件：@baihejiangnan/…」「无 MutationObserver」会被当代码判红（3 条假阳性）。② 负向对照**不能靠给 `env.<fn>` 重新赋值**来改坏判据——所有函数注入同一闭包作用域，内部调用走词法绑定，赋值影响不到；必须改源码文本后**重新编译沙箱**（原写法产出的是结构性假绿）。
  - **顺带（同一工作区内的用户要求）**：把功能一两个主按钮（供应商 / 模型）的**常态文字色改为纯白 `#fff`**——本机 DSH 主题偏好是 `system`，而 Windows `AppsUseLightTheme=0`（深色），composer 底为深色，白字对比最高；`.mss-caret` 用 `color: inherit`，箭头随字一起变白。**不引主题 token**而是写死白：`--dsw-alias-brand-text` 在本机解析为 `#0f1115`（近黑）、`--dsw-alias-label-primary-foreground` 也只在浅色主题下是白，两者都会随主题解析成非白，与用户明确要求的「白色」不符。`tools/check-model-seat-hug.mjs` 新增 4 条断言钉住「常态必须纯白 / 白字规则不外溢到面板 / 箭头随字变白 / 下拉项不被染白」（19 → 23 条）；`demo/two-button*.html` 三张预览页同步改白字，并把预览用输入框底改为深色 `#17181c`（否则白字在浅色预览页上看不见）。
  - **弹出列表改为完全不透明实底（同批用户要求）**：功能一两个按钮点开的面板原是「90% 菜单色 + 14px 背景模糊」的毛玻璃（`color-mix(in srgb, var(--dsw-specific-menu, #fff) 90%, transparent)` + 两条 `backdrop-filter`），现改成 `background: var(--dsw-specific-menu, #fff)` 实底并删干净 blur——半透明底会把背后的深色 composer 与输入框文字透上来，读菜单时干扰明显。描边（`--dsw-alias-border-l2`）、圆角 12px、三级投影一律保留，否则实底菜单会「贴」在输入框上分不清边界；面板文字仍是 `--dsw-alias-label-primary`（深色字配浅色实底），**不跟着按钮变白**。`check-model-seat-hug` 再加 5 条断言钉住「底色不许含 transparent / 半透明、两条 blur 必须删干净、描边圆角投影必须还在、文字不许变白、面板基础规则唯一」（23 → 28 条）。
  - **⚠ 首发后修掉一个「全功能消失」级事故（同为用户报障，最贵的一次）**：首发版把功能六需要的官方 `uiWorkspace` 服务（由 `dsh-client-ui-workspace` 提供）直接加进了**入口** `inject`。入口 `inject` 里的任何服务缺席都会让**整条 fiber 停在 PENDING 等它**，而这个服务在精简 bundle 里可能不存在 —— 于是不是「右键菜单少个功能」，而是**五个功能全部消失 + 顶部加载横幅**，boot 审计报 `dsh-ui-tools: pending (waiting for services: uiWorkspace)`。这与 v0.4.2 在 `uiConversation` 上踩的是同一个坑（见 R3）。用户看到的表象是「右键菜单里的项都没效果」，极易误诊成菜单自身的事件 bug —— 实际菜单**根本没装上**。
    - **修法**：`uiWorkspace` 移出入口 `inject`，改为**可选获取** —— 函数体里 `ctx.get("uiWorkspace")`（cordis 的 `get()` 在服务缺席时返回 `undefined` 而**不抛错**），配合 `typeof svc?.method === "function"` 能力探测干净降级，拿不到时给用户明确提示。现在 `ctx.inject(["sessions","workspaces"], (scope) => { const uiWorkspace = ctx.get("uiWorkspace"); … })`。
    - **已钉死**：把 `"uiWorkspace"` 塞回入口 inject，`compat-check` 从 **101/101 掉到 50/85**，并精确报出 `pending (waiting for services: uiWorkspace)`。
  - **同一批修掉的动作失效**：`新建会话` / `复制工作区路径` / `刷新页面` / `归档` / `分叉` 曾因调用**内核里不存在的方法**（`workspaces.startSession`、`sessions.open`）而静默失效（异常被 `ctxToast` 吞掉 = 用户看到「没反应」）。全部改调真实存在的官方方法：`uiWorkspace.startSession` / `uiWorkspace.openSession`；`刷新页面` 走自写的 `ctxReload()`（`location.reload()` + 兜底）。
  - **新增守护断言** `tools/check-context-menu.mjs`（**82/82 → 94/94**）：新增第 14 节 **服务契约**——① 列出**真实方法表**（`sessions` / `workspaces` / `uiWorkspace` 各自真实存在的方法名）逐条核对源码没有调用表外方法；② 点名两条历史写错的（`sessions.open`、`workspaces.startSession`）；③ 两组运行时负向对照。**这一节的由来值得记**：首发时 §8 的假服务把 `startSession` 挂在 `workspaces` 上、把 `open` 挂在 `sessions` 上，测试台照着一个**不存在的契约**写，于是断言把 bug 固化成了「正确」、全绿放行 —— **断言的价值上限 = 假数据对真实契约的还原度**。
  - **回归**：`npm run check` 退出码 0 —— 钩子钉 **7/7** + 座位钉 **28/28** + 右键钉 **94/94** + 漂移钉 **4/4** + compat-check **101/101**；行为矩阵「新内核 5/5 槽位功能（功能六为纯 DOM、无 slot，不参与该矩阵）」。（三组负向对照均真红：`uiWorkspace` 塞回 inject → compat-check 50/85；改调 `workspaces.startSession` → 右键钉 91/94；删掉 `location.reload()` → 右键钉 93/94。）
  - `package.json` 版本 `0.4.12 → 0.4.13`。只改 `lib/client.js`、`tools/` 与文档（客户端 bundle，**无构建步骤**），刷新页面即生效。
- **v0.4.12（历史）**：一次全量审查后的**稳定性加固**——修掉两处同类崩溃隐患、一处样式重复注入，并把三个真实事故固化成守护断言。
  - **① 两处「条件 return 夹在 Hook 之间」崩溃隐患（本次核心）**：`ModelSeatSplit` 曾把 `if (!available) return null;` 写在两个 `useEffect` 之间；`WorkspaceNameChip` 曾把 `if (!prefsState.chipEnabled) return null;` 写在 `useWorkspaces` **之前**。二者是同一类缺陷：React 从不清空 hook 数组，只按 `hookIndex++` 覆盖，所以条件为假的那次渲染里后续 Hook 槽位残留上一次的值——若上次该槽是 `undefined`，卸载时 React 执行 `destroy()` 会抛 `undefined is not a function`。**触发面真实存在**：`available = usable && face.ok`，而 `face.ok` 来自 `try/catch` 的 `mssResolveDirectory`（`directoryFor()` 有缓存早返回，`available` 会随会话摇摆）；`chipEnabled` 则是设置页开关，用户随时可切。现两处提前返回**一律移到全部 Hook 之后**，判据收进回调内部与选择器；`useSyncExternalStore` 在 `available=false` 时照常调用（拿到的是恒定的 `MSS_EMPTY_DIRECTORY`，合法且稳定）。
  - **② 功能二样式重复注入 + 一个差点酿成回归的耦合**：功能二原用独立 `<style id="dsh-ui-tools-wc-collapse-style">` 注入 `WC_CSS`，而**共享标签此前漏拼了 `WC_CSS`**（`tag.textContent = MSS_CSS + WSC_CSS + SET_CSS + TSP_CSS`）——即同一份规则实际由两条路径各自注入、且两个标签由不同 effect 独立拆卸（卸载中间帧折叠条样式会闪断）。现 `WC_CSS` **并入共享标签**统一注入，独立标签与其 teardown effect 一并删除。⚠️ 注意这两处是**强耦合**的：只删独立标签而不补共享标签，会直接把功能二的样式全部丢失——该耦合已由「共享标签含全部五份 CSS 哨兵」断言钉死。
  - **③ 减少多余请求**：功能一的 `load()` 依赖数组由 `[open, available, load]` 收窄为 `[available, load]`，不再在每次开合面板时重复拉取目录。
  - **④ 可读性**：`chooseModel` / `chooseEffort` 里 `...cond === void 0 ? {} : {...}` 靠运算符优先级生效的写法（语义正确但极易误读）改为显式条件赋值，行为完全一致。
  - **新增两份守护断言并纳入 `npm run check`**：`tools/check-hooks-order.mjs`（**7/7**，含双向负向对照）与 `tools/check-profile-drift.mjs`（**6/6**）；`compat-check.mjs` 新增 3 条样式断言（样式标签有且仅有一个、五份 CSS 哨兵齐全、废弃 id 不再出现），断言总数 **98 → 101**。
  - **修复 profile 安装漂移**：`~/.dsh/profiles/web/pnpm-lock.yaml` 的 specifier 与 `version` 字段均停在 `v0.4.10`（而 `package.json` 已声明 `#v0.4.11`），下次 `pnpm install` 会把插件回退；现已同步为 `#v0.4.11` / `0a75dde`，并把 v0.4.12 构建部署进 `desktop` 与 `web` 两个 profile（各自留 `client.js.bak-v0411` 备份），三处 `client.js` 字节一致（SHA256 `8A1F25BD…`）。
  - **订正文档**：`.scratch/check-client-inject.mjs` 头部用法路径由 `node tools/...` 订正为 `node .scratch/...`（原文按该行命令跑必然 ENOENT）；`compat-check.mjs` 里「此前漏掉 0.1.6-alpha.2 / 0.1.5-rc.3」的注释与代码不符（列表里本就有），改为只陈述现状。
  - **回归**：`npm run check` 退出码 0 —— 钩子钉 **7/7** + 座位钉 **19/19** + 漂移钉 **6/6** + compat-check **101/101**；三条负向对照均实测变红（塞回 Hook 中间的 return、从共享标签删掉 `WC_CSS`、把 lock specifier 改回 `v0.4.10`）。`package.json` 版本 `0.4.11 → 0.4.12`。只改 `lib/client.js`、`tools/` 与文档（客户端 bundle，**无构建步骤**），刷新页面即生效。
- **v0.4.11（历史）**：**把功能一（模型双按钮）里两个主按钮的背景色显式指定为透明**，并做一次全仓库口径扫尾。
  - **透明背景（用户要求「两个按钮的背景色指定为透明框」）**：`MSS_CSS` 里 `[data-mss-btn]` 的常态 `background` 由 `color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 8%, transparent)` 改为 `transparent`——不再有那层 8% 品牌色底，视觉上是输入框里两个「纯文字 + 箭头」的透明框，与官方 composer 其它无底控件连成一片。**保留交互反馈**：`:hover` 与 `[aria-expanded="true"]` 仍是 16% 半透明淡色（按钮若无任何按压/展开反馈就失去可点性提示）。若后续要求连悬停也全透明，把那两条的 `background` 一并改成 `transparent` 即可。
  - **新增 5 条守护断言（`tools/check-model-seat-hug.mjs`，14 → 19 条）**：这条需求的失败模式是「改完刷新页面看不出差别」，只读源码文本抓不到（写回 `color-mix` 照样是合法 CSS），所以断言沿用它：**求值后的 CSS** 按 cascade 取实际生效声明。钉住四面：① 常态背景**必须**是 `transparent`；② 没有另设不透明的 `background-color` 把它盖掉；③ `:hover` 与 `[aria-expanded="true"]` **各自仍保留**半透明反馈（防「改一处、静默坏另一处」）；④ 该规则**不得牵连**面板内的下拉项（`[data-mss-row]` 不命中）。
  - **扫尾 ① 验证口径数字漂移**：README 与 `AGENT.md` 里的 compat-check 计数/内核路径由 `93/93` + `0.2.1-alpha.1` 更新为 **`98/98` + `0.2.1-alpha.2`**（本机现存内核副本为 `0.2.1-alpha.1` / `0.2.1-alpha.2`）。
  - **扫尾 ② 已删功能说明残留**：删掉「明确不覆盖的范围」里那条仍在讲「修改的文件」tab 取数逻辑的说明（该功能 v0.4.9 已整体移除），改为一句指向变更记录的口径说明。
  - **扫尾 ③ `tools/live-smoke.mjs` 残留清理**：清掉 16 处已删功能痕迹——`MARKERS.modifiedFiles`（`[data-mfs-root]`）、pageerror 过滤里的 `mfs`、整段「2b 功能三取数」断言、设置页「四个偏好行」与「修改的文件行」断言、demo 段误读的 `row-mfs`/`mfs-toggle`/`mfs-hint`（真实 demo 里这三个 id 早已改为 `row-alpha`/`alpha-toggle`/`alpha-hint`，原样跑会直接抛异常），功能编号由「功能六」校正为「功能五」；文件头过期注释（`v0.4.2 验证用`、内核 `0.1.2-alpha.3`）一并更新，并补上 `DSH_SMOKE_URL` 环境变量入口与 SKIP 口径说明。
  - **扫尾 ④**：issue #1（v0.4.7「撤回异常」归因）技术上已在 v0.4.8 闭环（现象真实、归因证伪），本次核对后关闭。
  - **回归**：`npm run check` = 座位钉 **19/19** + compat-check **98/98** 全绿；`live-smoke.mjs` 语法与 SKIP 分支实跑通过（无 URL+token 时 exit 0，不阻塞 `npm run check`）。`package.json` 版本 `0.4.10 → 0.4.11`。只改 `lib/client.js` 的 CSS 段与文档/工具（客户端 bundle，**无构建步骤**），刷新页面即生效。
- **v0.4.10（历史）**：**把输入框的模型双按钮往右推、紧贴右侧的「听写」按钮**，并顺带修掉一个**潜伏的真实 bug**（该 bug 会让官方模型按钮不再被隐藏、与插件座位同时出现）。
  - **紧贴的实现（`lib/client.js` 的 `MSS_CSS`，纯 CSS、不动注册逻辑）**：官方 composer 右侧动作区的结构是 `div.trailing`（`gap:12px; margin-left:auto`）下并列 `div.standardControls`（座位所在的槽的父容器）、`div.activity`（听写按钮的槽）、`button.primary`（发送）。座位在 `.standardControls` 内，听写按钮在**兄弟容器** `.activity` 内 —— 纯 CSS 没有「叔侄选择器」，`:has()` 也只能向下或向兄弟，因此**无法直接互相定位**。可行做法是把座位的**父容器**连同座位一起推到最右、并把两个容器之间那段来自 `trailing` 的 `gap` 收掉：
    ```css
    div:has(> [data-mss-seat]) { margin-left: auto; }
    div:has(> div > [data-mss-seat]):has(+ div [aria-label="开始录音"]),
    div:has(> div > [data-mss-seat]):has(+ div [aria-label="Start recording"]) { column-gap: 0; }
    div:has(> div > [data-mss-seat]) + div:has([aria-label="开始录音"]),
    div:has(> div > [data-mss-seat]) + div:has([aria-label="Start recording"]) { margin-left: 0; }
    ```
  - **为什么用 `:has()` 而不写类名**：内核用 CSS Module，类名带哈希（当前是 `uV2eYG_trailing` / `uV2eYG_activity`），随每次构建变化；`aria-label` 是官方文案契约（中文 `开始录音` / 英文 `Start recording`，见 `dsh-experimental-client-ui-voice-input`），`data-mss-*` 是本插件自己的，两者都稳定。**降级**：浏览器不支持 `:has()` 时整段规则被丢弃，座位回到默认 `gap:12px`，只是「不够贴近」，不会错位或消失 —— 故不需 `@supports` 兜底。
  - **途中修掉的真实 bug（真机可见）**：隐藏官方模型按钮的规则写作 `${OFFICIAL_TRIG}` 内联进模板串，而该模板串**前面的说明注释里出现了反引号**，把 ECMAScript 模板串**提前闭合**，使 `${OFFICIAL_TRIG}` 原样留在生成的 CSS 里 → 选择器里出现一个不存在的 `$` 元素、**隐藏规则整条失效**，插件座位与官方控件会同时出现在输入框上。修法：说明注释里不再出现反引号；同时把含引号的选择器常量改为「拼接出来的两半」（`OFFICIAL_TRIG_A`/`OFFICIAL_TRIG_B`），避免模板串里出现裸引号触发的同类解析歧义。（`OFFICIAL_TRIG` 本身保留原样，供 `querySelectorAll` 使用。）
  - **新增守护断言 `tools/check-model-seat-hug.mjs`（14 条，已并入 `npm run check`）**：手写 DOM 骨架忠实复制内核 `InputBar` 层次（含听写按钮被 `span.triggerAnchor` 包裹这一实情），**求值**（而非只读取源码文本）`MSS_CSS` 模板串后用自写选择器匹配器核对：座位父容器拿到 `margin-left:auto`、横缝收到 0、`activity` 左边距清 0、中英两套文案都命中、无座位/听写缺席时不误伤、CSS 里无内核哈希类名、**且官方模型按钮仍被隐藏**。本仓库零依赖，不引入 jsdom。
  - **该断言的价值已被证明**：它先是抓出产出 CSS 里的一处真实 bug —— 规则写成 `:has(+ div > [aria-label=…])`（**直接子元素**）而真实听写按钮嵌在 `span` 内，导致贴合规则**永远不命中**；修正为**后代**匹配 `:has(+ div [aria-label=…])`。随后又通过「必须求值模板串」这一改动抓出上面那条 `${OFFICIAL_TRIG}` 未求值的真 bug（只读源码文本的写法会让该断言恒红，而求值写法能同时覆盖「模板串提前闭合」这类事故）。
  - **回归**：`npm run check` = 新钉 **14/14** + compat-check **93/93**，全绿。`package.json` 版本 `0.4.9 → 0.4.10`，`check` 脚本加入新钉。只改 `lib/client.js`（客户端 bundle，**无构建步骤**），刷新页面即生效。
- **v0.4.9（历史）**：**移除功能三「修改的文件」会话选项卡**（`conversation.view` / `ui-tools-modified-files`）。移除原因：① 它的取数是**同一份 chat target 快照的又一遍解析**，与功能五（速度计）读的是同一个 target，属于重复建设；② 维护成本集中在自己实现的 `run_code` 内嵌路径提取上——这套静态字符扫描只认字面量字符串路径，模板串、变量拼接、shell 级写操作（pwsh `Set-Content`/重定向、gitbash）全都解析不了，每次内核调整都要跟着修，收益与风险不成比例。
  - **删除范围**：`MFS_ZH`/`MFS_EN` 文案与 `MFS_NS` 命名空间、`MFS_MUTATIONS` 工具白名单、`RUN_CODE_TOOL`/`RUN_CODE_CALL_RE`、全部 `mfs*` 解析函数（`mfsReadQuoted`/`mfsMatchParen`/`mfsExtractKeyValues`/`mfsExtractRunCodePaths`/`mfsNormalizePath`/`mfsRecordMutation`/`collectModifiedFiles`/`mfsRelativeTo`）、`ModifiedFilesView` 组件与 `MFS_CSS`、`mfsSources` WeakMap 与 `mfsChatSource`、`ctx.uiSession.provide({ hooks: ["modifiedFiles"] })` 整块、`ctx.slots.inject("conversation.view", ...)` 整块注册（含 `workspaces.openPath` 打开链路）、偏好字段 `mfsCompact` 与设置页对应开关。
  - **`alphaFeatures` 子 fiber 保留、但收窄**：`inject` 由 `["uiConversation", "uiSession"]` 改为 **`["uiConversation"]`**——功能三移除后 `uiSession` 已无消费者（它只被 `provide` 用），继续声明只会让子 fiber 在「有 target 体系但没 `uiSession`」的内核上白白停在 PENDING。跨内核降级机制本身**完全未变**：旧内核上子 fiber 照旧静默 PENDING、入口 entry 照旧 ACTIVE、boot 审计照旧 0 失败、无横幅。共享常量 `MFS_CHAT_TARGET`/`MFS_EMPTY_CHAT` 保留（`tspChatSource` 仍在用）。
  - **偏好数据无需迁移**：`normalizePrefs` 是逐字段白名单，旧 localStorage 里残留的 `mfsCompact` 会被自然丢弃，**不写迁移代码、不升 key 版本**（`dsh-ui-tools:prefs:v1` 不变）。
  - **回归**：compat-check 同步删除功能三的 8 条断言，并把「功能三在旧内核缺席」这类**单向**断言换成三条**逆向钉**——「任何内核都不得注册 `conversation.view`」「`uiSession.provide` 永不被调用」「`workspaces.openPath` 永不被调用」——防止残留代码悄悄复活。合计 **115 → 113 断言全绿**（断言数因删除而减少，覆盖却更严）。**负向对照有效**：把 `alphaFeatures.inject` 改回 `["uiConversation", "uiSession"]` → 场景 C 出现 2 条 FAIL（子 fiber 停在 PENDING、功能五 pill 未到位），111/113、exit 1。`package.json` 版本 `0.4.8 → 0.4.9`；插件由六功能变为五功能。
- **v0.4.8（历史）**：针对 **issue #1**（「v0.4.7 未修复撤回异常：DSH 0.2.0-rc.1 上 4 个 loader entry 被级联击落」）做三项加固。**核实结论**：issue 的**现象描述真实**（确有撤回异常与同 bundle 级联击落），但**归因不成立** —— 其 crash log 采集于我安装 v0.4.7 **之前**（shell pid 14260 启动于 17:57，我的安装完成于 18:26），两份日志记录的**都是 v0.4.6 期间**的运行；19:08 之后（已装 v0.4.7）的两次启动**未再产生 crash log**。我进一步从 `app.asar` 提取 **0.2.0-rc.1 的真实 `dsh-client-ui-conversation`**，用它的真装配器驱动插件 Definition：`context.current` 在该版本**存在且语义未变**，v0.4.7 **通过**。故 issue 假设的「`context.current` 在 0.2.0 上失效」被证伪。
  - **① 修正矛盾注释**：`tspLiveDefinition` 的 doc 仍写「turn/end 置 ended，buildViewNode 随即返回 null」，与 v0.4.7 新不变量（返回同 key + hidden）直接打架，易误导后续维护者。已改为说明正确行为并标注旧写法为何危险。
  - **② 拆分防御分支（issue #1 的核心洞见，实为真问题）**：原写法把「内核未提供 `context.current`」与「确认从未物化」**合并成同一个 `previous = null`** —— 一旦内核换了字段形态，防御会**静默失效**、异常照旧复现而不留痕迹。现拆为 `canReadCurrent`（能否读到）与 `previous`（已知时上一帧节点）两个判据：**读不到时不敢断言「未物化」，一律保守返回同 key + hidden**（撤回异常的代价远大于多挂一帧隐藏节点），并只告警一次。
  - **③ 把 0.2.0-rc.1 纳入验证矩阵**：0b 的版本表原只列 21 个，**漏掉整条 0.1.7/0.2.0 线**，使「两种 semver 语义判决一致」断言**假绿**（旧区间在该 6 个版本上确有分流）；现补全为 **29 个已发布版本 + 3 个哨兵**。同时 B3 由「只测第一个内核」改为**逐内核遍历**，并新增 `app.asar` 来源 —— 桌面版大版本升级后真正生效的 client 包在 asar 内，`kernels/` 下可能没有对应版本，不读 asar 就等于让最需要验证的那版内核缺席（0.2.0-rc.1 正是如此）。
  - **engines.dsh 同步收紧**：`… || >=0.1.6-0` → `… || ^0.1.6-0 || ^0.1.7-0 || ^0.2.0-0 || >=0.3.0-0`（两处值一致）。旧写法对 `0.1.7-*`/`0.2.0-*` 预发布版在普通语义下全部漏判。
  - **回归**：compat-check **90 → 110 断言全绿**（B3 现在对 5 个内核各跑 5 条：`0.1.7-rc.2`/`0.1.7-alpha.1`/`0.1.6-alpha.2`/`0.1.5-rc.2`/`app.asar`）；新增「读不到 `context.current` 时保守返回 hidden」断言。**负向对照有效**：把防御分支退回合并写法 → 该断言 FAIL（109/110）。`package.json` 版本 `0.4.7 → 0.4.8`。
- **v0.4.7（历史）**：修复**功能六导致回合结束后界面不再刷新、后续发送的提问不显示**（真实内核回归，非渲染样式问题）。
  - **根因**：功能六的「生成中估算条」是自建 chat 节点 Definition（`token-speed-live`）。内核 `ConversationNodeAssembler.buildTargetUpserts()` 的判定是「上一帧 `context.current.get(target)` 非 null、本帧 `buildViewNode` 返回 `null`」→ 抛 `conversation Definition "token-speed-live" withdrew materialized target "chat"; return the same key with hidden visibility instead`。该异常从 `flush()` 冒出后**整条 chat 视图快照链停更**——界面表现为回合结束后不再刷新、之后每次提问都没有新消息出现（`0.1.6-alpha.2` 与 `0.1.7-alpha.1` 均已复现；`0.1.6` 起该校验即已存在，并非新内核新增行为，而是功能六自 v0.4.6 引入以来一直存在、在「本回合确实产生过可见输出」时触发）。
  - **关键难点（只看 `state` 修不干净的那一半）**：真机的流式增量是 **transient 记录**；回合收尾内核走 `settleAssistant()`，先 retire 全部 transient、再 `replayContext()` 重放 —— 状态被**倒推回 `firstTokenAt=null` / `estTokens=0`（并不是 `ended=true`）**。因此「`state.ended` / 无输出 → 返回 `null`」这种写法**照样触发撤回异常**。
  - **修复**：判据改用内核给的 **`context.current`（上一帧已物化的节点）**——只要它非空就返回**同 key** 节点、仅切 `visibility`；仅「从未物化且当前无数据」才返回 `null`（安全路径）。
  - **为什么此前没测出来**：① 真机流式的 `transient` + `settleAssistant` 路径未被任何测试覆盖；② 原有断言只调 `live.buildViewNode(...)` 纯函数、**从不传 `context.current`**，等于绕过了内核唯一的撤回判定依据；③ compat-check 用的是**假内核**，根本没实现该校验。
  - **回归加固**：新增 **场景 B3「功能六 × 真内核 ConversationNodeAssembler」**——从本机内核副本载入**真内核**装配器 + 真 bundle 截取的 Definition，按真机事件序列（durable 起止 + **transient 增量** + `settleAssistant`）逐帧驱动，断言全程不抛 withdrew、节点 `visible`↔`hidden` 正确切换、**多回合连续会话（后续提问）依旧刷新**；另补 4 条纯函数断言显式传 `context.current`。compat-check **78 → 89 断言全绿**；**负向对照有效**：把 `buildViewNode` 换回只看 `state` 的写法 → **8 条 FAIL**（含真内核 `settleAssistant` 抛 withdrew、后续提问全程抛错、visible 帧数 3→1）。`package.json` 版本 `0.4.6 → 0.4.7`。

- **v0.4.6（历史）**：新增**功能六「输出速度计 tok/s」**——回合结束后在官方「**用时 xx秒**」pill **左侧**常驻 `⚡42 tok/s`（无需点开「本轮用时和速度」弹窗），生成中在消息流末尾显示 `⚡≈ 25 tok/s 生成中估算`。精确值与内核同源同口径（`ΣoutputTokens ÷ Σ(firstTokenTime→completedTime)`，只计 timing 齐备的 step），生成中因内核流式期间不上报 token 数（`usage` chunk 被 `publication:"none"` 抑制）而按已输出字符折算并明确标注「≈ / 生成中估算」。**位置实现**：精确 pill 走 list 槽 `conversation.chat.assistant-actions`（`order: -10` → 紧贴「用时」左侧，渲染位即 `MessageIconActions.extraActions`）；生成中走官方 Definition 通道 `uiConversation.events.register` 自建 `token-speed-live` chat 节点 + `conversation.chat.node` 渲染器（**`turnTail` 槽在生成期间不渲染** —— 其数据源必须匹配到 `turn/end`，故不能用于实时）。排序锚点用大于任何真实 seq 的常量，避免节点跑到流式正文上方。设置页新增开关 `tokenSpeedEnabled`（默认开，旧内核下灰显）。**实现过程中被自测抓到并修复一处真实缺陷**：Definition 通道形状不符时原先直接抛出，会让整个 `alphaFeatures` 子 fiber FAIL、把「修改的文件」一起拖下水 —— 现改为形状探测 + 只让生成中那段缺席。回归：compat-check **49 → 77 断言全绿**（v0.4.7 起 89/89）（新增数值口径、除零/空入参边界、Definition 状态机全流程、两组件 DOM 与开关门控），负向对照有效（改坏锚点 / 去掉形状守卫各触发 FAIL）；真机 live-smoke 在 `0.1.6-alpha.2` 上通过（入口无横幅、功能标记在位、设置页开关正常，新增功能六断言）。**历史回合可能无读数属预期**：`firstTokenTime` 来自瞬态流式事件、不进持久化日志，重载页面后历史回合的 TPS 内核自身也不显示（同一口径）。`package.json` 版本 `0.4.5 → 0.4.6`。
- **v0.4.5（历史）**：新增**机器可读的内核版本约束** `engines.dsh`（同时写顶层与 `dsh.engines.dsh`，两者值一致），并修正 README 里「`0.1.2-alpha.1` 及更新」这一**在真实 semver 下不成立**的口径。背景：此前本包只在 README 与 `package.json` description 里用自然语言描述内核要求，没有任何字段可供工具读取——而生态实际消费的字段是 `engines.dsh`：`dshmarket` 的 `manifestFacts()` 读它（缺失时回落 `dsh.engines.dsh`），在 Discover 页展示宿主兼容性，并在**安装/更新前拒绝**判定为不兼容的版本。区间写成 `^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0 || >=0.1.6-0`：**不能**写成 `>=0.1.1-rc.1` 或 `>=0.1.2-alpha.1`——semver 要求预发布版只匹配**同 `x.y.z`** 区间，实测 `>=0.1.2-alpha.1` 不匹配 `0.1.5-rc.2`（本仓库当前实测内核），`>=0.1.1-rc.1` 也会漏掉 `0.1.2-*` / `0.1.5-*` 各线；逐条 `^0.1.N-0` 覆盖每条已发布线，末项 `>=0.1.6-0` 兜住后续新线且不硬顶未来内核（误判未来内核会让市场拒绝合法升级）。`-0` 后缀用于把下界取到该线最早的预发布。compat-check 新增场景 0b（6 条断言，合计 **49/49**）：用**内核自带真实 semver** 对 npm 上**全部 21 个**已发布内核版本 + 2 个未来哨兵逐项断言，并要求普通语义与市场侧 `includePrerelease` 语义判决一致（偏差即失败）。负向对照有效：把区间换回 `>=0.1.2-alpha.1` 触发 4 条 FAIL（含 `0.1.5-rc.2` 未被自身声明覆盖）。**未改动任何运行期逻辑**（`lib/client.js` 与 v0.4.4 逐字一致）；内核兼容行为与 v0.4.4 相同，当前实测内核 `0.1.5-rc.2`。
- **v0.4.4（历史）**：修复**功能一在 0.1.5-rc.1 内核上每次挂载会话抛一次 `cannot get property "remote.session" without inject`**。根因：内核 `ModelDirectoryResolver.directoryFor()` 内部要读 `this.ctx.remote.session` 构造 ModelDirectory，而 cordis 的 Service tracker 会把 service 的 `this.ctx` **重绑到调用方上下文**——所以调用方 fiber 必须自己声明 `remote`。本插件功能一的 `ctx.inject([...])` 只声明了 `slots/modelDirectories/sessions`，于是每次冷解析（新会话、会话切换）都抛未捕获错误；只因 `directoryFor` 开头有「已缓存则早返回」的短路，多数时候命中内核自建目录才没炸出可见故障（竞态相关）。修复：① 在该**子作用域**补声明 `remote` + `remote.session`（两者都要：后者是嵌套追踪服务，只补前者实测错误照旧；刻意都不进 loader entry 的 `inject`，否则会重新引入 v0.4.2 修掉的旧内核 entry 停 PENDING / 五功能全丢）；② 加 `mssResolveDirectory()` 兜底，解析失败不再冒泡成 pageerror，而是降级为「本座位不渲染 + 经 `html[data-ui-tools-model-seat="fallback"]` 把官方控件放回来」，避免「官方被 CSS 隐藏 + 插件座位缺席」两头皆空。同类语义对等插件 `dsh-vision-router` 已有防护代码。回归：compat-check 扩到**四场景 43 断言**（新增场景 D 用「内核不提供 remote」夹住依赖位置；功能一冷解析正向断言），live-smoke 新增 `remote.session` 与**座位真的渲染**两条真机断言（只断言「不报错」不够——兜底会把异常吞成 warn 并静默降级），并修复浏览器探测（原先只认 ms-playwright 写死路径，本机没装 Playwright 时静默 SKIP）。
- **v0.4.3（历史，已被 v0.4.9 移除）**：「修改的文件」支持 **run_code 内嵌工具调用路径提取**——当前 DSH agent 环境的文件操作全部包在 `run_code` 里（工具名恒为 `run_code`，路径藏在 `code` 字符串），旧逻辑按工具名白名单匹配导致这类会话一律显示「0 个文件」。新增 `mfsExtractRunCodePaths`：从 `code` 静态提取 `tools.edit/write/mkdir/move/copy/delete…` 内嵌调用的字面量路径（含字符串数组参数），按内嵌工具映射回白名单 ops，复用去重/徽标/打开链路。字符扫描解析（无正则拼接），反斜杠转义原样保留（Windows 路径不因 `\t`/`\n` 语义被改写）；变量拼接、模板串、shell 级写操作（pwsh `Set-Content`/重定向、gitbash）不计入。compat-check 新增对应断言（当时 33/33 全绿）。**v0.4.9 已随功能三整体删除**——正是这类易碎逻辑促成了移除决定。
- **v0.4.2（历史）**：内核版本自适应（软依赖 + 子 fiber 隔离），修复「切到 0.1.1-rc.x 旧内核后 Web UI 顶部 `Failed to load plugins` / `web boot: 1 entry did not activate` 横幅、桌面端反复重载」——根因是入口 `inject` 硬声明了 `0.1.2-alpha.1` 才有的 `uiConversation` / `uiSession`，旧内核无提供方 → 整个 entry 停在 PENDING 被 boot 审计判失败，其余功能一起丢。现在入口只声明五个跨内核服务，功能五（速度计）的整段注册搬进 `ctx.plugin(alphaFeatures)` 子 fiber（`alphaFeatures.inject` 承载该硬依赖；v0.4.9 前为 `uiConversation` + `uiSession`，功能三移除后收窄为 `uiConversation`），旧内核上子 fiber 静默停在 PENDING、其余四项照常；另加能力探测（子 fiber 激活即置位 `capability.alphaApi`）+ 设置页灰显提示「需内核 0.1.2-alpha.1+」+ 关键调用点形状探测与 try/catch 降级；新增 `tools/compat-check.mjs` 无头回归（真实 cordis，三场景）与 `npm run check`。行为与验收见[内核兼容矩阵](#内核兼容矩阵)。
- **v0.4.1（历史）**：按反馈移除 v0.4.0 的「composer 快捷命令条」——删除 `conversation.composer.dock` 注册、QCB 命名空间/CSS、偏好字段 `quickbarEnabled`/`quickbarItems` 及设置页快捷条编辑器；「DSH UI 工具」设置页保留（仅布局偏好：徽章开关 / 启动默认折叠 / 修改文件紧凑显示——后两项里「修改文件紧凑显示」已于 v0.4.9 随功能三移除），插件回归五功能。
- **v0.4.0（历史）**：新增「composer 快捷命令条」——注册进官方 `conversation.composer.dock`（list 加性，order 10），输入框下方一排常用命令 chip，点击 = `inputActions.setDraft` + `submit` 填入并发送，命令列表可在设置页自定义；新增「DSH UI 工具」设置页——注册进官方 `settings.section`（root list 槽，id `dsh-ui-tools`、order 100），集中开关四个既有功能 + 快捷命令条，「修改的文件」新增紧凑单行模式、侧边栏新增「启动默认折叠」偏好；全部偏好经 localStorage 持久化（`dsh-ui-tools:prefs:v1`，沿用 `dsh-better-sidebar` 同款社区惯例；官方 settings 命名空间需 host 侧注册 schema，本插件保持纯浏览器故不采用）。v0.4.1 起快捷命令条已移除。
- **v0.3.4（历史）**：修复 DSH 0.1.2-alpha.1 上「折叠/展开」工具条错位（与余额挤在一行、「展开全部」被裁剪）——旧 CSS 里硬编码的侧边栏哈希类名 `.hHd-Xa_footerActions` 已失效，且 renderer 给 slot 套的 `div[data-slot]` 是 `display:contents`（不参与布局），原 `:has` 换行规则命中也无效。改用**哈希无关**的 `[class*="footerActions"]{flex-wrap:wrap !important}` 命中真实布局容器，内核升级不再失效。
- **v0.3.3**：真正修复 DSH 0.1.2-alpha.1 上的加载失败（`Failed to load plugins` / `client-modules: require(...) missed the module table`）——client bundle **不再 require `@deepseek-ai/dsh-client-runtime/client`**：`resolveWorkspacePath` 按官方 `dsh-client-ui-chat` 的做法**内联进 bundle**，空快照 `MFS_EMPTY_CHAT` 代替 `EMPTY_CHAT_SNAPSHOT`（`MFS_EMPTY_CHAT` 在 v0.4.9 功能三移除后由速度计继续使用）。该内核的 client 模块表严格校验，runtime 未必是 profile 的 graph 行，v0.3.2 用 `dsh.client.inject` 登记的方案实测不生效（已回退）。
- **v0.3.2**：尝试用 `package.json` 的 `dsh.client.inject` 把 `@deepseek-ai/dsh-client-runtime` 登记进 client 模块表以解决加载失败，实测在 0.1.2-alpha.1 上不生效（runtime 非 graph 行时 inject 是 no-op），已被 v0.3.3 取代。
- **v0.3.1**：兼容 DSH 0.1.2-alpha.1 内核——该内核把会话内容迁到 target 体系，`useSession` 不再提供 `nodes`/`runningCalls`；功能三「修改的文件」（**v0.4.9 已移除**）当时改经 `ctx.uiConversation.binding(...).target("chat")` 读 `ChatSnapshot.legacy` 取数，并注册 `useModifiedFiles` 标准 hook，写法与官方 `dsh-client-ui-chat` 同构。其余功能所用槽位/服务在内核中未变。
- **v0.3.0**：新增功能三「会话标题旁工作区徽章」——注册进官方 `conversation.session.header.actions` 增量 list 槽，在会话页标题右侧显示所属工作区名，纯 slot 渲染不改源码。（该功能在 v0.3.0~v0.4.8 期间编号为「功能四」，v0.4.9 功能三移除后前移为功能三。）
- **v0.2.0**：新增「修改的文件」选项卡——注册进官方 `conversation.view` 开放槽，会话头部主选项卡区在「对话 / 轨迹」之后多出「修改的文件」，列出本会话改过的所有文件，点击经 Host 打开。**v0.4.9 已整体移除**（该功能在 v0.2.0~v0.4.8 期间编号为「功能三」）。
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
- 设置 → 插件 中的停用同样有效（六个功能同时关闭）。
- 彻底卸载：从 bundles 与 dependencies 移除条目、删除 node_modules 内链接与本地插件目录。

## 明确不覆盖的范围

- 输入框里输 `/model` 弹出的命令面板选择器走的是另一套 popupSelect 组件，本插件未涉及。
- 侧边栏折叠条只影响工作区分组展开状态，不改变其他侧边栏 UI。
- 偏好只存当前浏览器 localStorage，不会跨浏览器/跨设备同步。
- 插件只覆盖上面列出的六个功能；此前的「修改的文件」会话选项卡已在 v0.4.9 整体移除，其取数与速度计重复且维护成本过高（详见变更记录）。
