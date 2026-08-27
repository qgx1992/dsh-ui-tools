# dsh-ui-tools

DSH Web 插件：两个 UI 工具合并成一个包，只动对应控件，不改 DSH 任何一行源码。

## 功能一：模型选择双按钮（原 dsh-model-select-style）

把输入框官方的「模型选择」控件替换为**两个独立按钮**，两级联动：

1. **「供应商」按钮** —— 点击弹出供应商列表（如 DeepSeek / SiliconFlow / OpenRouter）；
2. 选中某供应商后，「模型」按钮亮起；
3. **「模型」按钮** —— 点击只列出**当前所选供应商**的模型，点选即切换；
4. 模型支持推理时，模型按钮显示 `模型名 · 推理等级`（如 `deepseek-chat · 高`），面板内带「推理等级」区可调节思考强度。

选择逻辑完全复用官方组件（同一份模型目录、同一套选择提交、错误 Toast），只是把入口从单个按钮拆成两个。

## 功能二：侧边栏工作区折叠/展开（原 dsh-workspace-collapse）

在侧边栏工作区列表下方渲染「折叠全部 / 展开全部」工具条（窄栏自动隐藏），一键折叠/展开所有工作区分组。

## 实现原理

- 官方模型组件照常注册在 `conversation.input.model`（数据/提交逻辑原样保留），用 CSS 隐藏官方触发按钮；
- 本插件通过 `modelDirectories` 服务读取同一份模型目录（groups = 供应商分组），注册到 `conversation.input.right`（list slot）追加双按钮；
- 选择模型/推理等级时调用官方 `directory.select(...)`，官方 store 同步更新，输入框状态与原生一致；
- 折叠条注册到 `sidebar.footer.action`，通过 DOM 提升到工作区列表下方（MutationObserver 保持位置）。

两个功能各自独立命名空间（locale / slot id / data-* 前缀），互不干扰。

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

- 临时停用：设置 → 插件 中停用本插件（两个功能同时关闭）。
- 彻底卸载：从 bundles 与 dependencies 移除条目、删除 node_modules 内链接与本地插件目录。

## 明确不覆盖的范围

- 输入框里输 `/model` 弹出的命令面板选择器走的是另一套 popupSelect 组件，本插件未涉及。
- 侧边栏折叠条只影响工作区分组展开状态，不改变其他侧边栏 UI。
