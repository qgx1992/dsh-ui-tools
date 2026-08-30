# dsh-ui-tools

DSH Web 插件：五个 UI 工具合并成一个包，只动对应控件，不改 DSH 任何一行源码。

## 功能一：模型选择双按钮（原 dsh-model-select-style）

把输入框官方的「模型选择」控件替换为**两个独立按钮**，两级联动：

1. **「供应商」按钮** —— 点击弹出供应商列表（如 DeepSeek / SiliconFlow / OpenRouter）；
2. 选中某供应商后，「模型」按钮亮起；
3. **「模型」按钮** —— 点击只列出**当前所选供应商**的模型，点选即切换；
4. 模型支持推理时，模型按钮显示 `模型名 · 推理等级`（如 `deepseek-chat · 高`），面板内带「推理等级」区可调节思考强度。

选择逻辑完全复用官方组件（同一份模型目录、同一套选择提交、错误 Toast），只是把入口从单个按钮拆成两个。

## 功能二：侧边栏工作区折叠/展开（原 dsh-workspace-collapse）

在侧边栏**工作区列表下方**渲染「折叠全部 / 展开全部」工具条，一键折叠/展开所有工作区分组（纯 slot 渲染 + CSS 对齐，不搬动 DOM）。

## 功能三：会话主选项卡「修改的文件」（v0.2.0 新增；v0.3.1 起兼容 DSH 0.1.2-alpha.1）

在会话头部主选项卡区（**对话 / 轨迹**之后）新增第三个选项卡 **「修改的文件」**，列出**当前会话改动过的所有文件**：

- 数据来自会话内容的 **chat target**（`ChatSnapshot.legacy` 的 `nodes` + `runningCalls`，即内核 target 体系下的 `assistant.blocks` 的 `tool-call` + `tool-result` 的 call 头 + 运行中的 `runningCalls`）；
- 只认会改动文件系统的工具（`edit` / `write` / `mkdir` / `delete` / `move` / `copy` / `rename` 等），从 `argsRaw` JSON 里提取路径并去重（统一分隔符 + 小写，兼容 Windows 大小写不敏感）；
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
- 偏好经 **localStorage** 持久化（`dsh-ui-tools:prefs:v1`），刷新/重启后保持。

> 存储说明：官方 settings 命名空间需要 host 侧 `ctx.settings.register(ns, schema)` 声明 schema 才能持久化（参考 `ui-theme/src/index.ts`）；本插件刻意保持纯浏览器（`lib/index.js` 空入口、不引入 host 依赖与 schema 校验风险），故沿用浏览器插件社区惯例（同款 `dsh-better-sidebar`）的 localStorage。偏好仅当前浏览器生效；如需跨端/跨浏览器同步，可后续增加 host 半部迁移到 settings 文档。

**实现原理**：注册进官方 **`settings.section`**（root 作用域 list 槽），`id: "dsh-ui-tools"`、`order: 100`、`label` 走双语文案，设置导航自动出现该页。页面组件订阅同一个 localStorage 偏好仓库（`useSyncExternalStore`），所有开关写入即落盘；四个既有功能在 `apply()` 里注入同一偏好仓库：徽章/修改文件组件渲染时读开关，侧边栏折叠条在插件加载时按「默认折叠」偏好执行一次。

## 实现原理

- 官方模型组件照常注册在 `conversation.input.model`（数据/提交逻辑原样保留），用 CSS 隐藏官方触发按钮；
- 本插件通过 `modelDirectories` 服务读取同一份模型目录（groups = 供应商分组），注册到 `conversation.input.right`（list slot）追加双按钮；
- 选择模型/推理等级时调用官方 `directory.select(...)`，官方 store 同步更新，输入框状态与原生一致；
- 折叠条注册到 `sidebar.footer.action`——官方渲染位置就是 footer 顶部、紧贴工作区列表正下方，用 CSS（对齐 `--dsh-session-list-edge-inset` 内边距）贴合列表即可，**不搬动 DOM**。搬动 slot 渲染出来的节点会与框架重渲染互相触发，导致渲染进程 100% CPU 卡死（v0.1.0 全局观察器、v0.1.2 收窄观察器均因此卡死；v0.1.3 起彻底不搬）。
- 修改的文件 tab 注册进 `conversation.view`；节点数据经 `ctx.uiConversation.binding(...).target("chat")` 读 chat target，并通过 `ctx.uiSession.provide` 暴露 `useModifiedFiles` 标准 hook 给视图消费（与官方「对话」/「轨迹」同构）。
- 工作区徽章注册进 `conversation.session.header.actions`（见功能四）。
- 设置页注册进 `settings.section`（见功能五）；所有偏好走 apply 期创建的一次性 localStorage 偏好仓库，组件经 `useSyncExternalStore` 订阅。

五个功能各自独立命名空间（locale / slot id / data-* 前缀），互不干扰。

## 变更记录

- **v0.4.1（本次）**：按反馈移除 v0.4.0 的「composer 快捷命令条」——删除 `conversation.composer.dock` 注册、QCB 命名空间/CSS、偏好字段 `quickbarEnabled`/`quickbarItems` 及设置页快捷条编辑器；「DSH UI 工具」设置页保留（仅布局偏好：徽章开关 / 启动默认折叠 / 修改文件紧凑显示），插件回归五功能。
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
