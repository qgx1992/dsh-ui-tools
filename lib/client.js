/**
 * dsh-ui-tools 浏览器端 bundle（单文件，经 __ModuleLoader__ 加载）。
 *
 * 三个 UI 工具合并：
 *   1. 模型选择双按钮（原 dsh-model-select-style）
 *      - 「供应商」按钮 → 供应商列表；「模型」按钮 → 该供应商的模型列表；
 *      - 模型支持推理时，模型按钮显示「模型名 · 推理等级」，面板内可调节；
 *      - 复用官方 modelDirectories 服务，官方组件数据/提交逻辑原样保留。
 *   2. 侧边栏工作区折叠/展开（原 dsh-workspace-collapse）
 *      - 在侧边栏底部动作区渲染「折叠全部 / 展开全部」工具条；
 *      - 纯 slot 渲染、不做 DOM 搬移（修复：旧实现用全局 MutationObserver
 *        搬节点会与框架渲染互相触发，导致渲染进程 100% CPU 卡死）。
 *   3. 修改的文件选项卡（conversation.view 新增 tab，v0.2.0）
 *      - 在会话头部主选项卡区（对话 / 轨迹 之后）新增「修改的文件」；
 *      - 从会话快照的工具调用节点里提取 edit / write / delete 等改文件
 *        操作所涉及的路径，去重后按工作区相对路径展示，点击经 Host 打开；
 *      - 注册进官方开放槽 conversation.view（与轨迹 tab 同一机制），
 *        头部 tab 栏 / 切换高亮 / 持久化全部由框架处理，不加任何源码改动。
 *
 * 三个功能各自独立命名空间（locale NS / slot id / data-* 前缀），互不干扰；
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
		const runtimeClient = require("@deepseek-ai/dsh-client-runtime/client");

		const inject = ["slots", "modelDirectories", "sessions", "locale", "workspaces"];

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
			/* 与余额类插件（dsh-cost-meter 等）共用 sidebar.footer.action：让容器允许换行，
			   工具条占满整行，自动换到余额下方自己的行——纯 CSS，不搬动 DOM。 */
			"div:has(> [data-wc-collapse-bar]){flex-wrap:wrap;flex:1 1 100%}",
			".hHd-Xa_footerActions{flex-wrap:wrap}",
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
		 * 数据来源：ConversationSnapshot.nodes 里的工具调用块
		 * (assistant.blocks[].kind === "tool-call") 与 tool-result 的
		 * call 头，以及 runningCalls——只认会改文件的工具（edit/write/
		 * mkdir/delete/copy/move…），从 argsRaw JSON 里取路径并去重。
		 * ══════════════════════════════════════════════════════════════ */

		const MFS_NS = "modified-files";
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
		* 「修改的文件」tab 主体。标准 conversation.view props 提供 useSession
		* （快照选择器）；cwd/openFile 由注册 inject 注入；t 绑 MFS_NS。
		*/
		function ModifiedFilesView(props) {
			const { useSession, cwd, openFile, t } = props;
			const h = react.createElement;

			const nodes = useSession((s) => s.nodes);
			const runningCalls = useSession((s) => s.runningCalls);
			const openState = useSession((s) => s.openState);
			const files = react.useMemo(() => collectModifiedFiles(nodes, runningCalls), [nodes, runningCalls]);
			const mfsOpTotal = (entry) => [...entry.ops.values()].reduce((sum, count) => sum + count, 0);

			if (openState === "loading") {
				return h("div", { "data-mfs-root": "" }, [h("div", { className: "mfs-state" }, t("state.loading"))]);
			}

			return h("div", { "data-mfs-root": "" }, [
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
								dir !== "" && h("span", { className: "mfs-dir" }, dir)
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
`.trim();

		/* ══════════════════════════════════════════════════════════════
		 * apply：合并注册三个功能
		 * ══════════════════════════════════════════════════════════════ */

		function apply(ctx) {
			// ── 功能一：模型选择双按钮 ──
			ctx.effect(() => {
				const tagId = "dsh-ui-tools/styles";
				if (typeof document === "undefined") return;
				const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`);
				if (existing !== null) return () => existing.remove();
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-ui-tools";
				tag.dataset.pluginCss = tagId;
				tag.textContent = MSS_CSS + MFS_CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "ui-tools: inject model-select + modified-files styles");

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

			// ── 功能三：「修改的文件」选项卡 ──
			// 注册进官方开放槽 conversation.view（与「轨迹」tab 同一机制）：
			// 头部 tab 栏自动多出一个按钮（order 20 排在 chat=0、trajectory=10 之后），
			// 点击切换 / 高亮 / 会话内持久化全部由框架处理，不搬 DOM 不加源码改动。
			ctx.effect(() => ctx.locale.register(MFS_NS, { zh: MFS_ZH, en: MFS_EN }), "ui-tools: modified-files dictionaries");
			const mfsT = ctx.locale.bind(MFS_NS);

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
						openFile: (filePath) => {
							if (typeof cwd !== "string" || cwd === "") return Promise.resolve();
							return ctx.workspaces.openPath((0, runtimeClient.resolveWorkspacePath)(cwd, filePath));
						}
					};
				}
			}, ModifiedFilesView));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
