/**
 * dsh-ui-tools 浏览器端 bundle（单文件，经 __ModuleLoader__ 加载）。
 *
 * 两个 UI 工具合并：
 *   1. 模型选择双按钮（原 dsh-model-select-style）
 *      - 「供应商」按钮 → 供应商列表；「模型」按钮 → 该供应商的模型列表；
 *      - 模型支持推理时，模型按钮显示「模型名 · 推理等级」，面板内可调节；
 *      - 复用官方 modelDirectories 服务，官方组件数据/提交逻辑原样保留。
 *   2. 侧边栏工作区折叠/展开（原 dsh-workspace-collapse）
 *      - 在侧边栏底部动作区渲染「折叠全部 / 展开全部」工具条；
 *      - 纯 slot 渲染、不做 DOM 搬移（修复：旧实现用全局 MutationObserver
 *        搬节点会与框架渲染互相触发，导致渲染进程 100% CPU 卡死）。
 *
 * 两个功能各自独立命名空间（locale NS / slot id / data-* 前缀），互不干扰；
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
		const WC_BAR_SELECTOR = "[data-wc-collapse-bar]";
		const WC_CSS = [
			".wc-collapse-bar{display:flex;align-items:center;gap:4px;flex:0 0 auto;padding:4px 6px 6px;border-top:1px solid rgba(127,127,127,.14)}",
			"@supports (color:color-mix(in srgb,currentColor 10%,transparent)){.wc-collapse-bar{border-top-color:color-mix(in srgb,currentColor 12%,transparent)}}",
			".wc-collapse-bar>button{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;min-width:0;padding:0 8px;margin:0;border:none;border-radius:6px;background:transparent;color:inherit;opacity:.82;font:inherit;font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,opacity .12s ease}",
			".wc-collapse-bar>button:hover,.wc-collapse-bar>button:focus-visible{background:rgba(127,127,127,.16);opacity:1}",
			".wc-collapse-bar>button:active{background:rgba(127,127,127,.28)}",
			".wc-collapse-bar>button:focus-visible{outline:2px solid rgba(80,140,255,.75);outline-offset:1px}",
			".wc-collapse-bar .wc-ic{font-size:10px;line-height:1;opacity:.7;transform:translateY(1px)}"
		].join("");

		function CollapseBar(props) {
			const t = props.t || ((key) => key);
			react.useLayoutEffect(() => {
				if (typeof props.repositionNow === "function") props.repositionNow();
			}, []);
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
		 * apply：合并注册两个功能
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
				tag.textContent = MSS_CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "ui-tools: inject model-select styles");

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

			// 定位：工具条注册在 sidebar.footer.action（footer 动作区），渲染后把它搬进
			// 工作区列（列表下方、footer 上方），恢复 v0.1.0 的显示位置。
			// 安全实现：只观察 footer 宿主容器的 childList（不观察 document.body、无定时器）。
			// 框架重渲染把工具条放回 footer 时搬一次；搬动发生在工作区列，不会反过来触发
			// footer 观察器——不会形成 v0.1.0 那种互相触发的死循环。
			let columnNode = null;
			let footerHost = null;
			let observer = null;

			const positionBar = () => {
				const bar = document.querySelector(WC_BAR_SELECTOR);
				if (bar === null || !bar.isConnected) return;
				const parent = bar.parentElement;
				if (columnNode !== null && parent === columnNode) return; // 已在目标位置
				const footArea = parent === null ? void 0 : parent.parentElement;
				const column = footArea === void 0 ? void 0 : footArea.parentElement;
				if (column === void 0 || column === null) return;
				columnNode = column;
				if (footerHost === null) {
					footerHost = parent;
					if (observer === null) {
						observer = new MutationObserver(() => {
							const node = document.querySelector(WC_BAR_SELECTOR);
							if (node === null || !node.isConnected) return;
							const p = node.parentElement;
							if (columnNode !== null && p === columnNode) return;
							const area = p === null ? void 0 : p.parentElement;
							const col = area === void 0 ? void 0 : area.parentElement;
							if (col === void 0 || col === null || col !== columnNode) return;
							col.insertBefore(node, area);
						});
						observer.observe(footerHost, { childList: true });
					}
				}
				column.insertBefore(bar, footArea);
			};

			injectWcStyle();
			ctx.effect(() => () => {
				if (observer !== null) observer.disconnect();
				const style = document.getElementById(WC_STYLE_ID);
				if (style !== null) style.remove();
			}, "ui-tools: workspace-collapse position/style teardown");

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "ui-tools-workspace-collapse",
				locale: WC_NS,
				inject: () => ({
					collapseAll,
					expandAll,
					repositionNow: positionBar
				})
			}, CollapseBar));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
