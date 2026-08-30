/**
 * dsh-ui-tools 浏览器端 bundle（单文件，经 __ModuleLoader__ 加载）。
 *
 * 六个 UI 工具合并：
 *   1. 模型选择双按钮（原 dsh-model-select-style）
 *      - 「供应商」按钮 → 供应商列表；「模型」按钮 → 该供应商的模型列表；
 *      - 模型支持推理时，模型按钮显示「模型名 · 推理等级」，面板内可调节；
 *      - 复用官方 modelDirectories 服务，官方组件数据/提交逻辑原样保留。
 *   2. 侧边栏工作区折叠/展开（原 dsh-workspace-collapse）
 *      - 在侧边栏底部动作区渲染「折叠全部 / 展开全部」工具条；
 *      - 纯 slot 渲染、不做 DOM 搬移（修复：旧实现用全局 MutationObserver
 *        搬节点会与框架渲染互相触发，导致渲染进程 100% CPU 卡死）。
 *   3. 修改的文件选项卡（conversation.view 新增 tab，v0.2.0；v0.3.1 起兼容
 *     0.1.2-alpha.1 内核的 target 体系）
 *      - 在会话头部主选项卡区（对话 / 轨迹 之后）新增「修改的文件」；
 *      - 从会话内容的 chat target（ChatSnapshot.legacy）工具调用节点里提取
 *        edit / write / delete 等改文件操作所涉及的路径，去重后按工作区相对
 *        路径展示，点击经 Host 打开；
 *      - 注册进官方开放槽 conversation.view（与轨迹 tab 同一机制），
 *        头部 tab 栏 / 切换高亮 / 持久化全部由框架处理，不加任何源码改动。
 *   4. 会话标题旁工作区徽章（conversation.session.header.actions，v0.3.0）
 *      - 在会话页头部标题 cluster 内、面包屑标题右侧渲染「工作区名」徽章，
 *        一眼看出当前会话属于哪个工作区（与侧边栏分组标题同名）；
 *      - 注册进官方纯增量 list 槽 conversation.session.header.actions
 *        （session 作用域），标准 kit 自带 useWorkspaces，从
 *        workspaces.items 里按 sessionIds 反查当前会话的工作区 title；
 *      - 纯 slot 渲染，不搬 DOM、不改 DSH 源码，无占用冲突（该槽当前无
 *        其他插件占用，负数 order 让徽章排在交互动作之前紧贴标题）。
 *   5. composer 快捷命令条（conversation.composer.dock，v0.4.0）
 *      - 输入框下方渲染一排常用命令 chip，点击 = 填入草稿并立即提交
 *        （InputActions.setDraft + submit，官方标准 kit 注入）；
 *      - 启停与命令列表由偏好仓库控制（设置页可编辑），与官方 stats
 *        行（order 0）共存，本条目 order 10 排在后面；纯 slot 渲染。
 *   6. 插件设置页（settings.section，v0.4.0）
 *      - 官方设置中心新增「DSH UI 工具」页：集中开关四个既有功能 +
 *        快捷命令条，并支持编辑自定义命令列表（每行「标签||命令」）；
 *      - 偏好经 localStorage 持久化（host 侧 settings 命名空间需
 *        settings.register(ns, schema)，本插件保持纯浏览器，故沿用
 *        社区惯例 dsh-better-sidebar 同款 localStorage 存储）。
 *
 * 六个功能各自独立命名空间（locale NS / slot id / data-* 前缀），互不干扰；
 * 只动对应控件，不改 DSH 任何一行源码。
 */

window.__ModuleLoader__.load({
	id: "dsh-ui-tools",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const { useSyncExternalStore, useState, useEffect, useRef } = react;

		/* ═══ 内联工具（不 require 任何 DSH client 包）
		 * 0.1.2-alpha.1 起 client 模块表严格校验：@deepseek-ai/dsh-client-runtime
		 * 未必是 profile 的 graph 行（官方 dsh-client-ui-chat 也不 require 它，而是把
		 * resolveWorkspacePath 直接内联进自己的 bundle）。这里同样内联，避免加载期
		 * "missed the module table" 硬失败。
		 * ═══ */
		/** 把工作区相对路径解析成 Host 打开文件用的绝对路径（复制自官方 runtime；chat 同款）。 */
		function resolveWorkspacePath(cwd, path) {
			if (path.startsWith("/") || isWindowsStylePath(path)) return path;
			if (cwd === void 0 || cwd === "") return path;
			return `${cwd.replace(/[/\\]+$/, "")}/${path.replace(/^[/\\]+/, "")}`;
		}
		/** 盘符（C:\）或 UNC（\\）路径——Windows 绝对路径，不能被当相对路径拼。 */
		function isWindowsStylePath(value) {
			return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
		}

		const inject = ["slots", "modelDirectories", "sessions", "locale", "workspaces", "uiConversation", "uiSession"];

		/* ══════════════════════════════════════════════════════════════
		 * 功能一：模型选择双按钮（原 dsh-model-select-style）
		 * ══════════════════════════════════════════════════════════════ */

		const MSS_NS = "model-select-style";
		const MSS_ZH = {
			"seat.provider": "供应商",
			"seat.model": "模型",
			"seat.chooseProvider": "选择供应商",
			"seat.chooseModel": "选择模型",
			"seat.noProvider": "未选供应商",
			"seat.loading": "加载中…",
			"seat.empty": "暂无数据",
			"seat.selectHint": "请先选择供应商",
			"seat.effort": "推理等级",
			"seat.effortDefault": "Default"
		};
		const MSS_EN = {
			"seat.provider": "Provider",
			"seat.model": "Model",
			"seat.chooseProvider": "Select provider",
			"seat.chooseModel": "Select model",
			"seat.noProvider": "No provider",
			"seat.loading": "Loading…",
			"seat.empty": "No data",
			"seat.selectHint": "Choose a provider first",
			"seat.effort": "Reasoning effort",
			"seat.effortDefault": "Default"
		};

		const OFFICIAL_TRIG =
			'button[aria-haspopup="menu"][aria-label^="选择模型"], button[aria-haspopup="menu"][aria-label^="Select model"]';

		/**
		* 供应商 / 模型 双按钮座。
		*/
		function ModelSeatSplit(props) {
			const { available, directory, load, select, t } = props;
			const state = useSyncExternalStore((fn) => directory.subscribe(fn), () => directory.getSnapshot());

			const [open, setOpen] = useState(null);      // null | "provider" | "model"
			const [pickedProvider, setPickedProvider] = useState(null);
			const rootRef = useRef(null);

			const groups = state.groups || [];
			const current = state.current;
			const busy = state.status === "selecting";

			const currentProviderId =
				pickedProvider !== null && groups.some((g) => g.id === pickedProvider)
					? pickedProvider
					: current && groups.some((g) => g.id === current.provider)
						? current.provider
						: null;
			const currentProvider = groups.find((g) => g.id === currentProviderId) || null;
			const currentModel =
				current && currentProvider && current.provider === currentProviderId
					? currentProvider.models.find((m) => m.id === current.model) || null
					: null;

			useEffect(() => {
				if (available) load();
			}, [open, available, load]);

			if (!available) return null;

			useEffect(() => {
				if (open === null) return;
				const onDown = (event) => {
					if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(null);
				};
				document.addEventListener("mousedown", onDown);
				return () => document.removeEventListener("mousedown", onDown);
			}, [open]);

			const chooseProvider = (groupId) => {
				setPickedProvider(groupId);
				setOpen(null);
			};
			const chooseModel = (model) => {
				const selection = {
					provider: currentProviderId,
					model: model.id,
					...model.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: model.reasoning.defaultEffort }
				};
				select(selection).then(() => {
					setOpen(null);
				});
			};
			const chooseEffort = (effort) => {
				if (current === null || currentProvider === null) return;
				select({
					provider: currentProviderId,
					model: current.model,
					...effort === void 0 ? {} : { reasoningEffort: effort }
				}).then(() => {
					setOpen(null);
				});
			};

			// ── 推理等级（与官方 effort 面板同构）──
			const reasoning = currentModel?.reasoning;
			const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort;
			const effortLabel =
				reasoning === void 0
					? void 0
					: effectiveEffort === void 0
						? t("seat.effortDefault")
						: reasoning.efforts.find((l) => l.id === effectiveEffort)?.name ?? effectiveEffort;
			const effortChoices =
				reasoning === void 0
					? []
					: [
							...(reasoning.defaultEffort === void 0 ? [{ key: "default", effort: void 0, label: t("seat.effortDefault") }] : []),
							...reasoning.efforts.map((effort) => ({
								key: `effort:${effort.id}`,
								effort: effort.id,
								label: effort.name,
								...effort.description === void 0 ? {} : { description: effort.description }
							}))
						];

			const providerLabel = currentProvider ? currentProvider.name : t("seat.noProvider");
			const modelLabel = currentModel ? currentModel.name : currentProvider ? t("seat.chooseModel") : t("seat.selectHint");
			const modelBtnLabel = effortLabel === void 0 ? modelLabel : `${modelLabel} · ${effortLabel}`;

			const h = react.createElement;

			return h("div", { ref: rootRef, "data-mss-seat": "", style: { position: "relative" } }, [
				h("button", {
					"data-mss-btn": "",
					type: "button",
					"aria-expanded": open === "provider",
					"aria-haspopup": "listbox",
					title: t("seat.chooseProvider"),
					onClick: () => setOpen(open === "provider" ? null : "provider")
				}, [
					providerLabel,
					h("span", { className: "mss-caret" }, "▾")
				]),
				h("button", {
					"data-mss-btn": "",
					type: "button",
					"aria-expanded": open === "model",
					"aria-haspopup": "listbox",
					disabled: currentProvider === null || busy,
					title: currentProvider ? t("seat.chooseModel") : t("seat.selectHint"),
					onClick: () => setOpen(open === "model" ? null : "model")
				}, [
					modelBtnLabel,
					h("span", { className: "mss-caret" }, "▾")
				]),

				open === "provider" && h("div", { "data-mss-panel": "", role: "listbox" }, [
					state.status === "loading" && h("div", { className: "mss-loading" }, t("seat.loading")),
					state.status !== "loading" && groups.length === 0 && h("div", { className: "mss-empty" }, t("seat.empty")),
					...groups.map((g) =>
						h("button", {
							"data-mss-row": "",
							className: "mss-row",
							key: g.id,
							type: "button",
							role: "option",
							"aria-checked": currentProviderId === g.id,
							onClick: () => chooseProvider(g.id)
						}, [
							h("span", null, g.name),
							currentProviderId === g.id && h("span", { className: "mss-check" }, "✓")
						])
					)
				]),

				open === "model" && currentProvider !== null && h("div", { "data-mss-panel": "", role: "listbox" }, [
					h("div", { className: "mss-group-title" }, currentProvider.name),
					state.status === "loading" && h("div", { className: "mss-loading" }, t("seat.loading")),
					state.status !== "loading" && currentProvider.models.length === 0 && h("div", { className: "mss-empty" }, t("seat.empty")),
					...currentProvider.models.map((m) =>
						h("button", {
							"data-mss-row": "",
							className: "mss-row",
							key: m.id,
							type: "button",
							role: "option",
							disabled: busy,
							"aria-checked": current && current.provider === currentProviderId && current.model === m.id,
							onClick: () => chooseModel(m)
						}, [
							h("span", null, [
								m.name,
								m.description !== void 0 && h("span", { className: "mss-desc" }, m.description)
							]),
							current && current.provider === currentProviderId && current.model === m.id && h("span", { className: "mss-check" }, "✓")
						])
					),
					effortChoices.length > 0 && h("div", { className: "mss-effort-section" }, [
						h("div", { className: "mss-group-title" }, t("seat.effort")),
						...effortChoices.map((level) =>
							h("button", {
								"data-mss-row": "",
								className: "mss-row",
								key: level.key,
								type: "button",
								role: "option",
								disabled: busy,
								"aria-checked": effectiveEffort === level.effort,
								onClick: () => chooseEffort(level.effort)
							}, [
								h("span", null, [
									level.label,
									level.description !== void 0 && h("span", { className: "mss-desc" }, level.description)
								]),
								effectiveEffort === level.effort && h("span", { className: "mss-check" }, "✓")
							])
						)
					])
				])
			]);
		}

		const MSS_CSS = `
/* ═══ dsh-ui-tools · 模型选择双按钮 ═══ */
${OFFICIAL_TRIG} {
	display: none !important;
}
[data-mss-seat] {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}
[data-mss-btn] {
	position: relative;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	height: 28px;
	padding: 0 9px;
	border: none;
	border-radius: 8px;
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 8%, transparent);
	color: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary, #4176e6));
	font-size: 12px;
	font-weight: 500;
	line-height: 20px;
	cursor: pointer;
	white-space: nowrap;
	max-width: 200px;
	overflow: hidden;
	text-overflow: ellipsis;
	transition: background .16s cubic-bezier(.4, 0, .2, 1), box-shadow .16s cubic-bezier(.4, 0, .2, 1);
	outline: none;
	font-family: inherit;
}
[data-mss-btn]:hover:not(:disabled) {
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 16%, transparent);
}
[data-mss-btn]:focus-visible {
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 55%, transparent);
}
[data-mss-btn]:disabled {
	cursor: default;
	opacity: .55;
}
[data-mss-btn][aria-expanded="true"] {
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 16%, transparent);
}
[data-mss-btn] .mss-caret {
	color: inherit;
	opacity: .7;
	flex: none;
	transition: transform .16s cubic-bezier(.4, 0, .2, 1);
}
[data-mss-btn][aria-expanded="true"] .mss-caret {
	transform: rotate(180deg);
}
[data-mss-panel] {
	position: absolute;
	bottom: calc(100% + 6px);
	right: 0;
	z-index: 120;
	min-width: 200px;
	max-width: min(320px, 70vw);
	max-height: min(340px, 60vh);
	overflow: auto;
	background: color-mix(in srgb, var(--dsw-specific-menu, #fff) 90%, transparent);
	backdrop-filter: blur(14px) saturate(1.3);
	-webkit-backdrop-filter: blur(14px) saturate(1.3);
	border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08));
	border-radius: 12px;
	box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0,0,0,.16));
	padding: 4px;
	animation: mss-panel-in .16s cubic-bezier(.4, 0, .2, 1) ease-out;
	transform-origin: bottom right;
	color: var(--dsw-alias-label-primary, inherit);
}
@keyframes mss-panel-in {
	from { opacity: 0; transform: translateY(3px) scale(.98); }
	to   { opacity: 1; transform: none; }
}
[data-mss-panel] .mss-group-title {
	color: var(--dsw-alias-label-tertiary, #999);
	font-size: 11px;
	line-height: 18px;
	padding: 5px 8px 2px;
}
[data-mss-panel] .mss-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 6px 8px;
	border: none;
	border-radius: 8px;
	background: none;
	color: inherit;
	font: inherit;
	font-size: 13px;
	line-height: 20px;
	text-align: left;
	cursor: pointer;
	transition: background .16s cubic-bezier(.4, 0, .2, 1);
}
[data-mss-panel] .mss-row:hover:not(:disabled) {
	background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));
}
[data-mss-panel] .mss-row[aria-checked="true"] {
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 12%, transparent);
}
[data-mss-panel] .mss-row .mss-check {
	color: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary, #4176e6));
	flex: none;
	font-size: 14px;
}
[data-mss-panel] .mss-row .mss-desc {
	display: block;
	color: var(--dsw-alias-label-caption, #999);
	font-size: 11px;
	line-height: 16px;
}
[data-mss-panel] .mss-empty,
[data-mss-panel] .mss-loading {
	padding: 10px 8px;
	color: var(--dsw-alias-label-tertiary, #999);
	font-size: 12px;
	line-height: 18px;
}
[data-mss-panel] .mss-effort-section {
	margin-top: 4px;
	padding-top: 4px;
	border-top: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08));
}
`.trim();

		/* ══════════════════════════════════════════════════════════════
		 * 功能二：侧边栏工作区折叠/展开（原 dsh-workspace-collapse）
		 * ══════════════════════════════════════════════════════════════ */

		const WC_NS = "workspace-collapse";
		const WC_ZH = {
			"bar.label": "工作区视图",
			"action.collapse": "折叠全部",
			"action.expand": "展开全部",
			"action.collapse.title": "折叠所有工作区",
			"action.expand.title": "展开所有工作区"
		};
		const WC_EN = {
			"bar.label": "Workspace view",
			"action.collapse": "Collapse all",
			"action.expand": "Expand all",
			"action.collapse.title": "Collapse all workspaces",
			"action.expand.title": "Expand all workspaces"
		};

		const WC_STYLE_ID = "dsh-ui-tools-wc-collapse-style";
		const WC_CSS = [
			/* 与余额类插件（dsh-cost-meter 等）共用 sidebar.footer.action：让真实布局
			   父容器允许换行，工具条自动换到余额下方自己的整行——纯 CSS，不搬动 DOM。
			   注意：renderer 给 slot 套的 div[data-slot] 是 display:contents（不参与布局），
			   旧版 :has 规则命中它无效；真正参与布局的是侧边栏的 footer actions 容器，
			   其 CSS Modules 类名带哈希（旧 hHd-Xa_ / 新 Vr81yG_），故用 [class*="footerActions"]
			   做哈希无关匹配，内核升级不失效。 */
			"[class*=\"footerActions\"]{flex-wrap:wrap !important}",
			".wc-collapse-bar{display:flex;align-items:center;gap:4px;flex:1 1 100%;padding:4px var(--dsh-session-list-edge-inset,12px) 6px}",
			".wc-collapse-bar>button{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;min-width:0;padding:0 8px;margin:0;border:none;border-radius:6px;background:transparent;color:inherit;opacity:.82;font:inherit;font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,opacity .12s ease}",
			".wc-collapse-bar>button:hover,.wc-collapse-bar>button:focus-visible{background:rgba(127,127,127,.16);opacity:1}",
			".wc-collapse-bar>button:active{background:rgba(127,127,127,.28)}",
			".wc-collapse-bar>button:focus-visible{outline:2px solid rgba(80,140,255,.75);outline-offset:1px}",
			".wc-collapse-bar .wc-ic{font-size:10px;line-height:1;opacity:.7;transform:translateY(1px)}"
		].join("");

		function CollapseBar(props) {
			const t = props.t || ((key) => key);
			const h = react.createElement;
			const mk = (key, titleKey, labelKey, onClick, icon) => h("button", {
				key,
				type: "button",
				title: t(titleKey),
				"aria-label": t(titleKey),
				onClick
			}, [
				h("span", { className: "wc-ic", "aria-hidden": "true" }, icon),
				h("span", { className: "wc-label" }, t(labelKey))
			]);
			return h("div", {
				"data-wc-collapse-bar": "",
				className: "wc-collapse-bar",
				role: "toolbar",
				"aria-label": t("bar.label")
			}, [
				mk("collapse", "action.collapse.title", "action.collapse", props.collapseAll, "\u25BE"),
				mk("expand", "action.expand.title", "action.expand", props.expandAll, "\u25B8")
			]);
		}

		/* ══════════════════════════════════════════════════════════════
		 * 功能三：修改的文件选项卡（conversation.view 新增 tab）
		 * 原理同官方「轨迹」tab：注册进 conversation.view 开放槽，头部
		 * tab 栏自动出现、点击切换/高亮/持久化都由框架处理。
		 * 数据来源（0.1.2-alpha.1 起内核把会话内容迁到 target 体系）：
		 * useSession 只提供生命周期快照（无 nodes/runningCalls），节点在
		 * chat target——经 ctx.uiConversation.binding(...).target("chat")
		 * 读 ChatSnapshot，取 legacy.nodes（ConversationNode[]）与
		 * legacy.runningCalls（RunningToolCall[]）里的工具调用块
		 * (assistant.blocks[].kind === "tool-call") 与 tool-result 的
		 * call 头——只认会改文件的工具（edit/write/mkdir/delete/copy/
		 * move…），从 argsRaw JSON 里取路径并去重。
		 * ══════════════════════════════════════════════════════════════ */

		const MFS_NS = "modified-files";
		/** 会话内容 target 名：官方「对话」视图注册的 target（0.1.2-alpha.1 起）。 */
		const MFS_CHAT_TARGET = "chat";
		/** chat target 未就绪时的空快照（官方 dsh-client-ui-chat 内联同款；只含本视图读取的 legacy 字段）。 */
		const MFS_EMPTY_CHAT = { legacy: { nodes: [], runningCalls: [] } };
		const MFS_ZH = {
			"view.modifiedFiles": "修改的文件",
			"stats.count": "{count} 个文件",
			"state.loading": "加载中…",
			"state.empty": "本会话尚未修改任何文件",
			"state.noCwd": "文件在工作区根目录，未标注相对路径",
			"op.edit": "编辑",
			"op.write": "写入",
			"op.create": "新建",
			"op.delete": "删除",
			"op.move": "移动",
			"op.copy": "复制",
			"op.mkdir": "建目录",
			"a11y.open": "打开 {path}",
			"a11y.ops": "{path}：修改 {count} 次",
			"list.title": "本会话修改的文件"
		};
		const MFS_EN = {
			"view.modifiedFiles": "Modified files",
			"stats.count": "{count} files",
			"state.loading": "Loading…",
			"state.empty": "No files modified in this session yet",
			"state.noCwd": "Files live at the workspace root",
			"op.edit": "edit",
			"op.write": "write",
			"op.create": "create",
			"op.delete": "delete",
			"op.move": "move",
			"op.copy": "copy",
			"op.mkdir": "mkdir",
			"a11y.open": "Open {path}",
			"a11y.ops": "{path}: modified {count} times",
			"list.title": "Files modified in this session"
		};

		/* 会改动文件系统的工具 → 它的操作标签 + 从 args 提取路径的方式。
		   只收录明确的破坏性/写操作；read/glob/grep/list 等只读工具不在此列。 */
		const MFS_MUTATIONS = {
			edit: { ops: ["op.edit"], pathKeys: ["file_path"] },
			write: { ops: ["op.write"], pathKeys: ["file_path"] },
			mkdir: { ops: ["op.mkdir"], pathKeys: ["path", "dirs", "files"] },
			mkdirs: { ops: ["op.mkdir"], pathKeys: ["path", "dirs", "files"] },
			delete: { ops: ["op.delete"], pathKeys: ["path", "file_path"] },
			remove: { ops: ["op.delete"], pathKeys: ["path", "file_path"] },
			move: { ops: ["op.move"], pathKeys: ["source", "target"] },
			rename: { ops: ["op.move"], pathKeys: ["source", "target", "path"] },
			copy: { ops: ["op.copy"], pathKeys: ["source", "target"] }
		};

		/** 归一化路径用于去重（统一分隔符 + 小写，兼顾 Windows 大小写不敏感）。 */
		function mfsNormalizePath(path) {
			let out = String(path).replace(/\\/g, "/").trim();
			while (out.endsWith("/")) out = out.slice(0, -1);
			return out.toLowerCase();
		}

		/** 把一条工具调用里的改动路径收进结果 Map。 */
		function mfsRecordMutation(toolName, argsRaw, out) {
			if (typeof toolName !== "string") return;
			const recipe = MFS_MUTATIONS[toolName];
			if (recipe === void 0) return;
			let args;
			try {
				args = JSON.parse(argsRaw);
			} catch (error) {
				return;
			}
			if (args === null || typeof args !== "object" || Array.isArray(args)) return;
			for (const key of recipe.pathKeys) {
				const value = args[key];
				const rawList = Array.isArray(value) ? value : [value];
				for (const raw of rawList) {
					if (typeof raw !== "string" || raw.trim() === "") continue;
					const key2 = mfsNormalizePath(raw);
					let entry = out.get(key2);
					if (entry === void 0) {
						entry = { path: String(raw).replace(/\\/g, "/"), ops: new Map() };
						out.set(key2, entry);
					}
					for (const op of recipe.ops) {
						entry.ops.set(op, (entry.ops.get(op) ?? 0) + 1);
					}
				}
			}
		}

		/** 从会话快照（nodes + runningCalls）收集全部被修改的文件，按路径排序。 */
		function collectModifiedFiles(nodes, runningCalls) {
			const out = /* @__PURE__ */ new Map();
			for (const node of nodes ?? []) {
				if (node === null || node === void 0) continue;
				if (node.kind === "assistant") {
					for (const block of node.blocks ?? []) {
						if (block !== null && block !== void 0 && block.kind === "tool-call") {
							mfsRecordMutation(block.name, block.argsRaw, out);
						}
					}
				} else if (node.kind === "tool-result") {
					if (node.call !== null && node.call !== void 0) mfsRecordMutation(node.call.name, node.call.argsRaw, out);
				}
			}
			for (const call of runningCalls ?? []) {
				mfsRecordMutation(call.name, call.argsRaw, out);
			}
			return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		}

		/** 展示用相对路径：命中工作区 cwd 前缀则裁掉，否则原样返回。 */
		function mfsRelativeTo(cwd, path) {
			if (typeof cwd !== "string" || cwd.trim() === "") return path;
			const base = (cwd.endsWith("/") ? cwd : `${cwd}/`).toLowerCase();
			const lower = path.toLowerCase();
			if (lower === cwd.toLowerCase()) return "/";
			if (lower.startsWith(base)) return path.slice(base.length);
			return path;
		}

		/**
		* 「修改的文件」tab 主体。节点数据来自 chat target：useModifiedFiles
		* 标准 hook（apply 注册段里经 ctx.uiSession.provide 注入，与官方
		* useChat 同一机制）返回 ChatSnapshot，取 legacy.nodes/runningCalls；
		* openState 仍走 useSession 生命周期快照；cwd/openFile 由注册 inject
		* 注入；t 绑 MFS_NS。
		*/
		function ModifiedFilesView(props) {
			const { useModifiedFiles, useSession, cwd, openFile, t, prefs } = props;
			const h = react.createElement;

			const prefsState = usePrefs(prefs);
			const nodes = useModifiedFiles((s) => s?.legacy?.nodes);
			const runningCalls = useModifiedFiles((s) => s?.legacy?.runningCalls);
			const openState = useSession((s) => s.openState);
			const files = react.useMemo(() => collectModifiedFiles(nodes, runningCalls), [nodes, runningCalls]);
			const mfsOpTotal = (entry) => [...entry.ops.values()].reduce((sum, count) => sum + count, 0);

			if (openState === "loading") {
				return h("div", { "data-mfs-root": "" }, [h("div", { className: "mfs-state" }, t("state.loading"))]);
			}

			return h("div", { "data-mfs-root": "", className: prefsState.mfsCompact ? "mfs-compact" : void 0 }, [
				h("div", { className: "mfs-head" }, [
					h("span", { className: "mfs-title" }, t("list.title")),
					h("span", { className: "mfs-count" }, t("stats.count", { count: files.length }))
				]),
				files.length === 0
					? h("div", { className: "mfs-state" }, t("state.empty"))
					: h("ul", { className: "mfs-list" }, files.map((entry) => {
						const display = mfsRelativeTo(cwd, entry.path);
						const name = display.slice(display.lastIndexOf("/") + 1);
						const dir = display.slice(0, display.lastIndexOf("/") + 1);
						const opTotal = mfsOpTotal(entry);
						return h("li", { key: entry.path, className: "mfs-item" }, h("button", {
							type: "button",
							className: "mfs-file",
							title: t("a11y.ops", { path: display, count: opTotal }),
							"aria-label": t("a11y.open", { path: display }),
							onClick: () => {
								if (typeof openFile === "function") openFile(entry.path).catch(() => {});
							}
						}, [
							h("span", { className: "mfs-icon", "aria-hidden": "true" }, h("svg", { viewBox: "0 0 16 16", width: 14, height: 14, fill: "currentColor" }, h("path", { d: "M1.5 2.5h4l1.5 2h7.5v9h-13z" }))),
							h("span", { className: "mfs-text" }, [
								h("span", { className: "mfs-name" }, name),
								dir !== "" && !prefsState.mfsCompact && h("span", { className: "mfs-dir" }, dir)
							]),
							h("span", { className: "mfs-ops" }, [...entry.ops.entries()].map(([op, count]) =>
								h("span", { key: op, className: "mfs-op", "data-mfs-op": op }, count > 1 ? `${t(op)}×${count}` : t(op))
							))
						]));
					}))
			]);
		}

		const MFS_CSS = `
/* ═══ dsh-ui-tools · 修改的文件选项卡 ═══ */
[data-mfs-root] {
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: 100%;
	padding: 12px 16px;
	gap: 8px;
	overflow: auto;
	box-sizing: border-box;
}
[data-mfs-root] .mfs-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
	flex: none;
}
[data-mfs-root] .mfs-title {
	color: var(--dsw-alias-label-secondary, #5c6470);
	font-size: 12px;
	font-weight: 500;
	line-height: 18px;
}
[data-mfs-root] .mfs-count {
	color: var(--dsw-alias-label-caption, #8a919e);
	font-size: 11px;
	line-height: 16px;
}
[data-mfs-root] .mfs-state {
	color: var(--dsw-alias-label-tertiary, #a1a8b3);
	font-size: 13px;
	line-height: 20px;
	padding: 18px 0;
	text-align: center;
}
[data-mfs-root] .mfs-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
	flex: 1;
	min-height: 0;
}
[data-mfs-root] .mfs-item {
	min-width: 0;
}
[data-mfs-root] .mfs-file {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	min-width: 0;
	padding: 5px 6px;
	border: none;
	border-radius: 8px;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: background .12s ease;
}
[data-mfs-root] .mfs-file:hover {
	background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));
}
[data-mfs-root] .mfs-file:focus-visible {
	outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 55%, transparent);
	outline-offset: -2px;
}
[data-mfs-root] .mfs-icon {
	display: inline-grid;
	place-items: center;
	width: 18px;
	flex: none;
	color: var(--dsw-alias-label-caption, #8a919e);
}
[data-mfs-root] .mfs-text {
	min-width: 0;
	flex: 1 1 auto;
	overflow: hidden;
}
[data-mfs-root] .mfs-name {
	display: block;
	color: var(--dsw-alias-label-primary, #1f2329);
	font-size: 13px;
	line-height: 18px;
	font-weight: 500;
	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
}
[data-mfs-root] .mfs-dir {
	display: block;
	color: var(--dsw-alias-label-caption, #8a919e);
	font-size: 11px;
	line-height: 15px;
	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
}
[data-mfs-root] .mfs-ops {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	flex: none;
}
[data-mfs-root] .mfs-op {
	padding: 1px 6px;
	border-radius: 6px;
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 9%, transparent);
	color: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary, #4176e6));
	font-size: 11px;
	line-height: 16px;
	white-space: nowrap;
}
[data-mfs-root] .mfs-op[data-mfs-op="op.delete"] {
	background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64949) 10%, transparent);
	color: var(--dsw-alias-state-error-primary, #d64949);
}
[data-mfs-root] .mfs-op[data-mfs-op="op.move"] {
	background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d17d00) 10%, transparent);
	color: var(--dsw-alias-state-warning-primary, #d17d00);
}
[data-mfs-root] .mfs-op[data-mfs-op="op.copy"],
[data-mfs-root] .mfs-op[data-mfs-op="op.mkdir"] {
	background: color-mix(in srgb, var(--dsw-alias-label-secondary, #5c6470) 10%, transparent);
	color: var(--dsw-alias-label-secondary, #5c6470);
}
[data-mfs-root].mfs-compact .mfs-item {
	padding: 3px 6px;
}
[data-mfs-root].mfs-compact .mfs-name {
	font-size: 12px;
	line-height: 17px;
}
[data-mfs-root].mfs-compact .mfs-dir {
	display: none;
}
`.trim();

		/* ══════════════════════════════════════════════════════════════
		 * 功能四：会话标题旁工作区徽章（conversation.session.header.actions）
		 * 注册进官方纯增量 list 槽（session 作用域），渲染在会话页头部
		 * 标题 cluster 内、面包屑标题右侧——「标题旁」。标准 kit 自带
		 * useWorkspaces / sessionId，从 workspaces.items 按 sessionIds
		 * 反查当前会话所属工作区的 title（与侧边栏分组标题同名）。
		 * 纯 slot 渲染：不搬 DOM、不改源码；该槽当前无其他插件占用，
		 * 负数 order 让徽章排在交互动作之前、紧贴标题。
		 * ══════════════════════════════════════════════════════════════ */

		const WSC_NS = "workspace-chip";
		const WSC_ZH = {
			"chip.title": "所属工作区：{name}",
			"chip.empty": "未归入工作区"
		};
		const WSC_EN = {
			"chip.title": "Workspace: {name}",
			"chip.empty": "No workspace"
		};

		/**
		* 工作区徽章：在会话标题旁显示当前会话所属工作区名。
		* sessionId/useWorkspaces/t 由框架标准 kit 与注册 locale 提供。
		* 无匹配工作区（未分组会话 / 空白会话）时返回 null，不占位。
		*/
		function WorkspaceNameChip(props) {
			const { sessionId, useWorkspaces, t, prefs } = props;
			const h = react.createElement;
			const prefsState = usePrefs(prefs);
			if (!prefsState.chipEnabled) return null;
			const workspace = useWorkspaces((state) =>
				state.items.find((workspace) => workspace.sessionIds.includes(sessionId))
			);
			if (workspace === void 0 || workspace.title === void 0 || workspace.title === "") return null;
			const title = workspace.title;
			return h("span", {
				"data-wsc-chip": "",
				className: "wsc-chip",
				title: t("chip.title", { name: title }),
				"aria-label": t("chip.title", { name: title })
			}, [
				h("span", { className: "wsc-ic", "aria-hidden": "true" }, "\u25A6"),
				h("span", { className: "wsc-name" }, title)
			]);
		}

		const WSC_CSS = `
/* ═══ dsh-ui-tools · 会话标题旁工作区徽章 ═══ */
[data-wsc-chip] {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	max-width: 220px;
	min-width: 0;
	height: 20px;
	padding: 0 9px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 8%, transparent);
	color: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary, #4176e6));
	font-size: 11px;
	line-height: 20px;
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	vertical-align: middle;
	user-select: none;
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 14%, transparent);
}
[data-wsc-chip] .wsc-ic {
	flex: none;
	font-size: 9px;
	opacity: .75;
}
[data-wsc-chip] .wsc-name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}
`.trim();

		/* ══════════════════════════════════════════════════════════════
		 * 偏好仓库（localStorage，v0.4.0）
		 * 四个既有功能 + 快捷命令条的开关在这里集中管理。官方 settings
		 * 命名空间需要 host 侧 ctx.settings.register(ns, schema) 才能持久化
		 * （参考 ui-theme/src/index.ts 的 host 半部），本插件刻意保持纯
		 * 浏览器（index.js 空入口），因此沿用社区惯例（dsh-better-sidebar
		 * 同款 localStorage）：偏好仅本浏览器生效；如需跨端同步可后续
		 * 增加 host 半部迁移到 settings 文档。
		 * ══════════════════════════════════════════════════════════════ */

		const PREFS_KEY = "dsh-ui-tools:prefs:v1";
		const PREFS_DEFAULTS = Object.freeze({
			quickbarEnabled: true,
			quickbarItems: [
				{ label: "/plan on", text: "/plan on" },
				{ label: "/plan off", text: "/plan off" },
				{ label: "/model", text: "/model" }
			],
			chipEnabled: true,
			collapseDefaultCollapsed: false,
			mfsCompact: false
		});

		/** 归一整组快捷命令（label + text 都必须是非空字符串）。 */
		function normQuickbarItems(items) {
			if (!Array.isArray(items)) return null;
			const out = [];
			for (const item of items) {
				if (item === null || typeof item !== "object") continue;
				const label = typeof item.label === "string" ? item.label.trim() : "";
				const text = typeof item.text === "string" ? item.text.trim() : "";
				if (label === "" || text === "") continue;
				out.push({ label, text });
			}
			return out.length > 0 ? out : null;
		}

		/** 合并 user 覆盖与默认值，逐字段校验类型；坏数据回退默认。 */
		function normalizePrefs(partial) {
			const base = {
				...PREFS_DEFAULTS,
				quickbarItems: PREFS_DEFAULTS.quickbarItems.map((item) => ({ ...item }))
			};
			if (partial === null || typeof partial !== "object") return base;
			return {
				quickbarEnabled: typeof partial.quickbarEnabled === "boolean" ? partial.quickbarEnabled : base.quickbarEnabled,
				quickbarItems: normQuickbarItems(partial.quickbarItems) ?? base.quickbarItems,
				chipEnabled: typeof partial.chipEnabled === "boolean" ? partial.chipEnabled : base.chipEnabled,
				collapseDefaultCollapsed: typeof partial.collapseDefaultCollapsed === "boolean" ? partial.collapseDefaultCollapsed : base.collapseDefaultCollapsed,
				mfsCompact: typeof partial.mfsCompact === "boolean" ? partial.mfsCompact : base.mfsCompact
			};
		}

		/** 从 localStorage 读偏好（解析失败回退默认）。 */
		function readStoredPrefs() {
			try {
				const raw = localStorage.getItem(PREFS_KEY);
				if (raw === null) return normalizePrefs(null);
				return normalizePrefs(JSON.parse(raw));
			} catch (error) {
				return normalizePrefs(null);
			}
		}

		/** 极简响应式偏好仓库：useSyncExternalStore 可订阅，set 落盘本地。 */
		function createPrefsStore() {
			const listeners = /* @__PURE__ */ new Set();
			let state = readStoredPrefs();
			const emit = () => { for (const listener of listeners) listener(); };
			const persist = () => {
				try { localStorage.setItem(PREFS_KEY, JSON.stringify(state)); } catch (error) { /* 隐私模式等场景静默降级 */ }
			};
			return {
				getSnapshot: () => state,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => { listeners.delete(listener); };
				},
				set: (patch) => {
					state = normalizePrefs({ ...state, ...patch });
					persist();
					emit();
				},
				reset: () => {
					state = normalizePrefs(null);
					persist();
					emit();
				}
			};
		}

		/** 组件内订阅偏好快照（prefs 为 apply 期创建的单例仓库）。 */
		function usePrefs(prefs) {
			return useSyncExternalStore(prefs.subscribe, prefs.getSnapshot);
		}

		/* ══════════════════════════════════════════════════════════════
		 * 功能五：composer 快捷命令条（conversation.composer.dock，v0.4.0）
		 * 输入框下方渲染一排常用命令 chip，点击 = 填入草稿并立即提交
		 * （InputActions.setDraft + submit，官方标准 kit 注入）。启停与
		 * 命令列表由偏好仓库控制（设置页可编辑）；与官方 stats 行
		 * （order 0）共存，本条目 order 10 排在后面。纯 slot 渲染。
		 * ══════════════════════════════════════════════════════════════ */

		const QCB_NS = "quick-command-bar";
		const QCB_ZH = {
			"bar.label": "快捷命令",
			"hint.replace": "点击后在输入框填入并发送"
		};
		const QCB_EN = {
			"bar.label": "Quick commands",
			"hint.replace": "Click to fill the draft and send"
		};

		/**
		* 快捷命令条：输入框下方 chips，点击填入草稿并提交。
		* input/inputActions 由会话标准 kit 注入；t/prefs 由注册 inject 提供。
		*/
		function QuickCommandBar(props) {
			const { input, inputActions, t, prefs } = props;
			const h = react.createElement;
			const prefsState = usePrefs(prefs);
			if (!prefsState.quickbarEnabled) return null;
			const items = prefsState.quickbarItems;
			if (!Array.isArray(items) || items.length === 0) return null;
			const draft = input !== null && input !== void 0 ? input.draft ?? "" : "";
			return h("div", {
				"data-qcb-bar": "",
				className: "qcb-bar",
				role: "toolbar",
				"aria-label": t("bar.label"),
				title: t("hint.replace")
			}, items.map((item) => {
				const active = draft === item.text || draft.startsWith(item.text + " ");
				return h("button", {
					key: item.text,
					type: "button",
					className: active ? "qcb-chip qcb-active" : "qcb-chip",
					"aria-pressed": active,
					title: item.text,
					onClick: () => {
						if (typeof inputActions === "object" && inputActions !== null && typeof inputActions.setDraft === "function") {
							inputActions.setDraft(item.text);
							if (typeof inputActions.submit === "function") inputActions.submit();
						}
					}
				}, item.label);
			}));
		}

		const QCB_CSS = `
/* ═══ dsh-ui-tools · composer 快捷命令条 ═══ */
[data-qcb-bar] {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 6px;
	padding: 2px 0 6px;
	user-select: none;
}
[data-qcb-bar] .qcb-chip {
	display: inline-flex;
	align-items: center;
	height: 24px;
	padding: 0 10px;
	border: none;
	border-radius: 999px;
	background: color-mix(in srgb, var(--dsw-alias-label-secondary, #5c6470) 10%, transparent);
	color: var(--dsw-alias-label-primary, #1f2329);
	font: inherit;
	font-size: 12px;
	line-height: 24px;
	white-space: nowrap;
	cursor: pointer;
	transition: background .12s ease, color .12s ease;
}
[data-qcb-bar] .qcb-chip:hover,
[data-qcb-bar] .qcb-chip:focus-visible {
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 14%, transparent);
	color: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary, #4176e6));
}
[data-qcb-bar] .qcb-chip:focus-visible {
	outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 55%, transparent);
	outline-offset: 1px;
}
[data-qcb-bar] .qcb-chip.qcb-active {
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 12%, transparent);
	color: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary, #4176e6));
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 30%, transparent);
}
`.trim();

		/* ══════════════════════════════════════════════════════════════
		 * 功能六：插件设置页（settings.section，v0.4.0）
		 * 官方设置中心新增「DSH UI 工具」页：集中开关四个既有功能 +
		 * 快捷命令条，并支持编辑自定义命令列表（每行「标签||命令」）。
		 * 偏好经 localStorage 持久化（见偏好仓库说明）。settings.section
		 * 是 root 作用域 list 槽，注册 id/order/label 即出现在设置导航。
		 * ══════════════════════════════════════════════════════════════ */

		const SET_NS = "ui-tools-settings";
		const SET_ZH = {
			"nav.label": "DSH UI 工具",
			"group.quickbar": "快捷命令条",
			"quickbar.enabled": "在输入框下方显示快捷命令",
			"quickbar.items": "命令列表（每行一条：标签||命令）",
			"quickbar.itemsHint": "点击命令 = 填入输入框并立即发送",
			"quickbar.save": "保存命令",
			"quickbar.restore": "恢复默认命令",
			"group.layout": "布局偏好",
			"chip.enabled": "会话标题旁显示工作区徽章",
			"collapse.defaultCollapsed": "启动时默认折叠所有工作区分组",
			"mfs.compact": "「修改的文件」使用紧凑单行显示",
			"state.saved": "✓ 已保存",
			"a11y.toggle": "切换 {label}",
			"a11y.restore": "恢复默认命令列表"
		};
		const SET_EN = {
			"nav.label": "DSH UI Tools",
			"group.quickbar": "Quick command bar",
			"quickbar.enabled": "Show quick commands below the composer",
			"quickbar.items": "Commands (one per line: label||command)",
			"quickbar.itemsHint": "Clicking a command fills the draft and sends it",
			"quickbar.save": "Save commands",
			"quickbar.restore": "Restore default commands",
			"group.layout": "Layout preferences",
			"chip.enabled": "Show the workspace chip next to the session title",
			"collapse.defaultCollapsed": "Collapse all workspace groups on startup",
			"mfs.compact": "Use compact single-line rows in Modified files",
			"state.saved": "✓ Saved",
			"a11y.toggle": "Toggle {label}",
			"a11y.restore": "Restore default command list"
		};

		/** 设置页内一行开关。 */
		function SettingsToggleRow(props) {
			const h = react.createElement;
			const { label, checked, onChange, t } = props;
			return h("label", { className: "set-row", "data-set-row": "" }, [
				h("span", { className: "set-row-label" }, label),
				h("input", {
					type: "checkbox",
					className: "set-toggle",
					checked,
					"aria-label": t("a11y.toggle", { label }),
					onChange: (event) => onChange(event.target.checked)
				})
			]);
		}

		/** 命令列表编辑器：一行「标签||命令」，仅含命令文本的行视为标签=命令。 */
		function QuickbarEditor(props) {
			const { items, onSave, onReset, t } = props;
			const h = react.createElement;
			const [text, setText] = useState(items.map((item) => `${item.label}||${item.text}`).join("\n"));
			const [savedTick, setSavedTick] = useState(0);
			useEffect(() => {
				setText(items.map((item) => `${item.label}||${item.text}`).join("\n"));
			}, [items]);
			useEffect(() => {
				if (savedTick === 0) return;
				const timer = setTimeout(() => setSavedTick(0), 1600);
				return () => clearTimeout(timer);
			}, [savedTick]);
			const parseLines = (value) => {
				const out = [];
				for (const raw of value.split("\n")) {
					const line = raw.trim();
					if (line === "") continue;
					const sep = line.indexOf("||");
					if (sep === -1) { out.push({ label: line, text: line }); continue; }
					const label = line.slice(0, sep).trim();
					const text = line.slice(sep + 2).trim();
					if (label !== "" && text !== "") out.push({ label, text });
				}
				return out;
			};
			return h("div", { "data-set-quickbar": "", className: "set-quickbar" }, [
				h("textarea", {
					className: "set-textarea",
					rows: 4,
					spellCheck: false,
					"aria-label": t("quickbar.items"),
					value: text,
					onChange: (event) => { setText(event.target.value); setSavedTick(0); }
				}),
				h("div", { className: "set-quickbar-row" }, [
					h("button", {
						type: "button",
						className: "set-btn set-btn-primary",
						disabled: savedTick !== 0,
						onClick: () => { onSave(parseLines(text)); setSavedTick(Date.now()); }
					}, savedTick !== 0 ? t("state.saved") : t("quickbar.save")),
					h("button", {
						type: "button",
						className: "set-btn",
						title: t("a11y.restore"),
						onClick: () => { onReset(); setSavedTick(0); }
					}, t("quickbar.restore"))
				])
			]);
		}

		/**
		* 「DSH UI 工具」设置页主体。close 由设置外壳传入（本页不用，
		* 保持解构避免 eslint 类告警）；t/prefs 由注册 inject 提供。
		*/
		function UiToolsSettingsSection(props) {
			const { t, prefs } = props;
			const h = react.createElement;
			const p = usePrefs(prefs);
			return h("div", { "data-set-root": "", className: "set-root" }, [
				h("div", { className: "set-group" }, [
					h("div", { className: "set-group-title" }, t("group.quickbar")),
					h(SettingsToggleRow, {
						label: t("quickbar.enabled"),
						checked: p.quickbarEnabled,
						onChange: (value) => prefs.set({ quickbarEnabled: value }),
						t
					}),
					h("p", { className: "set-hint" }, t("quickbar.itemsHint")),
					h(QuickbarEditor, {
						items: p.quickbarItems,
						onSave: (items) => prefs.set({ quickbarItems: items }),
						onReset: () => prefs.set({ quickbarItems: PREFS_DEFAULTS.quickbarItems.map((item) => ({ ...item })) }),
						t
					})
				]),
				h("div", { className: "set-group" }, [
					h("div", { className: "set-group-title" }, t("group.layout")),
					h(SettingsToggleRow, {
						label: t("chip.enabled"),
						checked: p.chipEnabled,
						onChange: (value) => prefs.set({ chipEnabled: value }),
						t
					}),
					h(SettingsToggleRow, {
						label: t("collapse.defaultCollapsed"),
						checked: p.collapseDefaultCollapsed,
						onChange: (value) => prefs.set({ collapseDefaultCollapsed: value }),
						t
					}),
					h(SettingsToggleRow, {
						label: t("mfs.compact"),
						checked: p.mfsCompact,
						onChange: (value) => prefs.set({ mfsCompact: value }),
						t
					})
				])
			]);
		}

		const SET_CSS = `
/* ═══ dsh-ui-tools · 插件设置页 ═══ */
[data-set-root] {
	display: flex;
	flex-direction: column;
	gap: 18px;
	padding: 4px 2px 12px;
}
[data-set-root] .set-group {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
}
[data-set-root] .set-group-title {
	color: var(--dsw-alias-label-secondary, #5c6470);
	font-size: 13px;
	font-weight: 600;
	line-height: 20px;
}
[data-set-root] .set-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	min-width: 0;
	padding: 8px 10px;
	border-radius: 8px;
	background: var(--dsw-specific-surface-hover, rgba(127,127,127,.06));
	cursor: pointer;
}
[data-set-root] .set-row:hover {
	background: var(--dsw-specific-surface-active, rgba(127,127,127,.1));
}
[data-set-root] .set-row-label {
	color: var(--dsw-alias-label-primary, #1f2329);
	font-size: 13px;
	line-height: 20px;
}
[data-set-root] .set-toggle {
	width: 36px;
	height: 20px;
	flex: none;
	accent-color: var(--dsw-alias-brand-primary, #4176e6);
	cursor: pointer;
}
[data-set-root] .set-hint {
	margin: 0;
	color: var(--dsw-alias-label-caption, #8a919e);
	font-size: 12px;
	line-height: 18px;
}
[data-set-root] .set-quickbar {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
}
[data-set-root] .set-textarea {
	width: 100%;
	box-sizing: border-box;
	min-height: 96px;
	padding: 8px 10px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08));
	border-radius: 8px;
	background: transparent;
	color: var(--dsw-alias-label-primary, #1f2329);
	font: inherit;
	font-size: 12px;
	font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
	line-height: 20px;
	resize: vertical;
	outline: none;
}
[data-set-root] .set-textarea:focus {
	border-color: var(--dsw-alias-brand-primary, #4176e6);
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 25%, transparent);
}
[data-set-root] .set-quickbar-row {
	display: flex;
	align-items: center;
	gap: 8px;
}
[data-set-root] .set-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	height: 28px;
	padding: 0 12px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
	border-radius: 8px;
	background: transparent;
	color: var(--dsw-alias-label-primary, #1f2329);
	font: inherit;
	font-size: 12px;
	font-weight: 500;
	line-height: 1;
	cursor: pointer;
	transition: background .12s ease, border-color .12s ease;
}
[data-set-root] .set-btn:hover,
[data-set-root] .set-btn:focus-visible {
	border-color: var(--dsw-alias-brand-primary, #4176e6);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 8%, transparent);
}
[data-set-root] .set-btn-primary {
	border-color: transparent;
	background: var(--dsw-alias-brand-primary, #4176e6);
	color: var(--dsw-alias-brand-on, #fff);
}
[data-set-root] .set-btn-primary:hover,
[data-set-root] .set-btn-primary:focus-visible {
	border-color: transparent;
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 88%, #fff);
}
[data-set-root] .set-btn:disabled {
	opacity: .65;
	cursor: default;
}
`.trim();

		/* ══════════════════════════════════════════════════════════════
		 * apply：合并注册六个功能
		 * ══════════════════════════════════════════════════════════════ */

		function apply(ctx) {
			// ── 偏好仓库（v0.4.0，shared）──
			const prefs = createPrefsStore();

			// ── 功能一：模型选择双按钮 ──
			ctx.effect(() => {
				const tagId = "dsh-ui-tools/styles";
				if (typeof document === "undefined") return;
				const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`);
				if (existing !== null) return () => existing.remove();
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-ui-tools";
				tag.dataset.pluginCss = tagId;
				tag.textContent = MSS_CSS + MFS_CSS + WSC_CSS + QCB_CSS + SET_CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "ui-tools: inject model-select + modified-files + workspace-chip + quick-command-bar + settings styles");

			ctx.effect(() => ctx.locale.register(MSS_NS, { zh: MSS_ZH, en: MSS_EN }), "ui-tools: model-select dictionaries");
			const mssT = ctx.locale.bind(MSS_NS);

			ctx.inject(["slots", "modelDirectories", "sessions"], (scope) => {
				const models = scope.modelDirectories;
				const sessions = scope.sessions;

				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: "ui-tools-model-seat",
					locale: MSS_NS,
					inject: (sessionId) => {
						const directory = models.directoryFor(sessionId);
						const available = sessions.subagentAddress(sessionId) === void 0;
						return {
							available,
							directory: directory.store,
							load: () => {
								if (available) directory.load().catch(() => {});
							},
							select: (selection) => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
							t: mssT
						};
					}
				}, ModelSeatSplit));
			});

			// ── 功能二：侧边栏工作区折叠/展开 ──
			ctx.effect(() => ctx.locale.register(WC_NS, { zh: WC_ZH, en: WC_EN }), "ui-tools: workspace-collapse dictionaries");

			const setAllGroupsExpanded = (expanded) => {
				try {
					const entry = ctx.slots.entries("sidebar.workspaces")[0];
					if (entry === void 0) return;
					const host = ctx.slots.hostFace();
					const store = host.storeOf(entry, "root");
					if (store === void 0 || store.actions === void 0) return;
					const items = ctx.workspaces.list.getSnapshot().items || [];
					const keys = new Set();
					for (const workspace of items) {
						if (workspace && typeof workspace.workspaceId === "string" && workspace.workspaceId.length > 0) keys.add(workspace.workspaceId);
					}
					keys.add(""); // ungrouped bucket
					const tracked = store.getSnapshot().groupExpansion || {};
					for (const key of Object.keys(tracked)) keys.add(key);
					for (const key of keys) store.actions.setGroupExpanded(key, expanded);
				} catch (error) {
					console.error("[dsh-ui-tools] cannot toggle workspace groups:", error);
				}
			};

			const collapseAll = () => setAllGroupsExpanded(false);
			const expandAll = () => setAllGroupsExpanded(true);

			const injectWcStyle = () => {
				if (document.getElementById(WC_STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = WC_STYLE_ID;
				style.textContent = WC_CSS;
				document.head.appendChild(style);
			};

			// 定位：工具条注册在 sidebar.footer.action，官方渲染在 footer 顶部（紧贴工作区
			// 列表正下方），用 CSS 对齐列表内边距即可——不搬动 DOM。
			// 历史教训：v0.1.0 用全局 MutationObserver 搬节点、v0.1.2 用收窄观察器搬节点，
			// 都会与框架重渲染互相触发（框架把工具条放回 slot，观察器再搬走），渲染进程
			// 100% CPU 卡死。结论：绝不搬动 slot 渲染出来的节点。
			injectWcStyle();
			// 启动时「默认折叠」偏好：只在插件加载这一次生效（不追踪后续手动开关，
			// 用户手动切换是会话内的即时操作）。等一帧让侧边栏组合完成再执行。
			if (prefs.getSnapshot().collapseDefaultCollapsed) {
				setTimeout(() => {
					try {
						if (prefs.getSnapshot().collapseDefaultCollapsed) collapseAll();
					} catch (error) {
						/* 侧边栏未就绪时静默跳过 */
					}
				}, 0);
			}
			ctx.effect(() => () => {
				const style = document.getElementById(WC_STYLE_ID);
				if (style !== null) style.remove();
			}, "ui-tools: workspace-collapse style teardown");

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "ui-tools-workspace-collapse",
				locale: WC_NS,
				inject: () => ({
					collapseAll,
					expandAll
				})
			}, CollapseBar));

			// ── 功能三：「修改的文件」选项卡（v0.3.1 起兼容 0.1.2-alpha.1）──
			// 注册进官方开放槽 conversation.view（与「轨迹」tab 同一机制）：
			// 头部 tab 栏自动多出一个按钮（order 20 排在 chat=0、trajectory=10 之后），
			// 点击切换 / 高亮 / 会话内持久化全部由框架处理，不搬 DOM 不加源码改动。
			// 取数（0.1.2-alpha.1 起内核把会话内容迁到 target 体系）：useSession
			// 只给生命周期快照（无 nodes/runningCalls），节点在 chat target——
			// 经 ctx.uiConversation.binding(...).target("chat") 读 ChatSnapshot，
			// legacy.nodes / legacy.runningCalls 即旧 nodes/runningCalls 兼容投影。
			// 以下写法与官方 dsh-client-ui-chat 的 chatSource / uiSession.provide 同构。
			ctx.effect(() => ctx.locale.register(MFS_NS, { zh: MFS_ZH, en: MFS_EN }), "ui-tools: modified-files dictionaries");
			const mfsT = ctx.locale.bind(MFS_NS);

			const mfsSources = /* @__PURE__ */ new WeakMap();
			const mfsChatSource = (binding) => {
				let source = mfsSources.get(binding);
				if (source === void 0) {
					const target = ctx.uiConversation.binding(binding).target(MFS_CHAT_TARGET);
					source = {
						getSnapshot: () => target.getSnapshot() ?? MFS_EMPTY_CHAT,
						subscribe: (listener) => target.subscribe(listener)
					};
					mfsSources.set(binding, source);
				}
				return source;
			};
			// 注册会话级标准 hook useModifiedFiles（与官方 useChat 同一机制），
			// 仅本视图消费；hook 名带 mfs 语义避免与其它插件冲突。
			ctx.uiSession.provide({
				hooks: ["modifiedFiles"],
				resolve: (binding) => ({ hooks: { modifiedFiles: mfsChatSource(binding) } })
			});

			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "ui-tools-modified-files",
				order: 20,
				locale: MFS_NS,
				label: () => mfsT("view.modifiedFiles"),
				inject: (sessionId) => {
					// 与官方 chat 视图同一取数：从 sessions 列表快照拿会话 cwd，
					// openFile 用 Host 侧 workspaces.openPath 打开绝对路径。
					const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
					return {
						cwd,
						prefs,
						openFile: (filePath) => {
							if (typeof cwd !== "string" || cwd === "") return Promise.resolve();
							return ctx.workspaces.openPath(resolveWorkspacePath(cwd, filePath));
						}
					};
				}
			}, ModifiedFilesView));

			// ── 功能四：会话标题旁工作区徽章 ──
			// 注册进官方纯增量 list 槽 conversation.session.header.actions
			// （session 作用域）。标准 kit 自带 useWorkspaces/sessionId，
			// 组件内从 workspaces.items 反查会话所属工作区 title。
			// 负数 order：排在其它交互动作之前，紧贴标题。
			ctx.effect(() => ctx.locale.register(WSC_NS, { zh: WSC_ZH, en: WSC_EN }), "ui-tools: workspace-chip dictionaries");
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "ui-tools-workspace-chip",
				locale: WSC_NS,
				order: -100,
				inject: () => ({ prefs })
			}, WorkspaceNameChip));

			// ── 功能五：composer 快捷命令条 ──
			// 注册进官方开放槽 conversation.composer.dock（list 加性）：
			// 输入框下方与官方 stats 行（order 0）共存，本条目 order 10 排在后面。
			// 会话标准 kit 自动注入 input/inputActions；t/prefs 走 inject。
			ctx.effect(() => ctx.locale.register(QCB_NS, { zh: QCB_ZH, en: QCB_EN }), "ui-tools: quick-command-bar dictionaries");
			const qcbT = ctx.locale.bind(QCB_NS);
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "ui-tools-quick-command-bar",
				order: 10,
				locale: QCB_NS,
				inject: () => ({ t: qcbT, prefs })
			}, QuickCommandBar));

			// ── 功能六：插件设置页（settings.section）──
			// 注册进官方 settings.section 开放槽（root 作用域 list），
			// 设置中心导航出现「DSH UI 工具」页；偏好经 localStorage 持久化。
			ctx.effect(() => ctx.locale.register(SET_NS, { zh: SET_ZH, en: SET_EN }), "ui-tools: settings-page dictionaries");
			const setT = ctx.locale.bind(SET_NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-ui-tools",
				order: 100,
				label: () => setT("nav.label"),
				locale: SET_NS,
				inject: () => ({ t: setT, prefs })
			}, UiToolsSettingsSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
