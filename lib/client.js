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
 *   5. 插件设置页（settings.section，v0.4.0；v0.4.1 起为第五个功能）
 *      - 官方设置中心新增「DSH UI 工具」页：集中开关各功能的偏好
 *        （徽章 / 启动默认折叠 / 修改文件紧凑显示 / 输出速度计）；
 *      - 偏好经 localStorage 持久化（host 侧 settings 命名空间需
 *        settings.register(ns, schema)，本插件保持纯浏览器，故沿用
 *        社区惯例 dsh-better-sidebar 同款 localStorage 存储）。
 *   6. 输出速度计 tok/s（v0.4.6；见下方「功能六」整段注释）
 *      - 回合结束后：精确 tok/s 常驻在官方「用时」pill 左侧
 *        （注册进 conversation.chat.assistant-actions，order -10）；
 *      - 生成中：消息流末尾显示带「≈ / 生成中估算」标注的估算值
 *        （自建 token-speed-live chat 节点，走 uiConversation.events.register）。
 *
 * 内核自适应（v0.4.2，方案 B：软依赖 + 子 fiber 隔离）：
 *   功能三的取数依赖 0.1.2-alpha.1 才引入的 client target 体系服务
 *   uiConversation / uiSession，0.1.1-rc.x 的 store 里没有它们的提供方。
 *   这两个硬依赖不再写在 loader entry 的 inject 上（否则旧内核整个 entry
 *   停在 PENDING，被 boot 末尾只遍历 ctx.loader.entries() 的审计判失败 →
 *   「web boot: 1 entry did not activate」+ Failed to load plugins 横幅，
 *   六个功能一起丢），而是收进 ctx.plugin(alphaFeatures) 子 fiber：
 *   新内核六功能齐备；旧内核静默降级为四项（子 fiber 停在 PENDING，
 *   不执行函数体、不进审计、无横幅），设置页里功能三/六的开关灰显并提示
 *   所需内核。设计文档：DSH-Exoskeleton docs/UI-TOOLS-KERNEL-ADAPT-DESIGN.md。
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

		/**
		 * 入口层（loader entry fiber）只声明「所有受支持内核都有」的服务。
		 * v0.4.2：`uiConversation` / `uiSession` 是 0.1.2-alpha.1 才引入的
		 * client target 体系服务，0.1.1-rc.x 的 store 里没有提供方——写在
		 * 这里会让整个 entry 停在 PENDING，被 boot 末尾的 loader entry 审计
		 * 判为失败（`web boot: 1 entry did not activate` → Failed to load
		 * plugins 横幅，五个功能一起没了）。故把它们收敛到 alphaFeatures
		 * 子 fiber 的 inject（见下方「功能三注册」），旧内核静默降级。
		 */
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

		/** 座位降级时给 ModelSeatSplit 的中性目录快照（身份稳定，否则 uSES 会循环重渲染）。 */
		const MSS_EMPTY_STATE = Object.freeze({ groups: [], current: null, status: "idle", routable: null });
		const MSS_EMPTY_DIRECTORY = {
			subscribe: () => () => {},
			getSnapshot: () => MSS_EMPTY_STATE
		};

		/** 置位/清除「座位建不出来」标记——官方触发按钮的恢复规则（见 MSS_CSS）以此为条件。 */
		function mssSetSeatFallback(on) {
			if (typeof document === "undefined") return;
			const root = document.documentElement;
			if (root === void 0) return;
			if (on) root.dataset.uiToolsModelSeat = "fallback";
			else if (root.dataset.uiToolsModelSeat === "fallback") delete root.dataset.uiToolsModelSeat;
		}

		/**
		 * 冷调 `modelDirectories.directoryFor()` 的取值与兜底（v0.4.4）。
		 *
		 * 为什么需要 `remote` + `remote.session`：内核 `ModelDirectoryResolver.directoryFor()`
		 * 内部要读 `this.ctx.remote.session` 来构造 ModelDirectory；而 cordis 的 Service tracker
		 * 会把 service 的 `this.ctx` **重绑到调用方上下文**，因此调用方自己的 fiber 必须声明这
		 * 两个名字。注意 `remote.session` 是**嵌套追踪服务**，只声明 `remote` 仍会在取 `.session`
		 * 时抛 `cannot get property "remote.session" without inject`（实测：补 `remote` 后错误
		 * 照旧，补 `remote.session` 才消除）。内核 `ModelDirectoryResolver.static inject` 列的就是
		 * `["sessions", "remote", "remote.session"]`，可直接对照。
		 *
		 * 兜底：解析失败时不再让异常冒泡成未捕获 pageerror，而是降级为「本座位不渲染 +
		 * 把官方控件放回来」，避免出现「官方被 CSS 隐藏、插件座位又缺席」两头皆空。
		 */
		function mssResolveDirectory(models, sessionId) {
			try {
				const directory = models.directoryFor(sessionId);
				if (directory === void 0 || directory.store === void 0) throw new TypeError("directoryFor returned no store");
				mssSetSeatFallback(false);
				// 闭包持有实例，保留方法接收者（不能把 directory.load 直接摘出来传）。
				return {
					ok: true,
					directory: directory.store,
					load: () => directory.load(),
					select: (selection) => directory.select(selection)
				};
			} catch (error) {
				console.warn("[dsh-ui-tools] model directory unavailable; falling back to the official control:", error);
				mssSetSeatFallback(true);
				return {
					ok: false,
					directory: MSS_EMPTY_DIRECTORY,
					load: () => Promise.resolve(),
					select: () => Promise.resolve(false)
				};
			}
		}

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
/* 兜底：本插件的座位建不出来时（directoryFor 解析失败）把官方控件放回来，
   否则「官方被隐藏 + 插件座位缺席」会让模型选择器彻底消失。
   该规则必须排在隐藏规则之后：两者特异性相同，靠源码顺序取胜。 */
html[data-ui-tools-model-seat="fallback"] ${OFFICIAL_TRIG} {
	display: inline-flex !important;
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
		 * tab 栏自动出现、点击切换/高亮/持久化都由框架处理。本段只放
		 * **与内核无关**的纯逻辑（提取路径、渲染、样式）；依赖 target
		 * 体系的**注册段**在下方 alphaFeatures 子 fiber（v0.4.2）。
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

		/** run_code 是当前 DSH agent 环境的唯一执行入口：所有工具调用都包在它的
		 *  code 字符串里（tools.write({ file_path }) 等）。MFS 按工具名匹配的白名单
			*  匹配不到 run_code 本身，这里从 code 里静态提取内嵌调用的路径。
			*  只认字面量字符串路径；模板串/变量拼接等动态路径无法静态解析，跳过
			*  （与「只从固化调用节点提取」的保守定位一致）。
			*  shell 级写操作（pwsh 的 Set-Content / 重定向、gitbash 等）不可靠解析，不计入。 */
		const RUN_CODE_TOOL = "run_code";
		const RUN_CODE_CALL_RE = /\btools\.(edit|write|mkdirs?|delete|remove|move|rename|copy)\s*\(/g;

		/** 读一个以 start 开头的引号字符串字面量；返回 { value, next } 或 null。 */
		function mfsReadQuoted(text, start) {
			const q = text[start];
			if (q !== '"' && q !== "'") return null;
			let i = start + 1;
			let buf = "";
			for (; i < text.length; i++) {
				const ch = text[i];
				if (ch.charCodeAt(0) === 92) { // 反斜杠转义：保留原文（路径不解释 \n/\t）
					if (i + 1 >= text.length) return { value: buf, next: i + 1 };
					buf += ch + text[i + 1];
					i++;
					continue;
				}
				if (ch === q) return { value: buf, next: i + 1 };
				buf += ch;
			}
			return { value: buf, next: i };
		}

		/** 从 openAt 处 '(' 起找匹配的 ')'（跳过字符串与反引号模板、嵌套括号）；找不到返回 -1。
		 *  调用方传 '(' 的位置；depth 从 1 起（该 '(' 已被消费），回到 0 即匹配。 */
		function mfsMatchParen(text, openAt) {
			let depth = 1;
			let i = openAt + 1;
			for (; i < text.length; i++) {
				const ch = text[i];
				if (ch === '"' || ch === "'") {
					const s = mfsReadQuoted(text, i);
					if (s !== null) { i = s.next - 1; continue; }
				}
				if (ch.charCodeAt(0) === 96) { // 反引号模板：跳到闭合反引号
					let k = i + 1;
					for (; k < text.length; k++) {
						if (text[k].charCodeAt(0) === 92) { k++; continue; }
						if (text[k].charCodeAt(0) === 96) break;
					}
					i = k;
					continue;
				}
				if (ch === "(" || ch === "{" || ch === "[") depth++;
				else if (ch === ")" || ch === "}" || ch === "]") {
					depth--;
					if (depth === 0) return i;
				}
			}
			return -1;
		}

		/** 在参数文本里找 key: 的所有值（单字符串或字符串数组）。 */
		function mfsExtractKeyValues(text, key) {
			const out = [];
			let pos = 0;
			while (pos < text.length) {
				const at = text.indexOf(key, pos);
				if (at < 0) break;
				const prev = at > 0 ? text[at - 1] : "";
				if (/[A-Za-z0-9_]/.test(prev)) { pos = at + key.length; continue; }
				pos = at + key.length;
				while (pos < text.length && /\s/.test(text[pos])) pos++;
				if (text[pos] !== ":") continue;
				pos++;
				while (pos < text.length && /\s/.test(text[pos])) pos++;
				if (pos >= text.length) break;
				const c = text[pos];
				if (c === "[") {
					let p = pos + 1;
					for (;;) {
						while (p < text.length && (/\s/.test(text[p]) || text[p] === ",")) p++;
						if (p >= text.length || text[p] === "]") break;
						const s = mfsReadQuoted(text, p);
						if (s === null) { p++; continue; }
						out.push(s.value);
						p = s.next;
					}
					pos = p;
				} else if (c === '"' || c === "'") {
					const s = mfsReadQuoted(text, pos);
					if (s !== null) { out.push(s.value); pos = s.next; }
					else pos++;
				} else {
					pos++;
				}
			}
			return out;
		}

		/** 从 run_code 的 code 文本里提取内嵌工具调用的 {tool, path} 列表。 */
		function mfsExtractRunCodePaths(code) {
			const out = [];
			if (typeof code !== "string" || code === "") return out;
			RUN_CODE_CALL_RE.lastIndex = 0;
			let m;
			while ((m = RUN_CODE_CALL_RE.exec(code)) !== null) {
				const tool = m[1];
				const recipe = MFS_MUTATIONS[tool];
				if (recipe === void 0) continue;
				const openAt = RUN_CODE_CALL_RE.lastIndex - 1; // 指向 '(' 本身
				const end = mfsMatchParen(code, openAt);
				if (end < 0) break;
				const argsText = code.slice(openAt + 1, end);
				RUN_CODE_CALL_RE.lastIndex = end + 1;
				for (const key of recipe.pathKeys) {
					for (const raw of mfsExtractKeyValues(argsText, key)) {
						if (raw.trim() !== "") out.push({ tool, path: raw });
					}
				}
			}
			return out;
		}

		/** 归一化路径用于去重（统一分隔符 + 小写，兼顾 Windows 大小写不敏感）。 */
		function mfsNormalizePath(path) {
			let out = String(path).replace(/\\/g, "/").trim();
			while (out.endsWith("/")) out = out.slice(0, -1);
			return out.toLowerCase();
		}

		/** 把一条工具调用里的改动路径收进结果 Map。 */
		function mfsRecordMutation(toolName, argsRaw, out) {
			if (typeof toolName !== "string") return;
			// run_code 不在白名单里，必须先于 recipe 检查处理：
			// 路径内嵌在 code 里，静态提取后按内嵌工具映射回白名单 ops。
			if (toolName === RUN_CODE_TOOL) {
				let args;
				try {
					args = JSON.parse(argsRaw);
				} catch (error) {
					return;
				}
				if (args === null || typeof args !== "object" || Array.isArray(args)) return;
				const code = args.code;
				if (typeof code !== "string") return;
				for (const hit of mfsExtractRunCodePaths(code)) {
					const inner = MFS_MUTATIONS[hit.tool];
					if (inner === void 0) continue;
					const key2 = mfsNormalizePath(hit.path);
					let entry = out.get(key2);
					if (entry === void 0) {
						entry = { path: hit.path.replace(/\\/g, "/"), ops: new Map() };
						out.set(key2, entry);
					}
					for (const op of inner.ops) {
						entry.ops.set(op, (entry.ops.get(op) ?? 0) + 1);
					}
				}
				return;
			}

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
		* 标准 hook（功能三注册段 alphaFeatures 子 fiber 里经 ctx.uiSession
		* .provide 注入，与官方 useChat 同一机制）返回 ChatSnapshot，取
		* legacy.nodes/runningCalls；openState 仍走 useSession 生命周期快照；
		* cwd/openFile 由注册 inject 注入；t 绑 MFS_NS。
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
		 * 功能三注册段：alpha-only 子 fiber（v0.4.2 内核自适应）
		 *
		 * 「修改的文件」选项卡的取数依赖 0.1.2-alpha.1 才引入的 client
		 * target 体系服务 `uiConversation` / `uiSession`；0.1.1-rc.1/rc.2
		 * 的 store 里没有它们的提供方（只有 ui-conversation，它提供的是
		 * `conversation`，不是 `uiConversation`）。
		 *
		 * 若把这两个服务写在 loader entry 的 `inject` 上（≤ v0.4.1 的做法），
		 * 旧内核下整个 entry fiber 停在 PENDING，被 boot 末尾的
		 * assertEntriesActivated（只遍历 ctx.loader.entries()）判为失败 →
		 * `web boot: 1 entry did not activate` + Failed to load plugins 横幅，
		 * 桌面端反复重载，且四个不依赖新服务的功能一起丢掉。
		 *
		 * 根治：入口层只声明跨内核服务，本函数作为 **ctx.plugin 子 fiber**
		 * 声明这两个硬依赖。cordis 对停在 PENDING 的子 fiber 不执行函数体、
		 * 不注册 effect，也不计入 boot 审计；服务（哪怕是延后出现的）就绪时
		 * 自动激活。渲染方式完全不变（仍是纯 slot 渲染，无观察器/定时器）。
		 *
		 * config = { prefs, capability }：apply 期创建的偏好仓库与能力仓库。
		 * ══════════════════════════════════════════════════════════════ */

		const mfsSources = /* @__PURE__ */ new WeakMap();

		/**
		 * chat target 快照源（按 binding 缓存，与官方 dsh-client-ui-chat 的
		 * chatSource 同构）。形状不符/取数异常时回退空快照且**不缓存**，
		 * 下次解析还会重试（§10：服务存在但语义再变也要能静默降级）。
		 */
		function mfsChatSource(ctx, binding) {
			const cached = mfsSources.get(binding);
			if (cached !== void 0) return cached;
			try {
				const target = ctx.uiConversation.binding(binding).target(MFS_CHAT_TARGET);
				if (typeof target?.getSnapshot !== "function" || typeof target?.subscribe !== "function") {
					throw new TypeError(`chat target "${MFS_CHAT_TARGET}" 形状不符`);
				}
				const source = {
					getSnapshot: () => target.getSnapshot() ?? MFS_EMPTY_CHAT,
					subscribe: (listener) => target.subscribe(listener)
				};
				mfsSources.set(binding, source);
				return source;
			} catch (error) {
				console.error("[dsh-ui-tools] chat target unavailable, modified-files falls back to empty:", error);
				return { getSnapshot: () => MFS_EMPTY_CHAT, subscribe: () => () => {} };
			}
		}

		/** 仅在提供 uiConversation / uiSession 的内核上激活；旧内核上本函数体不会执行。 */
		function alphaFeatures(ctx, config) {
			const { prefs, capability } = config;

			// 形状探测：服务在但 API 改名/换形状时，本功能整体缺席而不是抛错。
			if (typeof ctx.uiConversation?.binding !== "function" || typeof ctx.uiSession?.provide !== "function") {
				console.warn("[dsh-ui-tools] session target API shape changed; modified-files tab is skipped");
				return;
			}

			// 注册会话级标准 hook useModifiedFiles（与官方 useChat 同一机制），
			// 仅本视图消费；hook 名带 mfs 语义避免与其它插件冲突。
			try {
				ctx.uiSession.provide({
					hooks: ["modifiedFiles"],
					resolve: (binding) => ({ hooks: { modifiedFiles: mfsChatSource(ctx, binding) } })
				});
			} catch (error) {
				console.error("[dsh-ui-tools] uiSession.provide failed; modified-files tab is skipped:", error);
				return;
			}

			ctx.effect(() => ctx.locale.register(MFS_NS, { zh: MFS_ZH, en: MFS_EN }), "ui-tools: modified-files dictionaries");
			const mfsT = ctx.locale.bind(MFS_NS);

			// 能力通告：执行到这里说明 target 体系齐备 —— 设置页据此解除灰显；
			// 子 fiber 卸载（服务消失 / entry dispose）时置回 false。
			ctx.effect(() => {
				capability.set({ alphaApi: true });
				return () => capability.set({ alphaApi: false });
			}, "ui-tools: alpha capability flag");

			// 注册进官方开放槽 conversation.view（与「轨迹」tab 同一机制）：
			// 头部 tab 栏自动多出一个按钮（order 20 排在 chat=0、trajectory=10
			// 之后），点击切换 / 高亮 / 会话内持久化全部由框架处理，不搬 DOM。
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

			// ── 功能六：输出速度计（v0.4.6）──
			// 同样只在提供 target 体系的内核上激活（旧内核子 fiber 停在 PENDING，
			// 设置页开关随之灰显）。两处注册：
			//   ① assistant-actions 精确 pill —— 紧贴官方「用时」左侧；
			//   ② 自建 chat 节点 Definition —— 生成中的估算速度条。
			ctx.effect(() => ctx.locale.register(TSP_NS, { zh: TSP_ZH, en: TSP_EN }), "ui-tools: token-speed dictionaries");
			const tspT = ctx.locale.bind(TSP_NS);
			ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
				name: "conversation.chat.assistant-actions",
				id: "ui-tools-token-speed",
				order: -10,
				locale: TSP_NS,
				inject: (sessionId) => ({
					hooks: { tspChat: tspChatSource(ctx, sessionId) },
					prefs
				})
			}, TokenSpeedPill));
			// 生成中估算条的 keyed 渲染器（与 Definition 配对；key 即 node.kind）。
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: TSP_LIVE_KIND,
				locale: TSP_NS,
				inject: () => ({ prefs })
			}, TokenSpeedLive));
			// Definition 通道是内核对等能力中较新的一个：形状不符时**只让生成中那段
			// 缺席**，绝不能抛出 —— 本函数体与功能三同处一个子 fiber，抛错会让
			// capability 回滚、连「修改的文件」一起 FAIL（compat-check 场景 B/C 正是
			// 用只提供 binding 的假服务钉住这一点）。精确 pill 不依赖该通道。
			if (typeof ctx.uiConversation.events?.register === "function") {
				ctx.uiConversation.events.register(tspLiveDefinition());
			} else {
				console.warn("[dsh-ui-tools] uiConversation.events.register unavailable; token-speed live meter is skipped");
			}
		}

		/** alpha-only 硬依赖收敛到子 fiber —— 这一行是本方案的关键。 */
		alphaFeatures.inject = ["uiConversation", "uiSession"];

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
		 * 功能六：输出速度计 tok/s（v0.4.6）
		 *
		 * 两个落点，同一个开关 prefs.tokenSpeedEnabled：
		 *
		 * 1) 精确值（回合结束后）—— 注册进 conversation.chat.assistant-actions
		 *    （session 作用域 list 槽）。该槽渲染在 MessageIconActions 的
		 *    extraActions 位，紧贴官方「用时 xx秒」pill **左侧**，即「耗时旁边」。
		 *    数值与内核「本轮用时和速度」弹窗同源同公式：
		 *      Σ outputTokens ÷ Σ (completedTime − firstTokenTime)
		 *    （对应内核 deriveTurnMetrics / assistantStepReading 的口径：只累计
		 *    「同时带 firstTokenTime 与 usage.outputTokens」的 step）。
		 *
		 * 2) 估算值（生成中）—— 生成期间**没有任何可用槽位**：turnTail 的数据源
		 *    必须匹配到 turn/end 才产出节点（tailData 无 turn/end 即返回 null），
		 *    assistant-actions 所在的动作条本身也只在回合结束后才渲染。故按官方
		 *    Definition 通道（ctx.uiConversation.events.register，ui-goal /
		 *    ui-workflow-run 同款）自建一个 chat 节点，锚定在本回合首个可见增量处，
		 *    回合结束即返回 null 消失、交棒给上面的精确值。
		 *    内核在流式期间不上报 token 数（stream 的 usage chunk 被
		 *    publication:"none" 抑制），所以这里按已输出字符折算，并始终带「≈」
		 *    与前缀文案 —— 刻意不与精确值混同。
		 *
		 * 取数复用功能三的 chat target 快照源 mfsChatSource（WeakMap 缓存），
		 * 不新增 entry 层 inject；全部能力仍在 alphaFeatures 子 fiber 内。
		 * ══════════════════════════════════════════════════════════════ */

		const TSP_NS = "token-speed";
		const TSP_LIVE_KIND = "token-speed-live";
		/**
		* 生成中估算条的排序锚点：刻意取一个远大于任何真实事件 seq 的常量。
		*
		* 为什么不用「首个增量的 seq」：内核按 anchorSeq 排序所有可见节点
		* （orderedVisibleChatNodes），若锚在首个增量处，速度条会跑到流式正文
		* **上方**（与正文节点同锚点，再按 key 比较）。取一个大常量让本节点稳定地
		* 排在本回合所有节点之后 —— 即回合尾部，正好紧邻内核自己的「深度求索中…」
		* 状态行。锚点恒定还带来一个好处：只有首个增量那次是结构性变更，
		* 后续每帧都是纯内容更新，不会触发重排。
		*/
		const TSP_LIVE_ANCHOR = 2 ** 31;
		/**
		* 相邻两个输出增量之间「仍然算作解码中」的最大间隔（毫秒）。
		*
		* 估算速度的分母只应包含**模型真正在出字的时间**。流式增量在正常解码时
		* 以几十毫秒的间隔密集到达；一旦出现远大于此的间隔，那段时间几乎一定是
		* 等工具执行 / 等下一次请求（无输出），把它计入分母会让读数随时间衰减，
		* 看起来像「速度掉了」。故超过该阈值的间隔按「停顿」处理、不计入分母。
		*/
		const TSP_LIVE_GAP_CAP_MS = 1000;
		/** 按 BoundConversation 缓存的 chat 快照源（键必须是对象，见 tspChatSource）。 */
		const tspSources = /* @__PURE__ */ new WeakMap();
		const TSP_ZH = {
			"tps.exact": "{tps} tok/s",
			"tps.estimated": "≈ {tps} tok/s",
			"tps.liveNote": "生成中估算",
			"tps.title": "本回合输出速度（与「用时」弹窗内的 TPS 同源）",
			"tps.liveTitle": "生成中的估算速度：内核流式期间不上报 token 数，此处按已输出字符折算",
			"a11y.exact": "本回合输出速度 {tps} tok/s",
			"a11y.estimated": "生成中，估算输出速度约 {tps} tok/s"
		};
		const TSP_EN = {
			"tps.exact": "{tps} tok/s",
			"tps.estimated": "≈ {tps} tok/s",
			"tps.liveNote": "live estimate",
			"tps.title": "This turn's output speed (same source as the TPS in the elapsed-time dialog)",
			"tps.liveTitle": "Live estimate: the kernel reports no token counts while streaming, so this is derived from emitted characters",
			"a11y.exact": "This turn ran at {tps} tokens per second",
			"a11y.estimated": "Generating; estimated output speed about {tps} tokens per second"
		};

		/* ── 功能六取数段（compat-check 直接截取本段做断言，勿动这两条分隔注释）── */

		/** TPS 显示口径：与内核 formatTokensPerSecond 一致（≥10 取整，否则一位小数）。 */
		function tspFormatTps(tps) {
			const clamped = Math.max(0, tps);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}

		/**
		* 字符 → token 的粗略折算（仅在流式期间使用，内核此时不报 token 数）。
		* 口径：CJK / 假名 / 谚文 / 全角符号按 1 字符 ≈ 1 token；其余按 4 字符 ≈ 1 token。
		* @param text - 增量文本。
		* @returns 估算 token 数（可为小数）。
		*/
		function tspEstimateTokens(text) {
			if (typeof text !== "string" || text === "") return 0;
			let wide = 0;
			let narrow = 0;
			for (const ch of text) {
				const code = ch.codePointAt(0);
				if (code >= 0x2e80) wide += 1;
				else narrow += 1;
			}
			return wide + narrow / 4;
		}

		/**
		* 单个流式 chunk 折算出的输出量（与内核 isTokenDelta 认定的「可见输出」同集合：
		* 正文、推理、以及工具调用参数——后者同样是消耗解码时间的模型输出）。
		* @param chunk - assistant/live-chunk 的 chunk。
		* @returns 估算 token 数；非输出类 chunk 返回 0。
		*/
		function tspChunkEffort(chunk) {
			if (chunk === null || typeof chunk !== "object") return 0;
			if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") return tspEstimateTokens(chunk.text);
			if (chunk.type === "tool-call-delta") {
				const args = typeof chunk.argumentsDelta === "string" ? chunk.argumentsDelta : "";
				const name = typeof chunk.name === "string" ? chunk.name : "";
				return tspEstimateTokens(`${name}${args}`);
			}
			return 0;
		}

		/**
		* 本回合精确输出速度（tok/s），口径与内核 deriveTurnMetrics 逐项对齐。
		*
		* 先按 messageId 定位回合号，再折叠该回合全部已固化 assistant 节点：
		* 只累计「timing 齐备（firstTokenTime / completedTime）且 usage.outputTokens
		* 合法」的 step，ΣoutputTokens ÷ ΣdecodeMs(秒)。
		* @param nodes - ChatSnapshot.legacy.nodes。
		* @param messageId - 该回合收尾 assistant 消息 id（槽位标准 props 提供）。
		* @returns tok/s；数据不足（无可计步 / 解码时长为 0）时返回 null。
		*/
		function tspTurnSpeed(nodes, messageId) {
			if (!Array.isArray(nodes) || (typeof messageId !== "string" && typeof messageId !== "number")) return null;
			let turn = null;
			for (const node of nodes) {
				if (node === null || typeof node !== "object") continue;
				if (node.messageId !== messageId || typeof node.turn !== "number") continue;
				turn = node.turn;
				break;
			}
			if (turn === null) return null;
			let decodeMs = 0;
			let outputTokens = 0;
			let sampled = false;
			for (const node of nodes) {
				if (node === null || typeof node !== "object" || node.turn !== turn) continue;
				const timing = node.timing;
				const usage = node.usage;
				if (timing === null || typeof timing !== "object") continue;
				if (usage === null || typeof usage !== "object") continue;
				const first = typeof timing.firstTokenTime === "number" ? timing.firstTokenTime : null;
				const done = typeof timing.completedTime === "number" ? timing.completedTime : null;
				const out = typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens) && usage.outputTokens >= 0
					? usage.outputTokens
					: null;
				if (first === null || done === null || out === null) continue;
				decodeMs += Math.max(0, done - first);
				outputTokens += out;
				sampled = true;
			}
			if (!sampled || decodeMs <= 0) return null;
			return outputTokens / (decodeMs / 1000);
		}

		/* ── 功能六取数段结束 ── */

		const TSP_CSS = `
/* ═══ dsh-ui-tools · 输出速度计（tok/s） ═══ */
[data-tsp-pill],
[data-tsp-live] {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
	color: var(--dsw-alias-label-tertiary, #a1a8b3);
	font-size: var(--dsh-content-font-size-secondary, 13px);
	line-height: 20px;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
[data-tsp-pill] {
	height: calc(28px + var(--dsh-content-font-delta, 0px));
	padding: 0 6px;
}
[data-tsp-live] {
	align-self: flex-start;
	padding: 2px 10px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 7%, transparent);
}
[data-tsp-pill] .tsp-ic,
[data-tsp-live] .tsp-ic {
	flex: none;
	font-size: 11px;
	line-height: 1;
	opacity: .85;
}
[data-tsp-live] .tsp-note {
	color: var(--dsw-alias-label-caption, #8a919e);
	font-size: 11px;
}
`.trim();

		/**
		* 精确速度 pill：紧贴官方「用时」pill 左侧（assistant-actions 槽的
		* extraActions 位）。messageId 由槽位标准 props 提供；节点数据经
		* inject 注入的 tspChat hook（chat target 快照）读取。
		*/
		function TokenSpeedPill(props) {
			const { messageId, useTspChat, t, prefs } = props;
			const h = react.createElement;
			const p = usePrefs(prefs);
			const nodes = useTspChat((s) => (s === void 0 || s === null ? void 0 : s.legacy?.nodes));
			const tps = react.useMemo(() => tspTurnSpeed(nodes, messageId), [nodes, messageId]);
			if (!p.tokenSpeedEnabled || tps === null) return null;
			const value = tspFormatTps(tps);
			return h("span", {
				"data-tsp-pill": "",
				className: "tsp-pill",
				title: t("tps.title"),
				"aria-label": t("a11y.exact", { tps: value })
			}, [
				h("span", { className: "tsp-ic", "aria-hidden": "true" }, "\u26A1"),
				h("span", { className: "tsp-val" }, t("tps.exact", { tps: value }))
			]);
		}

		/**
		* 生成中的估算速度条：作为自建 chat 节点的渲染器。
		*
		* 分母用 **Definition 累积的有效解码时长**（data.activeMs，只在真的收到
		* 输出增量时才增长），而不是「当前时刻 − 首 token 时刻」的墙钟差：
		* 后者会把工具执行、等待等**无输出的停顿**算进分母，读数会随时间衰减到
		* 接近 0（看起来像速度在掉，其实是模型没在出字）。因此这里不设定时器，
		* 读数随每个增量帧更新；停顿期间保持上一次的真实解码速度。
		*/
		function TokenSpeedLive(props) {
			const { node, t, prefs } = props;
			const h = react.createElement;
			const p = usePrefs(prefs);
			if (!p.tokenSpeedEnabled) return null;
			const data = node === void 0 || node === null ? void 0 : node.data;
			if (data === void 0 || data === null) return null;
			const activeMs = Math.max(0, data.activeMs ?? 0);
			if (activeMs < 250 || !(data.estTokens > 0)) return null;
			const value = tspFormatTps(data.estTokens / (activeMs / 1000));
			return h("div", {
				"data-tsp-live": "",
				className: "tsp-live",
				role: "status",
				"aria-live": "polite",
				title: t("tps.liveTitle"),
				"aria-label": t("a11y.estimated", { tps: value })
			}, [
				h("span", { className: "tsp-ic", "aria-hidden": true }, "\u26A1"),
				h("span", { className: "tsp-val" }, t("tps.estimated", { tps: value })),
				h("span", { className: "tsp-note" }, t("tps.liveNote"))
			]);
		}

		/**
		* 生成中速度节点的官方 Definition（target: chat）。
		*
		* 状态累积：turn/start 建状态 → 每个输出增量累加估算量 estTokens 与
		* 有效解码时长 activeMs（相邻增量的间隔，超过 TSP_LIVE_GAP_CAP_MS 的
		* 停顿不计入）→ turn/end 置 ended，buildViewNode 随即返回 null
		* （节点消失，交棒精确 pill）。
		* publication 与内核 assistant-step 同规则：usage / finish chunk 不发布，
		* 其余增量按 animation-frame 发布。
		*
		* 形状不符的 event 一律返回 null / 原状态，保证不打断 chat 组装器。
		*/
		function tspLiveDefinition() {
			const turnIdOf = (event) => {
				const data = event?.data;
				return data !== null && typeof data === "object" && typeof data.turn === "number" ? data.turn : null;
			};
			return {
				kind: TSP_LIVE_KIND,
				target: "chat",
				match: (event) => {
					if (event === null || typeof event !== "object") return null;
					const type = event.type;
					if (type !== "turn/start" && type !== "step/start" && type !== "assistant/live-chunk" && type !== "turn/end") return null;
					const turn = turnIdOf(event);
					if (turn === null) return null;
					return { id: `t${turn}`, role: type === "turn/start" ? "start" : "update" };
				},
				start: (_context, match) => ({
					turn: match.event.data.turn,
					startedAt: match.event.time,
					firstTokenAt: null,
					lastDeltaAt: null,
					activeMs: 0,
					estTokens: 0,
					location: null,
					ended: false
				}),
				update: (context, match) => {
					const state = context.state;
					// 分页窗口可能不含本回合的 turn/start（先到 update）：此时不能返回
					// undefined —— 内核 requireState 会直接抛错。给一个与 start() 同形的
					// 兜底状态，后续增量照常累积、正常渲染。
					if (state === void 0) {
						return {
							turn: match.event?.data?.turn ?? 0,
							startedAt: match.event?.time ?? 0,
							firstTokenAt: null,
							lastDeltaAt: null,
							activeMs: 0,
							estTokens: 0,
							location: null,
							ended: false
						};
					}
					if (match.event.type === "turn/end") return state.ended ? state : { ...state, ended: true };
					const effort = match.event.type === "step/start" ? 0 : tspChunkEffort(match.event.data.chunk);
					if (effort <= 0) return state;
					const time = match.event.time;
					const previous = state.lastDeltaAt;
					// 只在「与上一个输出增量相邻」的时间段里累加解码时长；停顿时长
					// （工具执行、等待下一步）不计入分母，避免读数被稀释。
					const gap = previous === null ? 0 : Math.min(Math.max(0, time - previous), TSP_LIVE_GAP_CAP_MS);
					return {
						...state,
						// location 只记首个有输出的 match（节点定位用；排序锚点是常量）。
						location: state.location ?? (match.location ?? null),
						estTokens: state.estTokens + effort,
						firstTokenAt: state.firstTokenAt === null ? time : state.firstTokenAt,
						lastDeltaAt: time,
						activeMs: state.activeMs + gap
					};
				},
				publication: (match) => {
					if (match.event.type !== "assistant/live-chunk") return "immediate";
					const chunk = match.event.data.chunk;
					const type = chunk === null || typeof chunk !== "object" ? void 0 : chunk.type;
					return type === "usage" || type === "finish" ? "none" : "animation-frame";
				},
				buildViewNode: (context) => {
					const state = context.state;
					// ⚠ 关键不变量（v0.4.7）：**一旦本 target 曾物化过，就绝不能返回 null**。
					//
					// 内核 ConversationNodeAssembler.buildTargetUpserts() 的判定是：
					//   previous = context.current.get(target)   // 上一帧的节点
					//   node     = buildViewNode(...)
					//   node === null && previous !== null  ->  抛错
					// `conversation Definition "x" withdrew materialized target "chat"`。
					// 该异常从 flush() 冒出后**整条 chat 视图快照链停更**：回合结束后界面
					// 不再刷新、之后每次提问都不显示（0.1.6-alpha.2 / 0.1.7-alpha.1 均复现）。
					//
					// ⚠⚠ 只看 state 的写法（`state.ended` / 无输出 → 返回 null）**修不干净**：
					// 真机的流式增量是 **transient** 记录，回合收尾时内核走
					// settleAssistant()：先 retire 全部 transient、再 replay 本 Context ——
					// 状态被**倒推回 firstTokenAt=null / estTokens=0**（不是 ended=true！）。
					// 于是 `firstTokenAt === null` 分支照样返回 null，照样触发撤回异常。
					// 因此判据不能只看 state，必须用内核自己给的 `context.current`（上一帧
					// 已物化的节点）：只要它非空，就必须返回同 key 的节点，仅切换 visibility。
					const previous = context.current !== void 0 && typeof context.current?.get === "function"
						? (context.current.get("chat") ?? null)
						: null;
					const hasData = state !== void 0 && state.firstTokenAt !== null;
					// 从未物化过（首帧且无输出）→ 返回 null 是安全的（内核无从「撤回」）。
					if (!hasData && previous === null) return null;
					// 有过数据、但当前不应展示（turn/end、transient 被 retire、流式尚未开始）
					// → 用同 key + hidden 让位给 assistant-actions 里的精确 pill。
					const visible = hasData && !state.ended && state.estTokens > 0;
					return {
						key: context.key,
						kind: TSP_LIVE_KIND,
						id: context.id,
						target: "chat",
						anchorSeq: TSP_LIVE_ANCHOR,
						location: (state !== void 0 && state.location) || context.start?.location || { kind: "unresolved" },
						visibility: visible ? "visible" : "hidden",
						data: {
							turn: state !== void 0 ? state.turn : 0,
							startedAt: state !== void 0 ? state.startedAt : 0,
							firstTokenAt: state !== void 0 ? state.firstTokenAt : null,
							activeMs: state !== void 0 ? state.activeMs : 0,
							estTokens: state !== void 0 ? state.estTokens : 0
						}
					};
				}
			};
		}

		/**
		* 功能六的 chat 快照源。
		*
		* 注意不能复用 mfsChatSource(ctx, sessionId)：它内部再调一次
		* `uiConversation.binding(...)`，且用 WeakMap 做缓存 —— WeakMap 的键必须是
		* 对象，直接喂字符串会在 set 时抛 TypeError。这里改为「先自己拿
		* BoundConversation（内核按 binding 缓存，同一会话稳定复用），再用它做键」，
		* 与官方 dsh-client-ui-chat 的 chatSource 同构。
		* @param ctx - 子 fiber 上下文（uiConversation 提供方）。
		* @param sessionId - 槽位 inject 传入的会话 id。
		* @returns 可订阅的 chat target 快照源；解析失败时回退空快照（绝不抛给槽位）。
		*/
		function tspChatSource(ctx, sessionId) {
			try {
				const bound = ctx.uiConversation.binding(sessionId);
				const cached = tspSources.get(bound);
				if (cached !== void 0) return cached;
				const target = bound.target(MFS_CHAT_TARGET);
				if (typeof target?.getSnapshot !== "function" || typeof target?.subscribe !== "function") {
					throw new TypeError(`chat target "${MFS_CHAT_TARGET}" 形状不符`);
				}
				const source = {
					getSnapshot: () => target.getSnapshot() ?? MFS_EMPTY_CHAT,
					subscribe: (listener) => target.subscribe(listener)
				};
				tspSources.set(bound, source);
				return source;
			} catch (error) {
				console.warn("[dsh-ui-tools] token-speed chat source unavailable:", error);
				return { getSnapshot: () => MFS_EMPTY_CHAT, subscribe: () => () => {} };
			}
		}

		/* ══════════════════════════════════════════════════════════════
		 * 偏好仓库（localStorage，v0.4.0）
		 * 四个既有功能的开关在这里集中管理。官方 settings
		 * 命名空间需要 host 侧 ctx.settings.register(ns, schema) 才能持久化
		 * （参考 ui-theme/src/index.ts 的 host 半部），本插件刻意保持纯
		 * 浏览器（index.js 空入口），因此沿用社区惯例（dsh-better-sidebar
		 * 同款 localStorage）：偏好仅本浏览器生效；如需跨端同步可后续
		 * 增加 host 半部迁移到 settings 文档。
		 * ══════════════════════════════════════════════════════════════ */

		const PREFS_KEY = "dsh-ui-tools:prefs:v1";
		const PREFS_DEFAULTS = Object.freeze({
			chipEnabled: true,
			collapseDefaultCollapsed: false,
			mfsCompact: false,
			tokenSpeedEnabled: true
		});

		/** 合并 user 覆盖与默认值，逐字段校验类型；坏数据回退默认。 */
		function normalizePrefs(partial) {
			const base = { ...PREFS_DEFAULTS };
			if (partial === null || typeof partial !== "object") return base;
			return {
				chipEnabled: typeof partial.chipEnabled === "boolean" ? partial.chipEnabled : base.chipEnabled,
				collapseDefaultCollapsed: typeof partial.collapseDefaultCollapsed === "boolean" ? partial.collapseDefaultCollapsed : base.collapseDefaultCollapsed,
				mfsCompact: typeof partial.mfsCompact === "boolean" ? partial.mfsCompact : base.mfsCompact,
				tokenSpeedEnabled: typeof partial.tokenSpeedEnabled === "boolean" ? partial.tokenSpeedEnabled : base.tokenSpeedEnabled
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
		 * 能力仓库（v0.4.2，跨内核降级）
		 * alpha-only 功能（功能三）收在 alphaFeatures 子 fiber 里，旧内核上
		 * 该 fiber 停在 PENDING、函数体不执行。子 fiber 激活时把本仓库置真，
		 * 设置页据此灰显「修改的文件」相关开关——比在 apply 期一次性
		 * ctx.get() 探测更可靠：provider fiber 可能比本 entry 更晚激活。
		 * ══════════════════════════════════════════════════════════════ */

		/** 极简可观察能力快照（useSyncExternalStore 可直接订阅）。 */
		function createCapabilityStore(initial) {
			const listeners = /* @__PURE__ */ new Set();
			let snapshot = Object.freeze({ alphaApi: !!initial });
			const emit = () => { for (const listener of listeners) listener(); };
			return {
				getSnapshot: () => snapshot,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => { listeners.delete(listener); };
				},
				/** 只在值真的变化时换快照并通知（快照必须稳定，否则 React 会循环）。 */
				set: (patch) => {
					const next = { ...snapshot, ...patch };
					let changed = false;
					for (const key of Object.keys(next)) if (next[key] !== snapshot[key]) changed = true;
					if (!changed) return;
					snapshot = Object.freeze(next);
					emit();
				}
			};
		}

		/** 组件内订阅能力快照。 */
		function useCapability(capability) {
			return useSyncExternalStore(capability.subscribe, capability.getSnapshot);
		}

		/* ══════════════════════════════════════════════════════════════
		 * 功能五：插件设置页（settings.section，v0.4.0；v0.4.1 删快捷命令条）
		 * 官方设置中心新增「DSH UI 工具」页：集中开关四个既有功能的偏好
		 * （徽章 / 启动默认折叠 / 修改文件紧凑显示）。偏好经 localStorage
		 * 持久化（见偏好仓库说明）。settings.section 是 root 作用域 list
		 * 槽，注册 id/order/label 即出现在设置导航。
		 * ══════════════════════════════════════════════════════════════ */

		const SET_NS = "ui-tools-settings";
		const SET_ZH = {
			"nav.label": "DSH UI 工具",
			"group.layout": "布局偏好",
			"chip.enabled": "会话标题旁显示工作区徽章",
			"collapse.defaultCollapsed": "启动时默认折叠所有工作区分组",
			"mfs.compact": "「修改的文件」使用紧凑单行显示",
			"mfs.unavailable": "需内核 0.1.2-alpha.1+（当前内核没有会话 target 体系，该选项卡不可用）",
			"tokenSpeed.enabled": "在「用时」旁显示输出速度计（tok/s）",
			"a11y.toggle": "切换 {label}"
		};
		const SET_EN = {
			"nav.label": "DSH UI Tools",
			"group.layout": "Layout preferences",
			"chip.enabled": "Show the workspace chip next to the session title",
			"collapse.defaultCollapsed": "Collapse all workspace groups on startup",
			"mfs.compact": "Use compact single-line rows in Modified files",
			"mfs.unavailable": "Requires kernel 0.1.2-alpha.1+ (this kernel has no session target API, so the tab is unavailable)",
			"tokenSpeed.enabled": "Show the output speed meter (tok/s) next to elapsed time",
			"a11y.toggle": "Toggle {label}"
		};

		/**
		 * 设置页内一行开关。`disabled` + `hint`（v0.4.2）用于能力缺席的灰显
		 * 态：旧内核上「修改的文件」选项卡不存在，其紧凑显示开关灰显并提示
		 * 所需内核版本。
		 */
		function SettingsToggleRow(props) {
			const h = react.createElement;
			const { label, checked, onChange, t, disabled, hint } = props;
			const off = disabled === true;
			return h("label", {
				className: "set-row",
				"data-set-row": "",
				"data-set-disabled": off ? "true" : void 0
			}, [
				h("span", { className: "set-row-text" }, [
					h("span", { className: "set-row-label" }, label),
					off && hint ? h("span", { className: "set-row-hint" }, hint) : null
				]),
				h("input", {
					type: "checkbox",
					className: "set-toggle",
					checked,
					disabled: off,
					"aria-disabled": off ? "true" : void 0,
					"aria-label": t("a11y.toggle", { label }),
					onChange: (event) => {
						if (!off) onChange(event.target.checked);
					}
				})
			]);
		}

		/**
		* 「DSH UI 工具」设置页主体。close 由设置外壳传入（本页不用，
		* 保持解构避免 eslint 类告警）；t/prefs/capability 由注册 inject 提供。
		* capability.alphaApi 为假（旧内核：alphaFeatures 子 fiber 停在
		* PENDING）时，功能三相关开关灰显。
		*/
		function UiToolsSettingsSection(props) {
			const { t, prefs, capability } = props;
			const h = react.createElement;
			const p = usePrefs(prefs);
			const cap = useCapability(capability);
			return h("div", { "data-set-root": "", className: "set-root" }, [
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
						disabled: !cap.alphaApi,
						hint: t("mfs.unavailable"),
						t
					}),
					h(SettingsToggleRow, {
						label: t("tokenSpeed.enabled"),
						checked: p.tokenSpeedEnabled,
						onChange: (value) => prefs.set({ tokenSpeedEnabled: value }),
						disabled: !cap.alphaApi,
						hint: t("mfs.unavailable"),
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
/* v0.4.2 能力缺席灰显态（旧内核上功能三不可用） */
[data-set-root] .set-row-text {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}
[data-set-root] .set-row[data-set-disabled="true"] {
	cursor: not-allowed;
	opacity: .55;
}
[data-set-root] .set-row[data-set-disabled="true"]:hover {
	background: var(--dsw-specific-surface-hover, rgba(127,127,127,.06));
}
[data-set-root] .set-row[data-set-disabled="true"] .set-toggle {
	cursor: not-allowed;
}
[data-set-root] .set-row-hint {
	color: var(--dsw-alias-label-tertiary, #a1a8b3);
	font-size: 11px;
	line-height: 16px;
}
`.trim();

		/* ══════════════════════════════════════════════════════════════
		 * apply：合并注册六个功能
		 * ══════════════════════════════════════════════════════════════ */

		function apply(ctx) {
			// ── 偏好仓库（v0.4.0，shared）+ 能力仓库（v0.4.2，shared）──
			const prefs = createPrefsStore();
			// capability.alphaApi 由 alphaFeatures 子 fiber 激活时置真（旧内核上
			// 该 fiber 停在 PENDING，故恒为假 → 设置页相关开关灰显）。刻意不在
			// apply 期用 ctx.get() 一次性判定：provider fiber 可能比本 entry 晚激活。
			const capability = createCapabilityStore(false);

			// ── 功能一：模型选择双按钮 ──
			ctx.effect(() => {
				const tagId = "dsh-ui-tools/styles";
				if (typeof document === "undefined") return;
				const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`);
				if (existing !== null) return () => existing.remove();
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-ui-tools";
				tag.dataset.pluginCss = tagId;
				tag.textContent = MSS_CSS + MFS_CSS + WSC_CSS + SET_CSS + TSP_CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "ui-tools: inject model-select + modified-files + workspace-chip + settings + token-speed styles");

			ctx.effect(() => ctx.locale.register(MSS_NS, { zh: MSS_ZH, en: MSS_EN }), "ui-tools: model-select dictionaries");
			const mssT = ctx.locale.bind(MSS_NS);

			// v0.4.4：`remote` 与 `remote.session` 都必须在这里声明——内核对 directoryFor()
			// 的实现会在**调用方**上下文里读 this.ctx.remote.session（cordis Service tracker
			// 重绑 this.ctx），而 remote.session 是**嵌套追踪服务**：只声明 `remote` 仍会在
			// 取 .session 时抛 "cannot get property remote.session without inject"
			// （实测：补 remote 后错误照旧，补 remote.session 才消除）。声明以内核
			// ModelDirectoryResolver.static inject 为准（它自己就是这三个）。
			// 注意只加在这个子作用域，不进 loader entry 的 inject（那会重新引入 v0.4.2
			// 修掉的旧内核 entry 停 PENDING / 五功能全丢问题）。
			ctx.inject(["slots", "modelDirectories", "sessions", "remote", "remote.session"], (scope) => {
				const models = scope.modelDirectories;
				const sessions = scope.sessions;

				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: "ui-tools-model-seat",
					locale: MSS_NS,
					inject: (sessionId) => {
						const usable = sessions.subagentAddress(sessionId) === void 0;
						const face = mssResolveDirectory(models, sessionId);
						const available = usable && face.ok;
						return {
							available,
							directory: face.directory,
							load: () => {
								if (available) face.load().catch(() => {});
							},
							select: (selection) => available ? face.select(selection).then(() => true, () => false) : Promise.resolve(false),
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

			// ── 功能三：「修改的文件」选项卡 —— alpha-only 子 fiber（v0.4.2）──
			// 取数依赖 0.1.2-alpha.1 才引入的 uiConversation / uiSession，两个
			// 硬依赖声明收进 alphaFeatures 子 fiber（见上方「功能三注册段」）：
			// 新内核正常激活；旧内核该 fiber 停在 PENDING —— 不执行函数体、不计入
			// loader entry 审计，其余四个功能照常可用（旧行为是整入口卡死 + 横幅）。
			// 渲染方式不变：仍是 conversation.view 纯 slot 注册，无观察器/定时器。
			ctx.plugin(alphaFeatures, { prefs, capability });

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

			// ── 功能五：插件设置页（settings.section）──
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
				inject: () => ({ t: setT, prefs, capability })
			}, UiToolsSettingsSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
