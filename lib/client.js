/**
 * dsh-ui-tools 浏览器端 bundle（单文件，经 __ModuleLoader__ 加载）。
 *
 * 五个 UI 工具合并（v0.4.9 起；原为六个，功能三「修改的文件」已整体移除）：
 *   1. 模型选择双按钮（原 dsh-model-select-style）
 *      - 「供应商」按钮 → 供应商列表；「模型」按钮 → 该供应商的模型列表；
 *      - 模型支持推理时，模型按钮显示「模型名 · 推理等级」，面板内可调节；
 *      - 复用官方 modelDirectories 服务，官方组件数据/提交逻辑原样保留；
 *      - v0.4.10：座位在右侧动作区里紧贴「听写」按钮（见 MSS_CSS 顶部整段注释）。
 *   2. 侧边栏工作区折叠/展开（原 dsh-workspace-collapse）
 *      - 在侧边栏底部动作区渲染「折叠全部 / 展开全部」工具条；
 *      - 纯 slot 渲染、不做 DOM 搬移（修复：旧实现用全局 MutationObserver
 *        搬节点会与框架渲染互相触发，导致渲染进程 100% CPU 卡死）。
 *   3. 会话标题旁工作区徽章（conversation.session.header.actions，v0.3.0）
 *      - 在会话页头部标题 cluster 内、面包屑标题右侧渲染「工作区名」徽章，
 *        一眼看出当前会话属于哪个工作区（与侧边栏分组标题同名）；
 *      - 注册进官方纯增量 list 槽 conversation.session.header.actions
 *        （session 作用域），标准 kit 自带 useWorkspaces，从
 *        workspaces.items 里按 sessionIds 反查当前会话的工作区 title；
 *      - 纯 slot 渲染，不搬 DOM、不改 DSH 源码，无占用冲突（该槽当前无
 *        其他插件占用，负数 order 让徽章排在交互动作之前紧贴标题）。
 *   4. 插件设置页（settings.section，v0.4.0；v0.4.1 起为第四个功能）
 *      - 官方设置中心新增「DSH UI 工具」页：集中开关各功能的偏好
 *        （工作区徽章 / 启动默认折叠 / 输出速度计）；
 *      - 偏好经 localStorage 持久化（host 侧 settings 命名空间需
 *        settings.register(ns, schema)，本插件保持纯浏览器，故沿用
 *        社区惯例 dsh-better-sidebar 同款 localStorage 存储）。
 *   5. 输出速度计 tok/s（v0.4.6；见下方「功能五取数段」整段注释）
 *      - 回合结束后：精确 tok/s 常驻在官方「用时」pill 左侧
 *        （注册进 conversation.chat.assistant-actions，order -10）；
 *      - 生成中：消息流末尾显示带「≈ / 生成中估算」标注的估算值
 *        （自建 token-speed-live chat 节点，走 uiConversation.events.register）。
 *
 * v0.4.9：功能三「修改的文件」选项卡（conversation.view）已整体移除。
 *   移除原因：其取数是同一份 chat target 快照的又一遍解析，与功能五（速度计）
 *   重复，且维护成本集中在 run_code 内嵌路径提取这类易碎逻辑上。移除后
 *   功能编号前移一位（旧四→三、旧五→四、旧六→五），子 fiber 只剩功能五
 *   （速度计），uiSession 依赖随之收窄。
 *
 * v0.4.10：功能一的座位紧贴输入框右侧的「听写」按钮。
 *   纯 CSS（MSS_CSS），不动任何注册逻辑。顺带修掉一个**潜伏的真实 bug**：
 *   MSS_CSS 前面的说明注释里出现了反引号，把模板串提前闭合，使
 *   ${OFFICIAL_TRIG} 原样留在生成的 CSS 里 → 隐藏官方模型按钮的规则整条失效，
 *   插件座位与官方控件会同时出现。成因与防护见 MSS_CSS 前的注释。
 *   守护断言：tools/check-model-seat-hug.mjs（已并入 npm run check）。
 *
 * 内核自适应（v0.4.2，方案 B：软依赖 + 子 fiber 隔离）：
 *   功能五（速度计）的取数依赖 0.1.2-alpha.1 才引入的 client target 体系
 *   服务 uiConversation / uiSession，0.1.1-rc.x 的 store 里没有它们的提供方。
 *   这两个硬依赖不再写在 loader entry 的 inject 上（否则旧内核整个 entry
 *   停在 PENDING，被 boot 末尾只遍历 ctx.loader.entries() 的审计判失败 →
 *   「web boot: 1 entry did not activate」+ Failed to load plugins 横幅，
 *   其余功能一起丢），而是收进 ctx.plugin(alphaFeatures) 子 fiber：
 *   新内核五功能齐备；旧内核静默降级为四项（子 fiber 停在 PENDING，
 *   不执行函数体、不进审计、无横幅），设置页里速度计开关灰显并提示
 *   所需内核。设计文档：DSH-Exoskeleton docs/UI-TOOLS-KERNEL-ADAPT-DESIGN.md。
 *
 * 五个功能各自独立命名空间（locale NS / slot id / data-* 前缀），互不干扰；
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
		 * v0.4.2：`uiConversation` 是 0.1.2-alpha.1 才引入的 client target
		 * 体系服务（功能三曾与之配套使用 `uiSession`；v0.4.9 功能三移除后
		 * 只剩 `uiConversation` 有消费者），0.1.1-rc.x 的 store 里没有
		 * 提供方——写在这里会让整个 entry 停在 PENDING，被 boot 末尾的
		 * loader entry 审计判为失败（`web boot: 1 entry did not activate`
		 * → Failed to load plugins 横幅，其余功能一起没了）。故把它收敛到
		 * alphaFeatures 子 fiber 的 inject（见下方子 fiber 头注释），
		 * 旧内核静默降级。
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

		// 官方模型触发按钮（中文/英文两套 aria-label）。写成两半拼接而非整串字面量，
		// 是为了让 MSS_CSS 能把它内联进模板串——理由见 MSS_CSS 前的注释。
		const OFFICIAL_TRIG =
			'button[aria-haspopup="menu"][aria-label^="选择模型"], button[aria-haspopup="menu"][aria-label^="Select model"]';
		/** 与 OFFICIAL_TRIG 等价、但可以被 MSS_CSS 模板串内联（不含 '"' 与 '$'）。 */
		const OFFICIAL_TRIG_A = "button[aria-haspopup=" + '"menu"' + "][aria-label^=" + '"选择模型"' + "]";
		const OFFICIAL_TRIG_B = "button[aria-haspopup=" + '"menu"' + "][aria-label^=" + '"Select model"' + "]";

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

			// ── Hook 顺序铁律（v0.4.12 崩溃修复）──
			// 本组件所有 Hook 必须无条件、按固定顺序执行；条件分支只允许出现在 Hook 之后或
			// Hook 回调内部。历史事故：v0.4.11 及以前把 `if (!available) return null;` 夹在
			// 两个 useEffect 之间，而 available = usable && face.ok，face.ok 来自 try/catch
			// 的 mssResolveDirectory（directoryFor 有缓存早返回，available 会随会话摇摆）。
			// React 从不清空 hook 数组，只按 hookIndex++ 覆盖：available=false 的那次渲染里
			// 后续 Hook 槽位残留上一次的值，若上次 open===null 则该槽是 undefined，卸载时
			// React 执行 destroy() → 抛 "undefined is not a function"。
			// 现在的写法：提前返回被移到全部 Hook 之后（见本组件末尾），判据收进回调内部。

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

			// 依赖数组不含 open：打开面板不该触发新一次目录拉取。load 本身幂等且
			// 由内核缓存，但每次 setOpen 都重发一次是多余请求（v0.4.12）。
			useEffect(() => {
				if (available) load();
			}, [available, load]);

			useEffect(() => {
				if (!available || open === null) return;
				const onDown = (event) => {
					if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(null);
				};
				document.addEventListener("mousedown", onDown);
				return () => document.removeEventListener("mousedown", onDown);
			}, [open, available]);

			const chooseProvider = (groupId) => {
				setPickedProvider(groupId);
				setOpen(null);
			};
			const chooseModel = (model) => {
				// v0.4.12：原写法 `...cond === void 0 ? {} : {...}` 靠运算符优先级生效
				// （=== 高于 ?:，?: 高于展开），语义正确但极易被读成 `(...x) === void 0 ?`。
				// 改为显式条件赋值，行为完全一致。
				const selection = { provider: currentProviderId, model: model.id };
				if (model.reasoning?.defaultEffort !== void 0) {
					selection.reasoningEffort = model.reasoning.defaultEffort;
				}
				select(selection).then(() => {
					setOpen(null);
				});
			};
			const chooseEffort = (effort) => {
				if (current === null || currentProvider === null) return;
				const selection = { provider: currentProviderId, model: current.model };
				if (effort !== void 0) selection.reasoningEffort = effort;
				select(selection).then(() => {
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

			// 提前返回只能在全部 Hook 之后（见本组件上方「Hook 顺序铁律」）。
			// available=false 时本组件不渲染任何节点，但 Hook 链保持完整、槽位不残留。
			if (!available) return null;

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

		/* ── 为什么这里把官方触发按钮的选择器拆成两半写 ──
   这两条规则必须把官方按钮的选择器**内联进模板串**。选择器里含双引号，
   而双引号一旦写进模板串的源码文本，就会打破 ECMAScript 的
   「模板串字面量里的 ${ 不算插值点，而插值表达式内部的字符串里的 ${ 算插值点」
   这一成对例外，使后面的 ${...} 原样留在生成的 CSS 里 —— 选择器里出现一个
   不存在的 $ 元素、规则整条失效，官方模型按钮不再被隐藏，
   插件座位和官方控件会同时出现在输入框上。
   改成「字符串拼接出来的、不含引号字符的常量」后，这些常量与普通标识符无异，
   ${...} 正常求值，可以安全内联。（反引号不能出现在本块注释里：它属于外层 JS 的模板串文本。） */
		const MSS_CSS = `
/* ═══ dsh-ui-tools · 模型选择双按钮 ═══ */
${OFFICIAL_TRIG} {
	display: none !important;
}
/* 兜底：本插件的座位建不出来时（directoryFor 解析失败）把官方控件放回来，
   否则「官方被隐藏 + 插件座位缺席」会让模型选择器彻底消失。
   该规则必须排在隐藏规则之后：**同特异性**时靠源码顺序取胜（见上面注释：
   兜底组选择器与隐藏组特异性其实并不相同，但保持「兜底层在隐藏层之后」
   这条不变量仍然重要，将来若有人把兜底选择器简化成同特异性就会依赖它）。 */
html[data-ui-tools-model-seat="fallback"] ${OFFICIAL_TRIG_A},${OFFICIAL_TRIG_B} {
	display: inline-flex !important;
}
/* 内层排布：座位自己是个 inline-flex，两个按钮共享 6px 间距。 */
[data-mss-seat] {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

/* ── v0.4.10：让座位紧贴输入框的「听写」按钮 ──
   官方 composer 右侧动作区的结构（dsh-client-ui-conversation 的 InputBar）：
     div.trailing                      gap:12px; margin-left:auto
     ├── div.standardControls          gap:12px   ← 座位所在的槽的父容器
     │   ├── [conversation.input.right] ← 本插件座位
     │   └── [conversation.input.model] ← 官方模型按钮（已被上面隐藏）
     ├── div.activity                  flex:none  ← 听写按钮的槽
     │   └── span > button[aria-label="开始录音" / "Start recording"]
     └── button.primary                            ← 发送
   trailing 是 flex，座位与听写按钮之间的 12px 来自 trailing 的 gap（不是任何子元素的
   margin），所以只靠调座位自身的外边距无法吃掉它——必须把这个 gap 在「座位与 activity
   相邻」这一特定情形下改成 0。
   为什么用 :has() 而不是硬编码类名：内核用 CSS Module，类名带哈希（当前是
   uV2eYG_trailing / uV2eYG_activity），随每次构建变化；而 aria-label 是官方文案契约、
   data-* 与本插件的 data-mss-* 都稳定。下面整段不出现任何哈希。
   降级：浏览器不支持 :has() 时（旧 WebView）整段规则被丢弃，座位回到默认的 gap:12px，
   只是「不够贴近」，不会错位或消失——所以不需要 @supports 兜底。 */
div:has(> [data-mss-seat]) {
	/* 让座位成为这一行里唯一可伸缩的元素，从而被推到最右、贴住听写按钮。 */
	margin-left: auto;
}
/* 座位所在的 standardControls 里，官方模型按钮被隐藏，只剩本插件座位；
   当它后面紧跟听写按钮时，把两者之间那段 12px 的 gap 收掉。
   注意必须用**后代**匹配 aria-label（写成 "+ div [aria-label=…]"）而不是直接子元素：
   真实的听写按钮被包在 span.Gyyz9a_triggerAnchor 里（Tooltip 的 child），
   写成 "+ div > [aria-label=…]" 会永远不命中。
   这个错误由 tools/check-model-seat-hug.mjs 抓出——它是本仓库唯一能发现的途径，
   因为内核里那段 DOM 由另一个包渲染，静态阅读容易误判层次。
   （注：本文件是 ECMAScript 模板串，注释里**不能出现反引号**，会把字符串提前闭合。） */
div:has(> div > [data-mss-seat]):has(+ div [aria-label="开始录音"]),
div:has(> div > [data-mss-seat]):has(+ div [aria-label="Start recording"]) {
	column-gap: 0;
}
/* 同一条边的右侧：把 activity 的左边距清掉（官方把它设为 flex:none，本不需要 margin，
   这里是防止上游某天改成靠 margin 拉开的情形；写成 0 是无害的幂等规则）。 */
div:has(> div > [data-mss-seat]) + div:has([aria-label="开始录音"]),
div:has(> div > [data-mss-seat]) + div:has([aria-label="Start recording"]) {
	margin-left: 0;
}
/* ── 两个主按钮（供应商 / 模型）：淡描边 + 底色透明 + 文字色自适应主题 ──
   v0.4.11 按用户要求把这两个按钮的**背景色显式指定为透明**：常态不再有那层
   8% 品牌色底，视觉上就是输入框里两个「透明框」，与官方 composer 的其它无底
   控件连成一片。
   v0.4.13 曾把**常态文字色写死纯白 #fff**（深色底对比度最高）。
   v0.4.16 按用户要求改成**描边可见 + 文字色自适应**，白字写死的方案作废：
   ① 描边 --dsw-alias-border-l2 —— 深色 #ffffff1f、浅色 #0000001a，两套主题
      都有轮廓，又淡到不喧宾夺主（比 border-l3 那档更轻）。
   ② 文字色换成 --dsw-alias-label-primary，它本身是**主题自适应**标签色：
      浅色解析成 --dsw-static-neutral-bluish-1000（近黑），深色解析成
      --dsw-static-neutral-bluish-50（近白）。原先写死 #fff 在浅色主题下会变成
      「白字 + 近白 composer 底」直接隐形，这条一并修掉。
      箭头 .mss-caret 用 color: inherit，随文字自动同色。
   ③ 底色仍是 transparent：描边已经把可点性提示做到位，无需再加一层底。
   保留「交互反馈」：:hover / [aria-expanded="true"] 仍是半透明淡色（见下面
   两条规则），因为按钮一旦没有任何按压/展开反馈就失去可点性提示。
   若后续要求连悬停也全透明，把那两条的 background 一并改成 transparent 即可。
   （注：本文件是 ECMAScript 模板串，注释里**不能出现反引号**，会把字符串提前闭合。） */
[data-mss-btn] {
	position: relative;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	height: 28px;
	padding: 0 9px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));
	border-radius: 8px;
	background: transparent;
	color: var(--dsw-alias-label-primary, inherit);
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
/* ── 两个主按钮点开的弹出列表（面板）：完全不透明的实底 ──
   v0.4.13 按用户要求把面板由「90% 菜单色 + 14px 背景模糊」的毛玻璃改成**实底**，
   并删掉 backdrop-filter / -webkit-backdrop-filter 两条。半透明底 + blur 会让
   背后的深色 composer 与输入框文字透上来，读菜单时干扰明显。
   v0.4.16 用户再次确认「直接实底」后，底色不再取 --dsw-specific-menu——那个
   token 由内核定义成 --dsw-menu-surface-fill 并随平台/主题漂移（非 darwin 平台
   下是 #f8f9fa94 / #43454a73 这类半透明值），不是可靠的不透明实底。现改为字面
   写死的 #f8f9fa（等价于内核浅色 --dsw-static-neutral-bluish-50），并由紧随
   其后的深色主题规则换成 #2c2c2e（等价 --dsw-static-neutral-bluish-850）。
   描边（--dsw-alias-border-l2）、圆角 12px、三级投影一律保留——它们负责把浮层
   与背后的 composer 分层，删掉会让菜单「贴」在输入框上分不清边界。
   面板文字一律写死：#0f1115（浅色近黑）/ #f9fafb（深色近白），
   成对取自本插件的实底，不与内核 token 混用（v0.4.19 起把旧注释里
   「浅色取 label-primary、深色取 label-primary-foreground」的说法改掉——
   label-primary 在本机浅色主题下解析成 #f9fafb 近白，落在 #f8f9fa 上等于隐形）。
   注意：**不要**把主按钮那条纯白文字规则外溢到这里（断言第 4/5 条就是防这个）。 */
[data-mss-panel] {
	position: absolute;
	bottom: calc(100% + 6px);
	right: 0;
	z-index: 120;
	min-width: 200px;
	max-width: min(320px, 70vw);
	max-height: min(340px, 60vh);
	overflow: auto;
	background: #f8f9fa;
	border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08));
	border-radius: 12px;
	box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0,0,0,.16));
	padding: 4px;
	animation: mss-panel-in .16s cubic-bezier(.4, 0, .2, 1) ease-out;
	transform-origin: bottom right;
	/* v0.4.18：面板文字一律**字面写死**，不再引用内核 token。
	   原因见下面「面板文字配色」整段注释 —— 内核的 --dsw-alias-label-* 是给
	   内核自己的表面用的，配到本插件这套字面实底上会出现对比度不足。 */
	color: #0f1115;
}
/* ── v0.4.18：面板文字配色（全套字面写死 + 深浅两套）──
   【问题】v0.4.16 只把「面板根节点」的文字换了，下拉项、分组标题、描述、
   空态/加载态这些子元素仍在引用内核 token：
     .mss-group-title / .mss-row .mss-desc / .mss-empty / .mss-loading
       → var(--dsw-alias-label-tertiary) / var(--dsw-alias-label-caption)
   查内核主题源码（@deepseek-ai/dsh-client-ui-theme/lib/client.js）可得这两组
   token 的两套取值：
     label-tertiary  浅色 #81858c  深色 #adb2b8
     label-caption   浅色 #adb2b8  深色 #81858c
   而本插件面板的实底是**自己写死的** #f8f9fa（浅色）/ #2c2c2e（深色），
   不是内核那套表面 —— token 与实底是两套独立体系，于是出现两种翻车：
     ① 浅色面板 #f8f9fa 配 #81858c：对比度约 3.3:1，11px 小字直接发灰；
     ② 深色面板 #2c2c2e 配 caption #81858c：约 3.2:1，同样偏弱。
   另外还有两个同源问题：
     ③ .mss-row[aria-checked="true"] 的选中底用 color-mix(品牌色 12%)，
        而内核的 --dsw-alias-brand-primary 在本机解析成**近黑**（bluish-1000），
        浅色面板上那层选中底几乎看不见、深色面板上被白字盖成一条暗条；
     ④ .mss-row:hover 用 --dsw-alias-interactive-bg-hover，该 token 浅色是
        #2631480f、深色是 #ffffff14，是给内核表面调的，落在本插件的实底上偏薄。
   所以本轮把面板内**每一个**文字层与两种交互底全部改成字面值：面板配色
   完全自洽，不再与内核 token 的任何一次主题改动产生牵动。
   【为什么不用 color-scheme + light-dark()】那两条是 2024 年才进基线的新特性
   （light-dark() 要求 Chrome 123+），DSH 桌面端/旧 WebView 上没有强制升级保证；
   而本项目已有成熟做法：用 [data-ds-dark-theme] 属性选择器切两套字面值
   （内核 0.2.x 把主题挂在 body 上，故 html 与任意容器两条都写，特异性足够
   稳压上面的基础规则，不依赖 :where()/:is() 这种会把特异性降为 0 的写法）。
   【为什么不用 var(--x, fallback) 兜底】兜底只在 token 缺席时生效；本机 token
   恰恰是**存在但取值不适合这套实底**，兜底永远轮不到 —— 必须字面写死。 */
html[data-ds-dark-theme] [data-mss-panel],
[data-ds-dark-theme] [data-mss-panel] {
	background: #2c2c2e;
	color: #f9fafb;
}
@keyframes mss-panel-in {
	from { opacity: 0; transform: translateY(3px) scale(.98); }
	to   { opacity: 1; transform: none; }
}
[data-mss-panel] .mss-group-title {
	/* 浅色 #5f6469 配 #f8f9fa ≈ 6.3:1；深色 #b9bec6 配 #2c2c2e ≈ 7.1:1。 */
	color: #5f6469;
	font-size: 11px;
	line-height: 18px;
	padding: 5px 8px 2px;
}
html[data-ds-dark-theme] [data-mss-panel] .mss-group-title,
[data-ds-dark-theme] [data-mss-panel] .mss-group-title {
	color: #b9bec6;
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
	/* 字面 hover 底：浅色 ≈ 6% 墨色，深色 ≈ 8% 白色（原本靠内核
	   --dsw-alias-interactive-bg-hover，那是给内核表面调的，落在本插件实底上太薄）。 */
	background: rgba(0, 0, 0, .06);
}
html[data-ds-dark-theme] [data-mss-panel] .mss-row:hover:not(:disabled),
[data-ds-dark-theme] [data-mss-panel] .mss-row:hover:not(:disabled) {
	background: rgba(255, 255, 255, .08);
}
[data-mss-panel] .mss-row[aria-checked="true"] {
	/* 选中底：内核 --dsw-alias-brand-primary 在本机解析成近黑（bluish-1000），
	   color-mix(…12%) 落在浅色面板上几乎看不见，故改用字面品牌蓝 4176e6。 */
	background: rgba(65, 118, 230, .12);
}
html[data-ds-dark-theme] [data-mss-panel] .mss-row[aria-checked="true"],
[data-ds-dark-theme] [data-mss-panel] .mss-row[aria-checked="true"] {
	background: rgba(90, 140, 250, .22);
}
/* 选中项与 hover 同时存在时 hover 不该把选中底洗掉（两者特异性相同，
   这里显式补一条特异度更高的规则保持选中态可见）。 */
[data-mss-panel] .mss-row[aria-checked="true"]:hover:not(:disabled) {
	background: rgba(65, 118, 230, .18);
}
html[data-ds-dark-theme] [data-mss-panel] .mss-row[aria-checked="true"]:hover:not(:disabled),
[data-ds-dark-theme] [data-mss-panel] .mss-row[aria-checked="true"]:hover:not(:disabled) {
	background: rgba(90, 140, 250, .28);
}
[data-mss-panel] .mss-row .mss-check {
	/* 勾选色：--dsw-alias-brand-text 在本机解析成**近黑**，落在深色面板上等于
	   隐形，浅色面板上又没有品牌感 —— 一律改成字面品牌蓝，深浅两套各取一档。 */
	color: #4176e6;
	flex: none;
	font-size: 14px;
}
html[data-ds-dark-theme] [data-mss-panel] .mss-row .mss-check,
[data-ds-dark-theme] [data-mss-panel] .mss-row .mss-check {
	color: #6a9bff;
}
[data-mss-panel] .mss-row .mss-desc {
	display: block;
	/* 浅色 #6a7079 配 #f8f9fa ≈ 4.9:1（11px 小字达标）；深色 #a7adb6 ≈ 5.3:1。 */
	color: #6a7079;
	font-size: 11px;
	line-height: 16px;
}
html[data-ds-dark-theme] [data-mss-panel] .mss-row .mss-desc,
[data-ds-dark-theme] [data-mss-panel] .mss-row .mss-desc {
	color: #a7adb6;
}
[data-mss-panel] .mss-empty,
[data-mss-panel] .mss-loading {
	padding: 10px 8px;
	color: #5f6469;
	font-size: 12px;
	line-height: 18px;
}
html[data-ds-dark-theme] [data-mss-panel] .mss-empty,
html[data-ds-dark-theme] [data-mss-panel] .mss-loading,
[data-ds-dark-theme] [data-mss-panel] .mss-empty,
[data-ds-dark-theme] [data-mss-panel] .mss-loading {
	color: #b9bec6;
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

		// v0.4.12：WC_STYLE_ID 已删除——功能二不再单独注入 <style>，WC_CSS 并入 apply 顶部的
		// 共享标签（原实现是两份：共享标签漏拼了 WC_CSS，功能二又自建了一个只装 WC_CSS 的
		// 标签，等于同一份规则注入两次且各自拆卸）。现在共享标签统一持有全部五份 CSS。
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
		 * 会话 target 体系的两个共享常量（v0.4.9 起由功能五独占使用）
		 *
		 * 历史：功能三「修改的文件」tab（v0.2.0 新增）曾与功能五共用这对
		 * 常量。功能三在 v0.4.9 被整体移除，常量保留在此处是因为功能五
		 * 的 tspChatSource 仍需读同一个 chat target。
		 * ══════════════════════════════════════════════════════════════ */

		/** 会话内容 target 名：官方「对话」视图注册的 target（0.1.2-alpha.1 起）。 */
		const MFS_CHAT_TARGET = "chat";
		/** chat target 未就绪时的空快照（官方 dsh-client-ui-chat 内联同款；只含功能五读取的 legacy 字段）。 */
		const MFS_EMPTY_CHAT = { legacy: { nodes: [], runningCalls: [] } };
		/* ══════════════════════════════════════════════════════════════
		 * alpha-only 子 fiber（v0.4.2 内核自适应）
		 *
		 * 功能五「输出速度计」的取数依赖 0.1.2-alpha.1 才引入的 client
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
		 * 注：v0.4.9 起功能三「修改的文件」tab 已整体移除，本子 fiber 只剩
		 * 功能五；分层的理由与机制完全未变（旧内核上功能五静默缺席）。
		 *
		 * config = { prefs, capability }：apply 期创建的偏好仓库与能力仓库。
		 * ══════════════════════════════════════════════════════════════ */
		/** 仅在提供 uiConversation 的内核上激活；旧内核上本函数体不会执行。 */
		function alphaFeatures(ctx, config) {
			const { prefs, capability } = config;

			// 形状探测：服务在但 API 改名/换形状时，本功能整体缺席而不是抛错。
			if (typeof ctx.uiConversation?.binding !== "function") {
				console.warn("[dsh-ui-tools] session target API shape changed; token-speed feature is skipped");
				return;
			}

			// 能力通告：执行到这里说明 target 体系齐备 —— 设置页据此解除灰显；
			// 子 fiber 卸载（服务消失 / entry dispose）时置回 false。
			ctx.effect(() => {
				capability.set({ alphaApi: true });
				return () => capability.set({ alphaApi: false });
			}, "ui-tools: alpha capability flag");

			// ── 功能五：输出速度计（v0.4.6）──
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
			// 缺席**，绝不能抛出 —— 本函数体与功能五其余注册同处一个子 fiber，抛错会让
			// capability 回滚、整套速度计一起 FAIL（compat-check 场景 B/C 正是
			// 用只提供 binding 的假服务钉住这一点）。精确 pill 不依赖该通道。
			if (typeof ctx.uiConversation.events?.register === "function") {
				ctx.uiConversation.events.register(tspLiveDefinition());
			} else {
				console.warn("[dsh-ui-tools] uiConversation.events.register unavailable; token-speed live meter is skipped");
			}
		}

		/** alpha-only 硬依赖收敛到子 fiber —— 这一行是本方案的关键。
		 *  v0.4.9：功能三移除后 uiSession 已无消费者（它是 useModifiedFiles
		 *  hook 的宿主），依赖收窄为 uiConversation。这与 §10 的降级门控
		 *  完全一致：旧内核（无 target 体系）上子 fiber 照旧停在 PENDING，
		 *  功能五静默缺席、设置页开关灰显。 */
		alphaFeatures.inject = ["uiConversation"];

		/* ══════════════════════════════════════════════════════════════
		 * 功能三：会话标题旁工作区徽章（conversation.session.header.actions）
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

			// ── Hook 顺序铁律（v0.4.12 崩溃修复，第二处）──
			// 原实现把 `if (!prefsState.chipEnabled) return null;` 写在了 useWorkspaces 之前，
			// 属同一类崩溃：开关关闭的渲染里，Hook 槽位残留上一次（开启时）的值；
			// 重新开启或组件卸载时 React 按残留槽位调 destroy/重新订阅，行为不可预期。
			// 现在：全部 Hook 无条件执行，判据收进选择器与渲染分支。
			const prefsState = usePrefs(prefs);
			const workspace = useWorkspaces((state) =>
				state.items.find((workspace) => workspace.sessionIds.includes(sessionId))
			);

			// 以下判据全部在 Hook 之后，安全。
			if (!prefsState.chipEnabled) return null;
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
		 * 功能五：输出速度计 tok/s（v0.4.6）
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
		 * 取数复用同一份 chat target 快照机制（WeakMap 缓存），
		 * 不新增 entry 层 inject；全部能力仍在 alphaFeatures 子 fiber 内。
		 * ══════════════════════════════════════════════════════════════ */

		/* ══════════════════════════════════════════════════════════════
		 * 功能六：右键上下文菜单（v0.4.13）
		 *
		 * 参考插件：@baihejiangnan/dsh-session-context-menu（作者 baihejiangnan）。
		 * 本功能在**思路上**参考了它，但实现完全自写：用我们自己的 DOM 判据、
		 * 自己的会话解析、自己的菜单渲染，**不 import、不依赖、不 require**
		 * 对方任何代码 —— 对方卸载或改名都不影响本功能（R4 纯浏览器 + R6 无构建）。
		 *
		 * 与参考插件的两个关键差异（这是本实现的立足点）：
		 *   ① 参考插件只面向应用封装端（Tauri/EAC/Electron），README 明说
		 *      「不适配原生 Web 端」；本实现是**纯 DOM 方案，无任何宿主 RPC**，
		 *      因此在浏览器里直接开 dsh web 也照常工作。
		 *   ② 参考插件的「打开目录」要打宿主路由；这里改成**只复制路径**，
		 *      把「打开」交给系统文件管理器由用户自己粘贴 —— 少一条会失败的链路，
		 *      也就不会出现「xxx is a directory」这类被别的插件包装后踩到的坑。
		 *
		 * 三条纪律（对应铁律）：
		 *   - R2：**绝不搬动 slot 渲染出来的 DOM 节点**。菜单是 appendChild 到
		 *     body 的**新节点**，只读地查询既有 DOM，不移动、不包裹、不观察。
		 *   - R3：**只用入口已声明的服务**（sessions / workspaces / locale），
		 *     不新增 entry 层 inject —— 多一个声明就多一条旧内核停 PENDING 的风险。
		 *   - R8：apply 期不写函数组件，无非 Hook 函数；若日后加组件，
		 *     条件 return 必须放在全部 Hook 之后。
		 *
		 * 安全性：会话解析沿「DOM 行 id → 当前选中行 → 标题唯一命中」三级降级，
		 * **只在能唯一确定目标时才接管浏览器默认菜单**；判不出来就让默认菜单照常
		 * 弹出（宁可不接管，也不给出一个可能操作错对象的菜单）。
		 * ══════════════════════════════════════════════════════════════ */

		const CTX_NS = "context-menu";
		const CTX_ZH = {
			"menu.rename": "重命名",
			"menu.archive": "归档会话",
			"menu.delete": "删除会话…",
			"menu.fork": "创建会话分支",
			"menu.copySessionId": "复制会话 ID",
			"menu.copyCwd": "复制工作目录",
			"menu.newSession": "新建会话",
			"menu.copyWorkspacePath": "复制工作区路径",
			"menu.archiveWorkspaceSessions": "归档工作区全部会话",
			"menu.copySelection": "复制所选文本",
			"menu.sendSelection": "发送所选文本到输入框",
			"menu.refresh": "刷新页面",
			"toast.copiedSessionId": "已复制会话 ID",
			"toast.copiedCwd": "已复制工作目录",
			"toast.copiedWorkspacePath": "已复制工作区路径",
			"toast.copied": "已复制",
			"toast.sent": "已送入输入框",
			"toast.archived": "已归档 {count} 个会话",
			"toast.forked": "已创建分支",
			"toast.noComposer": "找不到输入框，无法送入",
			"toast.clipboardFailed": "复制失败，请手动选择复制",
			"toast.archiveFailed": "归档失败",
			"toast.forkFailed": "分叉失败",
			"fail.sessionUnknown": "无法确定目标会话",
			"fail.workspaceUnknown": "无法确定目标工作区",
			"fail.noSessions": "该工作区没有可归档的会话",
			"fail.officialRename": "无法打开官方重命名窗口",
			"fail.renameDialog": "找不到重命名输入框",
			"fail.noUiWorkspace": "当前内核未提供工作区导航服务（uiWorkspace），无法执行该操作",
			"fail.noWorkspacePath": "读不到该工作区的路径，无法复制",
			// 「未分组」分组（侧边栏底部那些不属于任何工作区的散会话）既没有
			// workspaceId 也没有 path。这两种情况必须单独措辞：直接复用上面
			// 两条会把「这是一条未分组行」这个真实原因藏起来。
			"fail.ungroupedNoWorkspace": "「未分组」不属于任何工作区，无法在此新建会话；请右键一个具体工作区",
			"fail.ungroupedNoPath": "「未分组」不对应任何工作区目录，没有路径可复制",
			// ── 删除会话（v0.4.20）──
			// 删除是不可撤销的，所以文案必须把「不可撤销」「删的是什么」讲清楚，
			// 而不是一句含糊的「确定吗」。
			"confirm.deleteTitle": "删除会话「{title}」？",
			"confirm.deleteBody": "会话记录会从磁盘上永久删除，无法撤销。工作目录里的文件不受影响。",
			"confirm.deleteAction": "永久删除",
			"confirm.deleteCancel": "取消",
			"toast.deleting": "正在删除会话…",
			"toast.deleted": "已删除会话「{title}」",
			"toast.deleteFailed": "删除失败：{reason}",
			// 宿主半边缺席时必须有话直说，别让用户以为点了没反应。
			"fail.deleteNoChannel": "当前内核未提供插件通道（connection），无法删除会话；请升级内核，或改用「归档会话」",
			"fail.deleteNoHost": "插件宿主半边未加载（宿主进程只在启动时装配插件），无法删除会话；请重启 DSH 后重试，或先改用「归档会话」",
			// ── 删除工作区全部会话（v0.4.22）──
			"menu.deleteWorkspaceSessions": "删除工作区全部会话…",
			"confirm.deleteWorkspaceTitle": "删除「{title}」的全部 {count} 个会话？",
			"confirm.deleteWorkspaceBody": "这些会话记录会从磁盘上永久删除，无法撤销。工作目录里的文件不受影响。",
			"toast.deleteWorkspaceDone": "已删除「{title}」的 {count} 个会话",
			"toast.deletePartial": "已删除 {count} 个，{failed} 个失败：{reason}",
			"fail.noWorkspaceSessions": "该工作区没有可删除的会话",
			// ── 批量删除进度 + 子会话级联（v0.4.23）──
			// 「已删除 3/20」用一次请求内的逐条结果推进，不是动画猜的。
			"toast.deleteProgress": "正在删除 {done}/{total}…",
			// 删父会话时把子孙分支一起删掉，确认条里必须如实说出这件事。
			"confirm.deleteCascadeBody": "会话记录会从磁盘上永久删除，无法撤销。工作目录里的文件不受影响。\n\n该会话下还有 {count} 个子会话分支，会一并删除。",
			"toast.deletedCascade": "已删除会话「{title}」（连带 {count} 个子会话）",
			"fail.noChildSessions": "该会话没有需要级联删除的子会话",
			"toast.reloading": "正在刷新页面…"
		};
		const CTX_EN = {
			"menu.rename": "Rename",
			"menu.archive": "Archive session",
			"menu.delete": "Delete session…",
			"menu.fork": "Fork session",
			"menu.copySessionId": "Copy session ID",
			"menu.copyCwd": "Copy working directory",
			"menu.newSession": "New session",
			"menu.copyWorkspacePath": "Copy workspace path",
			"menu.archiveWorkspaceSessions": "Archive all sessions in workspace",
			"menu.copySelection": "Copy selected text",
			"menu.sendSelection": "Send selected text to composer",
			"menu.refresh": "Refresh page",
			"toast.copiedSessionId": "Session ID copied",
			"toast.copiedCwd": "Working directory copied",
			"toast.copiedWorkspacePath": "Workspace path copied",
			"toast.copied": "Copied",
			"toast.sent": "Sent to composer",
			"toast.archived": "Archived {count} sessions",
			"toast.forked": "Fork created",
			"toast.noComposer": "Composer not found",
			"toast.clipboardFailed": "Copy failed; select and copy manually",
			"toast.archiveFailed": "Archive failed",
			"toast.forkFailed": "Fork failed",
			"fail.sessionUnknown": "Could not determine the target session",
			"fail.workspaceUnknown": "Could not determine the target workspace",
			"fail.noSessions": "This workspace has no sessions to archive",
			"fail.officialRename": "Could not open the official rename dialog",
			"fail.renameDialog": "Rename input not found",
			"fail.noUiWorkspace": "This kernel provides no workspace navigation service (uiWorkspace), so the action cannot run",
			"fail.noWorkspacePath": "Could not read this workspace's path, so there is nothing to copy",
			"fail.ungroupedNoWorkspace": "\"Ungrouped\" belongs to no workspace, so a session cannot be started here; right-click a real workspace instead",
			"fail.ungroupedNoPath": "\"Ungrouped\" maps to no workspace directory, so there is no path to copy",
			// ── 删除会话（v0.4.20）──
			"confirm.deleteTitle": "Delete session \"{title}\"?",
			"confirm.deleteBody": "The session log is permanently removed from disk and cannot be undone. Files in the working directory are untouched.",
			"confirm.deleteAction": "Delete permanently",
			"confirm.deleteCancel": "Cancel",
			"toast.deleting": "Deleting session…",
			"toast.deleted": "Session \"{title}\" deleted",
			"toast.deleteFailed": "Delete failed: {reason}",
			"fail.deleteNoChannel": "This kernel provides no plugin channel (connection), so the session cannot be deleted; upgrade the kernel or use \"Archive session\" instead",
			"fail.deleteNoHost": "The plugin's host half is not loaded (the host only assembles plugins at startup), so the session cannot be deleted; restart DSH and retry, or use \"Archive session\" for now",
			// ── 删除工作区全部会话（v0.4.22）──
			"menu.deleteWorkspaceSessions": "Delete all sessions in workspace…",
			"confirm.deleteWorkspaceTitle": "Delete all {count} sessions of \"{title}\"?",
			"confirm.deleteWorkspaceBody": "These session logs are permanently removed from disk and cannot be undone. Files in the working directory are untouched.",
			"toast.deleteWorkspaceDone": "Deleted {count} sessions of \"{title}\"",
			"toast.deletePartial": "Deleted {count}; {failed} failed: {reason}",
			"fail.noWorkspaceSessions": "This workspace has no sessions to delete",
			// ── 批量删除进度 + 子会话级联（v0.4.23）──
			"toast.deleteProgress": "Deleting {done}/{total}…",
			"confirm.deleteCascadeBody": "The session logs are permanently removed from disk and cannot be undone. Files in the working directory are untouched.\n\nThis session has {count} child session branches, which will be deleted too.",
			"toast.deletedCascade": "Session \"{title}\" deleted (with {count} child sessions)",
			"fail.noChildSessions": "This session has no child sessions to cascade",
			"toast.reloading": "Reloading…"
		};

		/**
		* 会话行判据。官方工作区树的会话行带 data-row-key="session:<id>"；
		* 工作区行是 "workspace:<id>"，因此这个前缀不会误判。
		*
		* 为什么不能只看 aria-label：官方 row-actions 按钮在**空白会话 / 已归档
		* 会话**上根本不渲染，只靠「有『会话操作』按钮」判定会把这类行判成
		* 非会话行 —— 菜单退化、拿不到 session。data-row-key 是渲染时写死的，
		* 不依赖标题、不依赖界面语言。（这个坑由参考插件的注释指出，此处按同一
		* 结论自写实现。）
		*/
		function ctxSessionRowId(row) {
			if (row === null || row === void 0) return null;
			const key = row.getAttribute("data-row-key") || "";
			if (key.slice(0, 8) === "session:") {
				const id = key.slice(8);
				return id === "" ? null : id;
			}
			return null;
		}

		/**
		* 工作区行判据。官方工作区树的**具名**工作区行带
		* data-row-key="workspace:<workspaceId>"（见 dsh-client-ui-workspace 的
		* `"data-row-key": \`workspace:${group.key}\``，而 groupByWorkspace 里
		* `buildGroup(workspace.workspaceId, workspace.workspaceId, ...)` 前两个参数
		* 都是 workspaceId，所以 key === workspaceId）。
		*
		* ⚠ 但**散会话分组**（侧边栏底部那个「未分组」）的 key 是**空字符串**：
		*   `buildGroup("", void 0, void 0, void 0, "", ...)`
		* 因此它的 data-row-key 恰好是 "workspace:"。这里必须把它也认出来并
		* 返回 "" 而不是 null —— 否则整个工作区分支会因为解析不出 workspace
		* 对象而**连菜单都不弹**（v0.4.15 修的第二个 bug）。
		* 调用方拿到 "" 时按「未分组分组」处理：它没有 workspaceId、没有 path，
		* 只能给出「新建会话（走当前工作区）」，复制路径一类项要明确提示不可用。
		*/
		function ctxWorkspaceRowId(row) {
			if (row === null || row === void 0) return null;
			const key = row.getAttribute("data-row-key") || "";
			if (key.slice(0, 10) === "workspace:") return key.slice(10);
			return null;
		}

		/** 该行是不是「散会话 / 未分组」分组行（data-row-key 恰好是 "workspace:"）。 */
		function ctxIsUngroupedRow(row) {
			return ctxWorkspaceRowId(row) === "";
		}

		/** 从事件目标向上找最近的 treeitem 行。 */
		function ctxRowFrom(target) {
			if (!(target instanceof Element)) return null;
			return target.closest('[role="treeitem"]');
		}

		/**
		* 把 DOM 行解析成会话对象。三级降级，**任一级无法唯一确定就返回 null**
		* （调用方据此保留浏览器默认菜单，绝不猜）。
		*/
		function ctxResolveSession(sessions, row, workspace) {
			if (row === null || row === void 0) return null;
			const state = sessions.list.getSnapshot();
			// 1) 最可靠：DOM 行自带的 id（渲染时写死）。
			const domId = ctxSessionRowId(row);
			if (domId !== null) return state.byId[domId] || { id: domId };
			// 2) 当前选中行：store 的 current 就是答案。
			if (row.getAttribute("aria-selected") === "true" && state.current) {
				return state.byId[state.current] || { id: state.current };
			}
			// 3) 退路：按标题匹配，但只在**唯一命中**时采用，避免操作错会话。
			const raw = row.getAttribute("aria-label") || row.getAttribute("title") || "";
			const title = raw.trim();
			if (title === "") return null;
			const ids = workspace !== null && workspace !== void 0 && workspace.sessionIds ? workspace.sessionIds : state.ids;
			const matches = [];
			for (const id of ids) {
				const item = state.byId[id];
				if (item === void 0) continue;
				if (item.title === title || item.displayTitle === title) matches.push(item);
				else if (item.blank === true && /^(新会话|new session)$/i.test(title)) matches.push(item);
			}
			return matches.length === 1 ? matches[0] : null;
		}

		/**
		* 把 DOM 行解析成工作区对象。
		*
		* 三级降级（v0.4.15 重写）：
		*   1) data-row-key="workspace:<workspaceId>" —— 官方渲染时写死的 id，
		*      不依赖标题、不依赖界面语言，**这是唯一可靠的一级**。
		*      拿到 id 但在快照 items 里查不到（列表还没加载完）时，不立刻
		*      放弃，而是合成一个只带 workspaceId 的**窄对象**：这样「新建会话」
		*      这类只需要 id 的动作仍然可用，比直接不弹菜单好得多。
		*   2) 未分组分组（data-row-key 恰好 "workspace:"）：它没有 workspaceId、
		*      没有 path，返回一个带 ungrouped 标记的窄对象，让菜单能弹出来
		*      并给出「未分组」语境下正确的项目（而不是整个菜单消失）。
		*   3) 退路：按 aria-label/title 与叶节点文本比对标题，**只在唯一命中时
		*      采用**，避免操作错工作区。多命中或零命中一律返回 null，调用方
		*      会放行浏览器原生菜单、绝不猜。
		*/
		function ctxResolveWorkspace(workspaces, row) {
			if (row === null || row === void 0) return null;
			const items = workspaces.list.getSnapshot().items || [];
			const domId = ctxWorkspaceRowId(row);
			// 1) 渲染时写死的 id —— 最可靠。
			if (domId !== null && domId !== "") {
				for (const item of items) if (item.workspaceId === domId) return item;
				// 快照还没加载到这个工作区：合成窄对象，保住能只用 id 的动作。
				return { workspaceId: domId, path: "", title: "", sessionIds: [], ungrouped: false, idOnly: true };
			}
			// 2) 未分组分组行。
			if (domId === "") return { workspaceId: void 0, path: "", title: "", sessionIds: [], ungrouped: true, idOnly: true };
			// 3) 按标题唯一匹配。
			const label = (row.getAttribute("aria-label") || row.getAttribute("title") || "").trim();
			const matches = [];
			for (const item of items) {
				if (label !== "" && label === (item.title || "").trim()) { matches.push(item); continue; }
				for (const node of row.querySelectorAll("span,button,div")) {
					if (node.closest('[role="treeitem"]') !== row) continue;
					if (node.children.length !== 0) continue;
					if ((node.textContent || "").trim() === (item.title || "").trim() && (item.title || "").trim() !== "") {
						matches.push(item);
						break;
					}
				}
			}
			return matches.length === 1 ? matches[0] : null;
		}

		/** 写剪贴板。navigator.clipboard 不可用时回退 execCommand。 */
		function ctxCopy(text) {
			const write = () => {
				if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
					return navigator.clipboard.writeText(text);
				}
				return Promise.reject(new Error("no clipboard api"));
			};
			return write().catch(() => {
				const area = document.createElement("textarea");
				area.value = text;
				area.setAttribute("readonly", "");
				area.style.position = "fixed";
				area.style.opacity = "0";
				document.body.appendChild(area);
				area.select();
				let ok = false;
				try { ok = document.execCommand("copy"); } catch (error) { ok = false; }
				area.remove();
				if (!ok) return Promise.reject(new Error("copy failed"));
				return void 0;
			});
		}

		/**
		 * 刷新页面。
		 *
		 * 为什么要包一层、而不是直接写 window.location.reload()：
		 *
		 * DSH 桌面端跑在 Electron 的 `dsh-app://app/` **自定义协议**上
		 * （registerSchemesAsPrivileged: standard+secure）。location.reload()
		 * 在这个 origin 上**是有效的**（protocol.handle 会重新走本地 dist），
		 * 但有两个坑：
		 *
		 *   1. reload() 在极少数情况下会被吞。所以这里保底再走一次
		 *      location.replace(location.href) —— 两条不同的导航路径，
		 *      一条不通还有另一条。
		 *   2. reload 后 URL 不变（DSH 前端无 SPA 路由，恒为 dsh-app://app/），
		 *      且会话/视图从 localStorage 恢复，所以**看起来像没刷新**。
		 *      这是预期行为、不是 bug，但用户会误判，所以刷新前先给一条
		 *      提示，让「确实刷新了」这件事可见。
		 */
		function ctxReload(reloadingText) {
			// 【v0.4.15 修复】这里是**模块作用域**，拿不到 installContextMenu(scope, t, …)
			// 的形参 t。旧代码直接写 ctxToast(t("toast.reloading")) 会抛
			// "t is not defined"，在 try 之前炸掉 —— 点「刷新页面」只弹一条报错、
			// 页面根本不刷新（真机实测：toast 里显示的正是 "t is not defined"）。
			// 所以文案由调用方算好传进来，本函数不引用 t。
			if (typeof reloadingText === "string" && reloadingText !== "") ctxToast(reloadingText);
			try {
				window.location.reload();
			} catch (error) {
				ctxToast(String((error && error.message) || error));
				return;
			}
			// 保底：reload 若被吞，用 replace 再推一次。
			window.setTimeout(() => {
				try { window.location.replace(window.location.href); } catch (error) { /* 已经导航走了就算了 */ }
			}, 150);
		}

		/** 轻提示。1.8s 自动消失；同一时刻只留一个。 */
		function ctxToast(message) {
			const old = document.querySelector(".dsh-ctx-toast");
			if (old !== null) old.remove();
			const node = document.createElement("div");
			node.className = "dsh-ctx-toast";
			node.setAttribute("role", "status");
			node.textContent = message;
			document.body.appendChild(node);
			// ⚠ 定时器要挂在**当前窗口**上，不能直接写裸 setTimeout：
			//   ① 真机是浏览器，两者等价；
			//   ② 但在测试台 / 宿主类环境里，裸 setTimeout 可能是 node 的
			//      全局实现（走长定时器树、真实等 1.8s），而注入的 window 版
			//      是短延时版本 —— 两者混用时，**旧提示的清理定时器可能晚于
			//      新提示的插入**，于是「已删除」被「正在删除」覆盖，用户永远
			//      只看到过程提示、看不到结果。ctxReload 早已统一走
			//      window.setTimeout，这里补齐同一个纪律。
			try {
				if (typeof window !== "undefined" && window !== null && typeof window.setTimeout === "function") {
					window.setTimeout(() => { node.remove(); }, 1800);
					return;
				}
			} catch (error) { /* 取不到 window 就走下面的兜底 */ }
			setTimeout(() => { node.remove(); }, 1800);
		}

		/**
		* 「发送所选文本到输入框」：把选中文本填入 composer，**不自动发送**
		* （自动发送会把用户没检查过的内容直接送出去，太危险）。
		*
		* 为什么不用 React 受控 setter：宿主 composer 是受控组件，直接改
		* textarea.value 不会触发 React 的 onChange。这里沿用 React 官方的
		* 受控输入改写手法（取 prototype 上的原生 value setter 再派发 input），
		* 是纯 DOM 的通用做法，不依赖任何宿主内部 API。
		*/
		function ctxInsertIntoComposer(text) {
			const areas = document.querySelectorAll('textarea, [contenteditable="true"]');
			let target = null;
			for (const node of areas) {
				if (node.closest('[role="dialog"]') !== null) continue;
				if (node.getAttribute("aria-hidden") === "true") continue;
				target = node;
			}
			if (target === null) return false;
			if (target.tagName === "TEXTAREA") {
				const proto = Object.getPrototypeOf(target);
				const desc = Object.getOwnPropertyDescriptor(proto, "value");
				target.focus();
				if (desc && typeof desc.set === "function") desc.set.call(target, text);
				else target.value = text;
				target.dispatchEvent(new Event("input", { bubbles: true }));
				return true;
			}
			target.focus();
			target.textContent = text;
			target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
			return true;
		}

		/**
		* 官方「重命名」入口：在行的操作菜单里找到官方按钮点它，而不是自己
		* 实现重命名。找不到就如实报错，不静默失败。
		*
		* 为什么走这条路：官方重命名有自己的弹窗与校验，绕开它自己写一套会产生
		* 两套不一致的行为。参考插件也是同一思路（它按界面语言匹配菜单项文本）。
		*/
		function ctxOpenOfficialRename(row, t) {
			const actions = row.querySelectorAll('button[aria-label]');
			let trigger = null;
			for (const button of actions) {
				const label = (button.getAttribute("aria-label") || "").toLowerCase();
				if ((label.indexOf("会话") >= 0 && label.indexOf("操作") >= 0) ||
					(label.indexOf("session") >= 0 && label.indexOf("action") >= 0)) {
					trigger = button;
					break;
				}
			}
			if (trigger === null) return false;
			trigger.click();
			// 菜单是官方异步渲染的，下一帧再找。
			setTimeout(() => {
				const items = document.querySelectorAll('[role="menuitem"]');
				let hit = null;
				for (const item of items) {
					const clone = item.cloneNode(true);
					for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
					const text = (clone.textContent || "").trim();
					if (/^重命名$/.test(text) || /^rename$/i.test(text)) { hit = item; break; }
				}
				if (hit !== null) hit.click();
				else ctxToast(t("fail.officialRename"));
			}, 0);
			return true;
		}

		/** 构建一个菜单项按钮。 */
		function ctxMenuItem(label, onRun, opts) {
			const danger = opts !== void 0 && opts.danger === true;
			const shortcut = opts !== void 0 && typeof opts.shortcut === "string" ? opts.shortcut : "";
			const button = document.createElement("button");
			button.type = "button";
			button.className = danger ? "dsh-ctx-item dsh-ctx-item--danger" : "dsh-ctx-item";
			button.setAttribute("role", "menuitem");
			button.setAttribute("tabindex", "-1");
			const text = document.createElement("span");
			text.textContent = label;
			button.appendChild(text);
			if (shortcut !== "") {
				const hint = document.createElement("span");
				hint.className = "dsh-ctx-shortcut";
				hint.setAttribute("aria-hidden", "true");
				hint.textContent = shortcut;
				button.appendChild(hint);
			}
			// 错误一律转成提示，绝不让它冒泡成未捕获异常（会污染控制台、
			// 也让用户看不到失败原因）。
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				closeCtxMenu();
				try {
					const result = onRun();
					if (result !== void 0 && result !== null && typeof result.then === "function") {
						result.catch((error) => { ctxToast(String((error && error.message) || error)); });
					}
				} catch (error) {
					ctxToast(String((error && error.message) || error));
				}
			});
			return button;
		}

		function ctxSeparator() {
			const node = document.createElement("div");
			node.className = "dsh-ctx-separator";
			node.setAttribute("role", "separator");
			return node;
		}

		/** 关闭并清理当前菜单（幂等）。 */
		function closeCtxMenu() {
			const open = ctxMenuState.node;
			if (open === null) return;
			ctxMenuState.node = null;
			open.remove();
			const restore = ctxMenuState.restoreFocus;
			ctxMenuState.restoreFocus = null;
			if (restore !== null && typeof restore.focus === "function" && document.contains(restore)) {
				// 焦点还回原处，键盘用户不会「掉焦点」。
				try { restore.focus(); } catch (error) { /* 元素已不可聚焦，忽略 */ }
			}
		}

		/** 菜单单例状态。刻意放在模块作用域：同一时刻只允许一个菜单。 */
		const ctxMenuState = { node: null, restoreFocus: null };

		/** 把菜单摆到鼠标位置，并保证不越出视口。 */
		function ctxPositionMenu(root, x, y) {
			root.style.visibility = "hidden";
			const rect = root.getBoundingClientRect();
			const left = Math.max(6, Math.min(x, window.innerWidth - rect.width - 6));
			const top = Math.max(6, Math.min(y, window.innerHeight - rect.height - 6));
			root.style.left = left + "px";
			root.style.top = top + "px";
			root.style.visibility = "visible";
		}

		/**
		* 打开菜单。`plan` 由调用方（onContextMenu）判定好后传入 ——
		* 判定与渲染分开，判定失败时**根本不创建节点**，也就不会留下残骸。
		*/
		function ctxOpenMenu(plan, x, y) {
			closeCtxMenu();
			const root = document.createElement("div");
			root.className = "dsh-ctx-menu";
			root.setAttribute("role", "menu");
			root.style.left = x + "px";
			root.style.top = y + "px";
			for (const item of plan) {
				if (item === null) root.appendChild(ctxSeparator());
				else root.appendChild(ctxMenuItem(item.label, item.run, item.opts));
			}
			// 兜底：任何情况下菜单都必须至少有一项，否则不弹。
			if (root.querySelector('[role="menuitem"]') === null) return false;
			document.body.appendChild(root);
			ctxMenuState.node = root;
			ctxMenuState.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			ctxPositionMenu(root, x, y);
			const first = root.querySelector('[role="menuitem"]');
			if (first !== null) first.focus();
			return true;
		}

		/** 把 "{name}" 占位符替换成实参；缺省值原样返回。 */
		function ctxFill(template, values) {
			if (typeof template !== "string") return "";
			if (values === void 0 || values === null) return template;
			return template.replace(/\{(\w+)\}/g, (whole, key) => {
				const value = values[key];
				return value === void 0 || value === null ? "" : String(value);
			});
		}

		/**
		* 用键盘把当前焦点送回菜单项。确认条是菜单的「子模式」：取消后焦点必须
		* 回到刚点的那一项，否则键盘用户会掉焦点到 body。
		*/
		function ctxRestoreMenuFocus(index) {
			const root = ctxMenuState.node;
			if (root === null) return;
			const items = root.querySelectorAll('[role="menuitem"]');
			if (items.length === 0) return;
			const at = Math.max(0, Math.min(index, items.length - 1));
			try { items[at].focus(); } catch (error) { /* 不可聚焦就随它去 */ }
		}

		/**
		* 二次确认面板。删除会话是**不可撤销**的，必须让人在看清「删哪个会话、
		* 删的是什么」之后才动手；所以不用 window.confirm（阻塞、样式不统一、
		* 且部分内核环境里被禁用），而是在菜单原位置换成一个 role="alertdialog"。
		*
		* @param messages { title, body, action, cancel, danger? } 全部是已本地化文案。
		* @param onConfirm 点「永久删除」时执行；返回值会被忽略。
		* @param opts { restoreIndex } 取消后要还焦点回菜单的第几项。
		*/
		function ctxConfirmDialog(messages, onConfirm, opts) {
			closeCtxMenu();
			const root = document.createElement("div");
			root.className = "dsh-ctx-menu dsh-ctx-confirm";
			root.setAttribute("role", "alertdialog");
			root.setAttribute("aria-modal", "true");
			const titleText = messages !== void 0 && messages !== null ? messages.title : "";
			const bodyText = messages !== void 0 && messages !== null ? messages.body : "";
			if (typeof titleText === "string" && titleText !== "") {
				const title = document.createElement("div");
				title.className = "dsh-ctx-confirm__title";
				title.textContent = titleText;
				root.appendChild(title);
			}
			if (typeof bodyText === "string" && bodyText !== "") {
				const body = document.createElement("div");
				body.className = "dsh-ctx-confirm__body";
				body.textContent = bodyText;
				root.appendChild(body);
			}
			root.appendChild(ctxSeparator());
			const cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = "dsh-ctx-item";
			cancel.setAttribute("role", "menuitem");
			cancel.setAttribute("tabindex", "-1");
			const cancelText = document.createElement("span");
			cancelText.textContent = typeof messages.cancel === "string" ? messages.cancel : "Cancel";
			cancel.appendChild(cancelText);
			const confirm = document.createElement("button");
			confirm.type = "button";
			confirm.className = "dsh-ctx-item dsh-ctx-item--danger";
			confirm.setAttribute("role", "menuitem");
			confirm.setAttribute("tabindex", "-1");
			const confirmText = document.createElement("span");
			confirmText.textContent = typeof messages.action === "string" ? messages.action : "OK";
			confirm.appendChild(confirmText);
			// 危险操作放在**最后**一项，且默认焦点落在「取消」上：手滑回车
			// 只会取消，不会删掉东西。
			root.appendChild(cancel);
			root.appendChild(confirm);
			const dismiss = () => {
				closeCtxMenu();
				if (opts !== void 0 && opts !== null) ctxRestoreMenuFocus(opts.restoreIndex);
			};
			cancel.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				dismiss();
			});
			confirm.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				closeCtxMenu();
				try {
					const result = onConfirm();
					if (result !== void 0 && result !== null && typeof result.then === "function") {
						result.catch((error) => { ctxToast(String((error && error.message) || error)); });
					}
				} catch (error) {
					ctxToast(String((error && error.message) || error));
				}
			});
			// Escape = 取消（菜单层的 keydown 只处理已经关掉的情况，这里补上）。
			root.addEventListener("keydown", (event) => {
				if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
				if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
				event.preventDefault();
				const all = [cancel, confirm];
				const at = all.indexOf(document.activeElement);
				const step = event.key === "ArrowDown" ? 1 : -1;
				all[(at + step + all.length) % all.length].focus();
			});
			const rect = { x: 0, y: 0 };
			rect.x = Math.max(6, Math.round(window.innerWidth / 2));
			rect.y = Math.max(6, Math.round(window.innerHeight / 3));
			root.style.left = rect.x + "px";
			root.style.top = rect.y + "px";
			document.body.appendChild(root);
			ctxMenuState.node = root;
			ctxMenuState.restoreFocus = null;
			ctxPositionMenu(root, rect.x, rect.y);
			cancel.focus();
			return true;
		}

		/**
		* 删除会话的请求路径（宿主半边用同一字面量注册路由，见 lib/index.js）。
		*
		* ⚠ 必须逐字一致。改这里就得同步改宿主半边与 tools/check-context-menu.mjs
		*   的静态钉，三处对齐才能保证「客户端打的地址就是宿主注册的地址」。
		*/
		const SESSION_DELETE_PATH = "/api/ui-tools/sessionDelete";

		/**
		* 批量删除的请求路径（v0.4.22 新增，宿主半边同一字面量）。
		*
		* 与 SESSION_DELETE_PATH 的区别只在载荷形状；宿主侧两条路由**共用同一个
		* handler**（单会话端点就是「只有一项的批量」），所以两者的鉴权、错误码、
		* 返回语义完全一致，不会漂移。
		*/
		const SESSION_DELETE_BATCH_PATH = "/api/ui-tools/sessionsDelete";

		/**
		* 带进度的批量删除路径（v0.4.23）。响应是 NDJSON 流，每行一个 JSON。
		* 只写死一处，宿主侧的 DELETE_STREAM_ROUTE_PATH 必须完全一致。
		*/
		const SESSION_DELETE_STREAM_PATH = "/api/ui-tools/sessionsDeleteStream";

		/**
		* 找出「因为要删 parentId 而被连带删除」的全部子孙会话。
		*
		* 内核里会话的血缘是 `header.parentSession`（dsh-session:2017，fork 时写入），
		* 它经 api-session-controller 的 listFields 变成列表条目的 `parentSessionId`
		* （:2129），再经客户端 service.js:512 投影成摘要的 **`parentId`**。
		* 所以只靠 `sessions.list` 的现有快照就能把整棵树还原出来，不需要额外 RPC。
		*
		* 要点：
		*   - 返回的是**子孙**，不含 parentId 本身；调用方自己决定要不要带上原会话。
		*   - 广度优先 + `seen` 去重，血缘成环（理论上不该有，但脏数据不能让它死循环）
		*     时也能正常收口。
		*   - 只认同一条链：A 的孩子被删 → A 的孩子的孩子也算，这是「分支」的语义。
		*   - 任何异常都返回空数组：级联是**附加功能**，读不到血缘就退回
		*     「只删它自己」，绝不因为级联失败而让删除卡住。
		*
		* @param sessions scope.sessions（ClientSessions）。
		* @param parentIds 要被删掉的会话 id（可为单个或多个）。
		* @returns string[] 全部子孙会话 id；parentIds 本身不在里面。
		*/
		function ctxDescendantSessionIds(sessions, parentIds) {
			const roots = (Array.isArray(parentIds) ? parentIds : [parentIds])
				.filter((id) => typeof id === "string" && id !== "");
			if (roots.length === 0) return [];
			try {
				const items = sessions.list.getSnapshot().items || [];
				/** parentId → 它的直接孩子 id 列表。 */
				const childrenOf = new Map();
				for (const item of items) {
					if (item === void 0 || item === null) continue;
					if (typeof item.sessionId !== "string" || item.sessionId === "") continue;
					if (typeof item.parentId !== "string" || item.parentId === "") continue;
					const bucket = childrenOf.get(item.parentId);
					if (bucket === void 0) childrenOf.set(item.parentId, [item.sessionId]);
					else bucket.push(item.sessionId);
				}
				const seen = new Set(roots);
				const queue = roots.slice();
				const found = [];
				while (queue.length > 0) {
					const current = queue.shift();
					const children = childrenOf.get(current);
					if (children === void 0) continue;
					for (const childId of children) {
						if (seen.has(childId)) continue;
						seen.add(childId);
						found.push(childId);
						queue.push(childId);
					}
				}
				return found;
			} catch (error) {
				return [];
			}
		}

		/**
		* 把请求路径拼成**同源绝对地址**。
		*
		* ⚠ 为什么不能直接用相对路径 "/api/ui-tools/sessionDelete"：
		*   浏览器里相对路径确实能发出去，但它把「同源」这件事交给了运行环境，
		*   测试台（Node 里求值的沙箱）没有 location，全局 fetch 拿到相对 URL
		*   会直接 `TypeError: Failed to parse URL` —— 于是所有断言都只能看到
		*   同一句无意义的报错，删除逻辑本身一条都测不到。
		*   拼成绝对地址之后，fetch 的入参完全由我们自己决定，测试台可以注入
		*   自己的 fetch 原样核对 URL，真机行为一字不差（同源 + same-origin cookie）。
		*
		* @returns 同源绝对地址；连 location 都拿不到时退回相对路径（真机上不会走到）。
		*/
		function ctxDeleteUrl() {
			return ctxDeleteUrlFor(SESSION_DELETE_PATH);
		}

		/**
		* 同上，但接受任意删除路径 —— 批量删除用的是另一条路由。
		* @param path SESSION_DELETE_PATH 或 SESSION_DELETE_BATCH_PATH。
		* @returns 同源绝对地址（拿不到 location 时退回相对路径）。
		*/
		function ctxDeleteUrlFor(path) {
			try {
				const loc = window.location;
				if (loc !== void 0 && loc !== null && typeof loc.origin === "string" && loc.origin !== "") {
					return loc.origin + path;
				}
			} catch (error) {
				/* 拿不到 location 就走下面的相对路径 */
			}
			return path;
		}

		/**
		* 建一张 `sessionId → 会话摘要` 的索引。
		*
		* 批量删除时要给**每个**会话配上 cwd（宿主定位不到落盘位置时的兜底）。
		* 逐个去 sessions.list 里线性找是 O(n²)，而这里只为几十个会话建索引，
		* 成本可以忽略；任何字段缺失都退回空 Map，调用方按「没有 cwd」处理。
		*
		* @param sessions scope.sessions（ClientSessions）。
		* @returns Map<string, summary>，永不抛。
		*/
		function ctxSessionSummaryIndex(sessions) {
			const index = new Map();
			try {
				const items = sessions.list.getSnapshot().items || [];
				for (const item of items) {
					if (item === void 0 || item === null) continue;
					if (typeof item.sessionId !== "string" || item.sessionId === "") continue;
					index.set(item.sessionId, item);
				}
			} catch (error) {
				/* 拿不到快照就当没有 cwd，宿主自己会想办法定位 */
			}
			return index;
		}

		/**
		* 调宿主半边的删除通道。
		*
		* 为什么是 ctx.get("connection") 而不是入口 inject 里加 "connection"：
		* AGENT.md R3 —— 往 inject 里加服务等于给整条 fiber 加一条启动依赖，
		* 服务缺席会让**所有功能**一起卡在 pending。而删除会话只是一项额外能力，
		* 内核没这个服务时应该「这一项报错、别的照用」。所以全程可选获取。
		*
		* ⚠ 为什么用 fetch 打 `/api/ui-tools/sessionDelete` 而**不是**
		*   `connection.rpc.call("/ui-tools", …)`（v0.4.21 真机实测结论）：
		*
		*   `connection.rpc.handle(channel, handler)` 内部是
		*     `return owner.effect(() => owner.webServer.register(route), …)`
		*   （dsh-client-connection/lib/index.js:871），而 `owner` 是 Connection
		*   服务自己的 ctx，其插件入口 `inject = ["credentials"]`（:1013）——
		*   **没有 webServer**。于是宿主侧注册时必然抛
		*     cannot get property "webServer" without inject
		*   插件无从绕过。真机日志（~/.dsh/ui-tools-host.log）里就是这句。
		*
		*   `connection.fetch.register({ path, methods, requestBody, fetch })` 则只往
		*   内部的 fetchRoutes Map 塞一条精确路由（:840-854），不碰 webServer，
		*   挂在 `/api` 这条已有 prefix 路由下由 createSharedFetchHandler 按 pathname
		*   精确命中（:820-839，`API_PATH = "/api"` 见 :14）。鉴权照旧由通道负责：
		*   Host/Origin 栅栏 + cookie 鉴权在 admit(req) 里，非 owner 的 Peer 直接 403。
		*
		*   @param readConnection 取值函数，返回内核 connection 服务。**当前实现不使用它**
		*          （fetch 直连不需要 connection），保留是为了让 installContextMenu
		*          的形参表与真实内核的「可选服务」形状一致，且断言能钉住「没有把
		*          connection 变成硬依赖」。
		* @param sessionId 会话 id。
		* @param cwd 会话的 cwd（服务端定位不到时兜底）。
		* @returns Promise<{ ok, value } | { ok:false, error }>
		*/
		function ctxCallSessionDelete(readConnection, sessionId, cwd) {
			// 单会话端点也要带 sessionId/cwd 顶层字段，兼容 v0.4.20/0.4.21 那版
			// 只认 `{ sessionId, cwd }` 的宿主半边（升级插件后不重启宿主时的过渡态）。
			return ctxPostDelete(SESSION_DELETE_PATH, { sessions: [{ sessionId, cwd }], sessionId, cwd });
		}

		/**
		* 批量删除：一次请求删掉一整个工作区的会话（v0.4.22）。
		*
		* 为什么不循环调 ctxCallSessionDelete：几十个会话就是几十个往返，中途
		* 失败后说不清停在哪一个。批量端点在一次请求里返回每个会话的结果，
		* 上层才能如实汇报「删了 N 个，M 个失败」。
		*
		* @param readConnection 同 ctxCallSessionDelete（保留，未使用）。
		* @param entries `[{ sessionId, cwd }, …]`。
		* @returns Promise<{ ok, value:{ deleted, removed } }>，失败时 reject 的
		*          error.code 与单会话版本一致（no-host / partial / 业务码）。
		*/
		function ctxCallSessionsDelete(readConnection, entries) {
			const sessions = (Array.isArray(entries) ? entries : []).map((entry) => ({
				sessionId: String(entry !== void 0 && entry !== null ? entry.sessionId : ""),
				cwd: String(entry !== void 0 && entry !== null && entry.cwd !== void 0 ? entry.cwd : "")
			}));
			return ctxPostDelete(SESSION_DELETE_BATCH_PATH, { sessions });
		}

		/**
		* 带进度的批量删除（v0.4.23）。
		*
		* 宿主那端 `/sessionsDeleteStream` 回的是 **NDJSON**：一行一个 JSON，
		* 删一个推一行。这里用 `response.body.getReader()` 边读边解，每解出一行
		* 就回调一次 onProgress，界面上就是真的「已删除 3/20」，而不是
		* 「点完什么都不动，几十秒后突然说删完了」。
		*
		* 为什么必须自己解 NDJSON 而不用 `response.json()`：
		*   json() 会把整个 body 读完才返回 —— 进度条就直接退化成转圈，
		*   这一整条路由的意义也就没了。
		*
		* 降级链（重要，决定升级后不重启宿主还能不能用）：
		*   1. body 不可读（老 WebView / 被 polyfill 掉）→ 退回 ctxCallSessionsDelete；
		*   2. 状态码 404/405（宿主是 v0.4.22 或更早，没有流式路由）
		*      → 同样退回 ctxCallSessionsDelete，只是没有中间进度；
		*   3. 流中途断掉 → 用已经读到的 progress 行自拼一个结果，
		*      不让「删了一半」被当成「全失败」。
		*
		* @param readConnection 同 ctxCallSessionDelete（保留，未使用）。
		* @param entries `[{ sessionId, cwd }, …]`。
		* @param onProgress 每删完一个回调一次，收到 `{ done, total, sessionId, ok }`。
		* @returns Promise<{ ok, value } | { ok:false, error }>，形状与 ctxCallSessionsDelete 一致。
		*/
		function ctxCallSessionsDeleteStream(readConnection, entries, onProgress) {
			const sessions = (Array.isArray(entries) ? entries : []).map((entry) => ({
				sessionId: String(entry !== void 0 && entry !== null ? entry.sessionId : ""),
				cwd: String(entry !== void 0 && entry !== null && entry.cwd !== void 0 ? entry.cwd : "")
			}));
			/** 读不到流 / 老宿主时走这条：结果形状与流式完全一致，上层无需分支。 */
			const fallback = () => ctxCallSessionsDelete(readConnection, sessions);
			return Promise.resolve(fetch(ctxDeleteUrlFor(SESSION_DELETE_STREAM_PATH), {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessions })
			})).then((response) => {
				// 404/405 = 老宿主没有这条路由。必须**在**判 response.ok 之前，
				// 因为 405 就是 frontend-static 对未知非 GET 请求的兜底。
				if (response.status === 404 || response.status === 405) return fallback();
				if (!response.ok) {
					const failure = new Error(`HTTP ${response.status}`);
					failure.status = response.status;
					return Promise.reject(failure);
				}
				const body = response.body;
				if (body === void 0 || body === null || typeof body.getReader !== "function") return fallback();
				const reader = body.getReader();
				const decoder = new TextDecoder();
				/** 已收到的逐条结果，流断了就用它自拼结论。 */
				const deleted = [];
				const failed = [];
				let done = void 0;
				let pending = "";
				/** 处理完整的一行；返回 true 表示收到 done（可以停止读流）。 */
				const consume = (line) => {
					const text = line.trim();
					if (text === "") return false;
					let record;
					try {
						record = JSON.parse(text);
					} catch (error) {
						return false;
					}
					if (record === null || typeof record !== "object") return false;
					if (record.type === "progress") {
						if (record.ok === true) deleted.push(record.sessionId);
						else failed.push({ sessionId: record.sessionId, code: record.code || "delete-failed", message: record.message || "删除失败" });
						if (typeof onProgress === "function") {
							try {
								onProgress(record);
							} catch (error) {
								/* 进度回调自己报错不能影响删除 */
							}
						}
						return false;
					}
					if (record.type === "done") {
						done = record;
						return true;
					}
					if (record.type === "error") {
						done = { ok: false, error: { code: record.code || "delete-failed", message: record.message || "删除失败" } };
						return true;
					}
					// start 行只带总数，进度由 progress 行推进，这里不用。
					return false;
				};
				/** 循环读流，直到读到 done 或流结束。 */
				const pump = () => reader.read().then((chunk) => {
					if (chunk.done === true) {
						// 流结束但没等到 done 行：把残留的尾巴解一下，再自拼结论。
						if (pending !== "") consume(pending);
						pending = "";
						if (done !== void 0) return done;
						if (deleted.length === 0 && failed.length === 0) {
							// 一行有用的都没读到 —— 说明这条路由其实不是流式的
							// （比如中间隔着别的东西），退回非流式端点重来一次。
							return fallbackResult();
						}
						return {
							ok: failed.length === 0,
							...(failed.length === 0
								? { value: { ok: true, deleted, removed: deleted.length } }
								: { error: { code: "partial", message: `已删除 ${deleted.length} 个，${failed.length} 个失败`, details: { deleted, failed } } })
						};
					}
					pending += decoder.decode(chunk.value, { stream: true });
					let index = pending.indexOf("\n");
					while (index >= 0) {
						const line = pending.slice(0, index);
						pending = pending.slice(index + 1);
						if (consume(line)) {
							// 已经拿到结论，剩下的字节不再等（宿主那边删完了会自己 close）。
							try { reader.cancel(); } catch (error) { /* 取消失败无所谓 */ }
							return done;
						}
						index = pending.indexOf("\n");
					}
					return pump();
				}, () => (done !== void 0 ? done : fallbackResult()));
				/** 流不可用时的一次性兜底。 */
				const fallbackResult = () => fallback().then((result) => {
					if (result !== void 0 && result !== null && result.ok === false) {
						const error = result.error !== void 0 && result.error !== null ? result.error : {};
						const failure = new Error(typeof error.message === "string" ? error.message : "delete-failed");
						failure.code = typeof error.code === "string" ? error.code : "delete-failed";
						failure.details = error.details;
						return Promise.reject(failure);
					}
					return result;
				});
				return pump().then((outcome) => {
					if (outcome === void 0) return fallbackResult();
					if (outcome.ok === false) {
						const error = outcome.error !== void 0 && outcome.error !== null ? outcome.error : {};
						const failure = new Error(typeof error.message === "string" && error.message !== "" ? error.message : "delete-failed");
						failure.code = typeof error.code === "string" ? error.code : "delete-failed";
						failure.details = error.details;
						return Promise.reject(failure);
					}
					return outcome;
				});
			}, (error) => {
				const text = String((error && error.message) || error);
				const failure = new Error(text);
				failure.code = /Failed to fetch|NetworkError|not found|method not allowed/i.test(text) ? "no-host" : "delete-failed";
				return Promise.reject(failure);
			}).catch((error) => {
				if (error !== void 0 && error !== null && (error.status === 404 || error.status === 405)) {
					// 极端时序：判完 status 之后才炸出来的 404/405，也归到 no-host。
					const failure = new Error(String(error.message || error));
					failure.code = "no-host";
					return Promise.reject(failure);
				}
				return Promise.reject(error);
			});
		}

		/**
		* 两条删除路由的公共发送逻辑。
		*
		* 单会话与批量**必须共用这段**：状态码翻译（404/405 → no-host）、
		* `ok:false` 的 code/message 提取、details 透传 —— 任何一处走叉，
		* 都会出现「删一个提示对、删一批提示错」这种最难查的分裂。
		*
		* @param path SESSION_DELETE_PATH 或 SESSION_DELETE_BATCH_PATH。
		* @param payload 已经拼好的请求体对象。
		* @returns 见 ctxCallSessionDelete。
		*/
		function ctxPostDelete(path, payload) {
			// 同源地址 + credentials: "same-origin"，否则 cookie 不带、宿主回 403。
			return Promise.resolve(fetch(ctxDeleteUrlFor(path), {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			})).then((response) => {
				// 405/404 = 路由不存在 = 宿主半边没加载（frontend-static 的 fallback
				// 对非 GET/HEAD 一律 405）。必须翻译成 fail.deleteNoHost，原因见下。
				if (response.status === 404 || response.status === 405) {
					const missing = new Error(`HTTP ${response.status}`);
					missing.status = response.status;
					return Promise.reject(missing);
				}
				if (!response.ok) {
					const failure = new Error(`HTTP ${response.status}`);
					failure.status = response.status;
					return Promise.reject(failure);
				}
				return response.json().then((result) => {
					if (result !== void 0 && result !== null && result.ok === false) {
						const error = result.error !== void 0 && result.error !== null ? result.error : {};
						const failure = new Error(typeof error.message === "string" && error.message !== "" ? error.message : "delete-failed");
						failure.code = typeof error.code === "string" ? error.code : "delete-failed";
						// details.deleted / details.failed 是批量删除的逐条结果，
						// 上层要用它算「成功几个、失败几个」，不能只留一句 message。
						failure.details = error.details;
						return Promise.reject(failure);
					}
					return result;
				});
			}, (error) => {
				// 网络层失败（fetch 直接 reject）：同样按「宿主半边没加载」处理 ——
				// 宿主进程只在**启动时**跑一次 runProfile，没有热重载，装完不重启
				// 就一定是这种结果。
				const text = String((error && error.message) || error);
				const failure = new Error(text);
				failure.code = /Failed to fetch|NetworkError|not found|method not allowed/i.test(text) ? "no-host" : "delete-failed";
				return Promise.reject(failure);
			}).catch((error) => {
				// 上面两种 rejection 在这里统一落到「宿主半边缺失」的判定上，
				// 保证调用方拿到的 code 只有 no-host / 业务码两种。
				if (error !== void 0 && error !== null && (error.status === 404 || error.status === 405)) {
					const failure = new Error(String(error.message || error));
					failure.code = "no-host";
					return Promise.reject(failure);
				}
				return Promise.reject(error);
			});
		}

		/**
		* 让侧边栏那一行真正消失。
		*
		* 为什么需要这一步：磁盘删除在宿主半边（lib/index.js）完成，它只回一句
		* "ok"。而浏览器里的会话列表是 api-session-controller 的一份**内存摘要**
		* —— 文件没了它不会自己少一行，必须由内核发 `api-session/removed`，
		* 浏览器端 sessions.handleSessionRemoved(id) 才会在 summaries 里过滤掉它。
		*
		* ⚠ 这个事件**只在宿主侧 Agent 彻底 dispose 时才发**（app.asar 里逐行
		*   核对过）：dsh-session 的 `SessionStore.detachEntered` 是
		*   `if (entry.announced) this.emitDisposed(entry)` → session/disposed →
		*   dsh-api-session-controller 转成 api-session/removed。而浏览器这边的
		*   `sessions.retain/release` 只是客户端引用计数，**对宿主 Agent 毫无影响**，
		*   所以「关掉浏览器侧订阅」这条路根本触发不了它。
		*
		* 宿主侧的 agent 是**懒创建**的：一个会话只有被打开（或端点正被看着）时才有
		* Agent，删完它自然就是冷的、本来就没有 Agent，也就没有 dispose 可发。
		* 真正会漏的只有一种情况 —— 删的正好是**当前选中的会话**：它持有一个
		* mainView 引用，Agent 还活着。所以这里先释放那个引用，再把列表基线重新
		* 拉一遍：`sessions.refresh()` → session.list → 宿主 refreshList，而
		* `removedSincePull` 会再叠一轮 remove 变更，行随之消失。
		*
		* ⚠ 为什么**不**用 workspaces.archiveSession：它第一步就是
		*   `await this.sessionKnown(id)`，文件刚删掉 → 会话已不存在 → 抛
		*   WorkspaceUnknownSessionError。删完再归档在内核层面是走不通的。
		*
		* @param workspaces scope.workspaces（WorkspaceController）。
		* @param readUiWorkspace uiWorkspace 的实时取值函数（可选服务）。
		* @param sessions scope.sessions（ClientSessions）。
		* @param sessionId 会话 id。
		* @returns Promise<void>，永不 reject —— 只是收尾，失败不影响磁盘结果。
		*/
		function ctxReleaseSession(workspaces, readUiWorkspace, sessions, sessionId) {
			const steps = [];
			if (workspaces !== void 0 && workspaces !== null && typeof workspaces.stopSessionActivity === "function") {
				steps.push(Promise.resolve(workspaces.stopSessionActivity(sessionId)).then(() => void 0, () => void 0));
			}
			return Promise.all(steps).then(() => {
				// 只有「删的就是当前选中会话」时才需要动导航：将死会话总不能继续占着主视图。
				const uws = typeof readUiWorkspace === "function" ? readUiWorkspace() : void 0;
				const mainId = ctxCurrentSessionId(readUiWorkspace, sessions);
				if (uws !== void 0 && uws !== null && mainId === sessionId && typeof uws.clearMain === "function") {
					try {
						uws.clearMain();
					} catch (error) {
						/* 清不掉也不影响删 */
					}
				}
				// 重拉基线：宿主那一侧已经没有这个会话了，list 回来就会少一条。
				if (sessions !== void 0 && sessions !== null && typeof sessions.refresh === "function") {
					return Promise.resolve(sessions.refresh()).then(() => void 0, () => void 0);
				}
				return void 0;
			}).then(() => void 0, () => void 0);
		}

		/**
		* 读「当前正在看的是哪个会话」。
		*
		* `uiWorkspace.mainReference` 是 UiWorkspaceService 的**公开实例字段**
		* （不是内部私有槽，源码里 mainReference 声明在类体上、赋值全在
		* replaceMain/clearMain 里）。它存在时直接用；旧内核里没有这个字段时
		* 退回当前会话摘要（sessions.list 的 current），两者都拿不到就返回
		* undefined —— 与「不知道」等价，调用方按「不是当前会话」处理。
		*
		* @param readUiWorkspace uiWorkspace 的实时取值函数。
		* @param sessions scope.sessions。
		* @returns 当前会话 id 或 undefined。
		*/
		function ctxCurrentSessionId(readUiWorkspace, sessions) {
			try {
				const uws = typeof readUiWorkspace === "function" ? readUiWorkspace() : readUiWorkspace;
				const mainId = uws !== void 0 && uws !== null && uws.mainReference !== void 0 && uws.mainReference !== null
					? uws.mainReference.sessionId
					: void 0;
				if (typeof mainId === "string" && mainId !== "") return mainId;
			} catch (error) {
				/* 落到下一级 */
			}
			try {
				const current = sessions !== void 0 && sessions !== null && sessions.list !== void 0
					? sessions.list.getSnapshot().current
					: void 0;
				return typeof current === "string" && current !== "" ? current : void 0;
			} catch (error) {
				return void 0;
			}
		}

		/**
		* 功能六主入口：挂 contextmenu 监听并分发。
		*
		* 关键取舍：**只在能唯一确定目标时 preventDefault**。判定不出来就
		* 直接 return，浏览器默认菜单照常出现 —— 宁可少接管，也不弹一个
		* 可能操作错对象的菜单。
		*/
		function installContextMenu(scope, t, getUiWorkspace, getConnection) {
			const sessions = scope.sessions;
			const workspaces = scope.workspaces;
			// ⚠ v0.4.15 修一个真实时序缺陷：uiWorkspace 必须**每个动作发生时实时取**，
			//   绝不能在外层 ctx.inject 回调里 `const uiWorkspace = ctx.get(...)` 取
			//   一次就闭包捕获。原因（已用真实 cordis 0.2.1-alpha.2 复现）：
			//
			//     ctx.get(name) 内部是 _getImpl(name, strict=true)，它要求
			//     `impl.fiber.state === 2`（ACTIVE）才返回服务，否则 undefined。
			//     uiWorkspace 由 dsh-client-ui-workspace 提供，而**那个包自己的
			//     inject 也要 sessions + workspaces**（见其 lib/client.js 的
			//     `const inject = ["slots","sessions","workspaces",...]`，实例在
			//     apply 里 `new UiWorkspaceService(...)`）。也就是说 uiWorkspace
			//     的 ACTIVE 时刻**必然不早于**我们这条 fiber 的回调执行时刻，
			//     谁先谁后取决于 bundle 加载顺序。
			//     一旦我们抢先，闭包里的 uiWorkspace 就**永久是 undefined**：
			//     点「新建会话」/「切换到该会话」只会弹 fail.noUiWorkspace，
			//     而重命名（走 scope.sessions，是响应式依赖）照常工作 ——
			//     用户看到的就是「只有重命名有效果」。
			//
			//   改为传一个取值函数：动作真正执行的那一刻再问内核要，此时服务
			//   早已 ACTIVE；旧内核 / 精简 bundle 里它缺席时依旧返回 undefined，
			//   下面的能力探测照旧给出明确提示，降级路径不变。
			//
			//   用 scope.get 而不是外层 ctx.get：scope 是 ctx.inject(["sessions",
			//   "workspaces"]) 划出的子作用域，同样能解析出 uiWorkspace，且语义上
			//   更贴近「在这条 fiber 的注入上下文里取」。
			const readUiWorkspace = () => {
				try {
					const svc = typeof getUiWorkspace === "function" ? getUiWorkspace() : getUiWorkspace;
					return svc === void 0 ? void 0 : svc;
				} catch (error) {
					return void 0;
				}
			};
			// connection 同理走**实时取值**：本插件宿主半边（lib/index.js）用
			// connection.rpc.handle("/ui-tools", …) 自建了一条删除通道，浏览器半边
			// 靠 connection.rpc.call 调它。这两个都是**可选**服务 —— 内核没提供
			// （旧内核）时删除项给出明确提示，别的菜单项照常工作。
			const readConnection = () => {
				try {
					const svc = typeof getConnection === "function" ? getConnection() : getConnection;
					return svc === void 0 ? void 0 : svc;
				} catch (error) {
					return void 0;
				}
			};
			// uiWorkspace = 官方 UiWorkspaceService（dsh-client-ui-workspace）。
			//
			// 为什么必须用它、而不能只用上面的两个 controller：
			//
			//   1. 「切到某个会话」只有一条路：uiWorkspace.openSession(sessionId)
			//      （内部就是 replaceMain(id, signal, "reveal")）。
			//      ⚠ 注意 sessions 上**确实有一个叫 open 的方法**，但它**不收
			//      参数**，语义是「打开本会话的事件流」，跟「切到某个会话」毫无
			//      关系 —— 写 sessions.open(childId) 语法合法、运行**不抛错**、
			//      但**什么都不会发生**。这是一种最阴的错法：不报错、不生效，
			//      用户只能看到「点了没反应」。v0.4.13 首发正是栽在这里
			//      （见 §14 服务契约断言）。
			//   2. workspaces 是纯 WorkspaceController，**没有 startSession 方法**；
			//      真正实现「新建会话并导航过去」的是
			//      uiWorkspace.startSession(workspaceId)。直接调
			//      workspaces.startSession 会抛 "workspaces.startSession is not a
			//      function"。（参考插件 dsh-session-context-menu 也踩过同一个坑，
			//      它在自己的注释里写明了这一点。）
			//
			// 这两个方法都可能缺席（旧内核 / 精简 bundle），所以一律走可选调用 +
			// 能力探测：拿不到就给用户一条明确提示，而不是抛
			// "xxx is not a function" 让人看不懂。
			// uiWorkspace 由调用方传进来的 readUiWorkspace() **函数**（不是值）实时取 ——
			// 它是**可选**服务，缺席时是 undefined，下面所有调用点都做了能力探测。

			// ⚠ ctxToast「同一时刻只留一个」是**有意**的（避免提示叠成一摞），
			//   但它有个副作用必须在这里显式处理：同一毫秒内先 ctxToast("正在删除…")
			//   再 ctxToast("已删除…")，两条会在同一个微任务批次里发生 —— 真实浏览器
			//   里中间夹了布局，第二条能赢；而在零延时环境（测试台 / 某些降级路径）
			//   里，两个 setTimeout 的实现细节会让**先那条赢**，用户就只能看到
			//   「正在删除会话…」，永远等不到结果提示。所以这里用「同步刷新」的
			//   办法保证顺序：把旧提示**同步摘掉**再挂新的，并把「要删旧提示」这件事
			//   记在节点上，而不是依赖 DOM 的异步一致性。
			const ctxFlash = (message) => {
				const old = document.querySelector(".dsh-ctx-toast");
				if (old !== null) old.remove();
				ctxToast(message);
			};

			const onContextMenu = (event) => {
				// 别人已经处理过（例如参考插件在场）就不重复接管。
				if (event.defaultPrevented) return;
				const target = event.target;
				const row = ctxRowFrom(target);

				// ── 选中的文本优先（在对话正文里选中文字后右键，意图明确是文本操作）──
				const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
				const selected = selection !== null && selection !== void 0 ? String(selection.toString() || "").trim() : "";
				const inComposer = target instanceof Element && target.closest("textarea, [contenteditable=\"true\"]") !== null;

				if (selected !== "" && !inComposer) {
					const plan = [
						{ label: t("menu.copySelection"), run: () => ctxCopy(selected).then(() => ctxToast(t("toast.copied")), () => ctxToast(t("toast.clipboardFailed"))), opts: { shortcut: "Ctrl+C" } },
						{ label: t("menu.sendSelection"), run: () => {
							if (ctxInsertIntoComposer(selected)) ctxToast(t("toast.sent"));
							else ctxToast(t("toast.noComposer"));
						} },
						null,
						{ label: t("menu.refresh"), run: () => { ctxReload(t("toast.reloading")); }, opts: { shortcut: "Ctrl+R" } }
					];
					event.preventDefault();
					event.stopPropagation();
					ctxOpenMenu(plan, event.clientX, event.clientY);
					return;
				}

				// ── 工作区行 ──
				if (row !== null) {
					const workspace = ctxResolveWorkspace(workspaces, row);
					if (workspace !== null && ctxSessionRowId(row) === null) {
						const path = workspace.path || "";
						const ungrouped = workspace.ungrouped === true;
						const hasId = typeof workspace.workspaceId === "string" && workspace.workspaceId !== "";
						// 会话 id 快照：菜单项点击时再读 workspace.sessionIds 也行，但那样
						// 读完到删除之间列表可能已经变了；这里取一次，确认条里显示的
						// 数量与实际发出去的一批必然是同一份。
						const workspaceSessionIds = (workspace.sessionIds || []).slice();
						// 「删除工作区全部会话」在 plan 里的下标（确认条取消后还焦点）。
						// 新建会话/复制路径/分隔线/归档 = 0/1/2/3，删除 = 4。plan 一改必须同步。
						const deleteWorkspaceIndex = 4;
						const plan = [
							// 「新建会话」在未分组分组上**不提供**：那个分组没有 workspaceId，
							// uiWorkspace.startSession(undefined) 只会白跑。给一条明确提示项
							// 比给一个点了没反应的项好。
							ungrouped || !hasId
								? { label: t("menu.newSession"), run: () => { ctxToast(t("fail.ungroupedNoWorkspace")); } }
								: { label: t("menu.newSession"), run: () => {
									// 实时取（见 installContextMenu 顶部注释）：不能闭包捕获。
									const uws = readUiWorkspace();
									if (uws === void 0 || typeof uws.startSession !== "function") { ctxToast(t("fail.noUiWorkspace")); return; }
									return Promise.resolve(uws.startSession(workspace.workspaceId)).catch(() => ctxToast(t("fail.noUiWorkspace")));
								} },
							// ⚠ 这一项**不能**在 path 为空时静默省略：用户会以为
							// 「菜单里根本没有这一项」或「点了没反应」，而真正的原因
							// （workspace.path 没读出来）完全不可见。一律给出菜单项，
							// 拿不到路径时给一条明确提示。
							{ label: t("menu.copyWorkspacePath"), run: () => {
								if (path === "") { ctxToast(t(ungrouped ? "fail.ungroupedNoPath" : "fail.noWorkspacePath")); return; }
								return ctxCopy(path).then(() => ctxToast(t("toast.copiedWorkspacePath")), () => ctxToast(t("toast.clipboardFailed")));
							} },
							null,
							{ label: t("menu.archiveWorkspaceSessions"), run: () => {
								const ids = (workspace.sessionIds || []).slice();
								if (ids.length === 0) { ctxToast(t("fail.noSessions")); return; }
								return Promise.all(ids.map((id) => Promise.resolve(workspaces.archiveSession(id)).catch(() => null)))
									.then(() => ctxToast(t("toast.archived", { count: ids.length })), () => ctxToast(t("toast.archiveFailed")));
							} },
							// ── 删除工作区全部会话（v0.4.22）──
							// 位置：紧跟在「归档工作区全部会话」之下 —— 归档是删除的温和版，
							// 两者是一对；且都用一条分隔线与上面的非破坏性项隔开。
							// ⚠ 这一项**不能**在 ids 为空时静默省略：用户会以为菜单里根本没有，
							//   或者点了没反应。一律给出菜单项，空工作区给一条明确提示。
							{ label: t("menu.deleteWorkspaceSessions"), opts: { danger: true }, run: () => {
								const ids = workspaceSessionIds.slice();
								if (ids.length === 0) { ctxToast(t("fail.noWorkspaceSessions")); return; }
								const title = workspace.title || workspace.workspaceId || "";
								// 每个会话的 cwd 从 sessions 摘要里带上去 —— 宿主定位不到
								// 落盘位置时用它兜底（与单会话删除同一条降级链）。
								const byId = ctxSessionSummaryIndex(sessions);
								// ── 级联（v0.4.23）──
								// 工作区列表里的 sessionIds 未必包含「从这些会话分叉出去、
								// 但被归到别的工作区（或已归档）」的子会话。父会话一删，
								// 那些子会话的 parentSession 就指向一个不存在的 id，
								// 血缘断了 —— 所以要把整棵子树一起算进来。去重后并成一批。
								const cascadeIds = ctxDescendantSessionIds(sessions, ids);
								const allIds = ids.concat(cascadeIds.filter((id) => ids.indexOf(id) < 0));
								const extra = allIds.length - ids.length;
								const entries = allIds.map((id) => {
									const summary = byId.get(id);
									return { sessionId: id, cwd: summary !== void 0 && summary !== null && typeof summary.cwd === "string" ? summary.cwd : "" };
								});
								ctxConfirmDialog(
									{
										title: ctxFill(t("confirm.deleteWorkspaceTitle"), { title, count: ids.length }),
										// 有子会话时换成带级联说明的正文，绝不偷偷多删。
										body: extra > 0 ? ctxFill(t("confirm.deleteCascadeBody"), { count: extra }) : t("confirm.deleteWorkspaceBody"),
										action: t("confirm.deleteAction"),
										cancel: t("confirm.deleteCancel")
									},
									() => {
										// 先画一个 0/N：进度靠宿主那端的流式端点逐条推进（v0.4.23）。
										// 老宿主没有流式路由时会自动退回一次性端点 —— 那样就只有
										// 这一句，没有中间数字，但功能完全正常。
										ctxFlash(ctxFill(t("toast.deleteProgress"), { done: 0, total: entries.length }));
										return ctxCallSessionsDeleteStream(readConnection, entries, (record) => {
											if (record.done === void 0 || record.total === void 0) return;
											ctxFlash(ctxFill(t("toast.deleteProgress"), { done: record.done, total: record.total }));
										}).then((result) => {
											const value = result !== void 0 && result !== null ? result.value : void 0;
											const removed = value !== void 0 && value !== null && typeof value.removed === "number" ? value.removed : allIds.length;
											// 与单会话删除同一条收尾路径：先停活/清主视图引用，
											// 再重拉列表基线，行才会真的消失（原因见 ctxReleaseSession）。
											return ctxReleaseSession(workspaces, readUiWorkspace, sessions, ids[0])
												.then(() => {
													ctxFlash(ctxFill(t("toast.deleteWorkspaceDone"), { title, count: removed }));
													return value;
												});
										}, (error) => {
											const code = error !== void 0 && error !== null ? String(error.code || "") : "";
											let reason;
											if (code === "no-connection") reason = t("fail.deleteNoChannel");
											else if (code === "no-host") reason = t("fail.deleteNoHost");
											else if (code === "partial") {
												// 部分成功：宿主回的 details 里有逐条结果，如实报「删了几个、几个失败」。
												const details = error !== void 0 && error !== null ? error.details : void 0;
												const deleted = details !== void 0 && details !== null && Array.isArray(details.deleted) ? details.deleted.length : 0;
												const failed = details !== void 0 && details !== null && Array.isArray(details.failed) ? details.failed.length : 0;
												reason = ctxFill(t("toast.deletePartial"), {
													count: deleted,
													failed,
													reason: String((error && error.message) || error)
												});
												ctxFlash(reason);
												return void 0;
											} else reason = ctxFill(t("toast.deleteFailed"), { reason: String((error && error.message) || error) });
											ctxFlash(reason);
											return void 0;
										});
									},
									{ restoreIndex: deleteWorkspaceIndex }
								);
							} },
							null,
							{ label: t("menu.refresh"), run: () => { ctxReload(t("toast.reloading")); }, opts: { shortcut: "Ctrl+R" } }
						];
						event.preventDefault();
						event.stopPropagation();
						ctxOpenMenu(plan, event.clientX, event.clientY);
						return;
					}
				}

				// ── 会话行 ──
				if (row !== null) {
					const session = ctxResolveSession(sessions, row, null);
					if (session === null) return; // 判不出来 → 保留默认菜单
					const cwd = session.cwd || "";
					// 删除项在 plan 里的下标（确认条取消后要把焦点还回这一项）。
					// 重命名/归档/分叉/分隔线 = 0/1/2/3，删除 = 4。plan 一改必须同步。
					const deleteIndex = 4;
					const plan = [
						{ label: t("menu.rename"), run: () => { if (!ctxOpenOfficialRename(row, t)) ctxToast(t("fail.officialRename")); } },
						{ label: t("menu.archive"), run: () => Promise.resolve(workspaces.archiveSession(session.id)).then(() => void 0, () => ctxToast(t("fail.workspaceUnknown"))) },
						{ label: t("menu.fork"), run: () => Promise.resolve(sessions.fork({ sessionId: session.id, increaseTitle: true }))
							.then((childId) => {
								// sessions.fork 返回的是**裸 childId 字符串**，不是对象。
								// 切过去必须走 uiWorkspace.openSession ——
								// ⚠ 千万别写 sessions.open(childId)：那个 open 不收参数，
								// 不报错也**不会切会话**（v0.4.13 首发就栽在这）。
								if (typeof childId !== "string" || childId === "") { ctxToast(t("toast.forkFailed")); return; }
								// 实时取（见 installContextMenu 顶部注释）：fork 的返回值
								// 要等 Promise 落地才拿到，此刻服务必然已就绪；但依然走
								// 取值函数，保证与新建会话/切换会话同一条路径。
								const uws = readUiWorkspace();
								if (uws === void 0 || typeof uws.openSession !== "function") { ctxToast(t("fail.noUiWorkspace")); return; }
								uws.openSession(childId);
								ctxToast(t("toast.forked"));
							}, () => ctxToast(t("toast.forkFailed"))) },
						// ── 删除会话（v0.4.20）──
						// 位置：紧贴「归档会话」之下。归档是删除的**温和版**，两者
						// 是一对；而删除又明显不同于上面的非破坏性项（重命名/分叉），
						// 所以用一条分隔线把它单独划出来，且放在「复制…」组之前 ——
						// 危险项不应夹在「复制会话 ID / 复制工作目录」中间。
						null,
						{ label: t("menu.delete"), opts: { danger: true }, run: () => {
							const title = session.displayTitle || session.title || session.id;
							// ── 子会话级联（v0.4.23）──
							// 会话分叉出来的子会话（sessions.fork）在磁盘上是独立会话，
							// 但血缘靠 header.parentSession 记着。父会话一删，这些子会话的
							// parentSession 就指向一个不存在的 id：血缘断了、树上也挂不住，
							// 成为删不掉的孤儿。所以删父会话时把整棵子树一起删。
							// 菜单项本身**永远显示**（用户不该看到菜单项时有时无），
							// 有没有子会话只影响确认条正文和成功提示。
							const childIds = ctxDescendantSessionIds(sessions, session.id);
							ctxConfirmDialog(
								{
									title: ctxFill(t("confirm.deleteTitle"), { title }),
									body: childIds.length > 0 ? ctxFill(t("confirm.deleteCascadeBody"), { count: childIds.length }) : t("confirm.deleteBody"),
									action: t("confirm.deleteAction"),
									cancel: t("confirm.deleteCancel")
								},
								() => {
									ctxFlash(t("toast.deleting"));
									/** 删完之后的公共收尾：提示 + 让侧边栏那几行真的消失。 */
									const finish = (value) => ctxReleaseSession(workspaces, readUiWorkspace, sessions, session.id).then(() => {
										ctxFlash(childIds.length > 0
											? ctxFill(t("toast.deletedCascade"), { title, count: childIds.length })
											: ctxFill(t("toast.deleted"), { title }));
										return value;
									});
									const fail = (error) => {
										const code = error !== void 0 && error !== null ? String(error.code || "") : "";
										let reason;
										if (code === "no-connection") reason = t("fail.deleteNoChannel");
										else if (code === "no-host") reason = t("fail.deleteNoHost");
										else reason = ctxFill(t("toast.deleteFailed"), { reason: String((error && error.message) || error) });
										ctxFlash(reason);
										return void 0;
									};
									// 没有子会话 → 保持 v0.4.20 的单会话端点（载荷最小、契约最稳）；
									// 有子会话 → 走带进度的批量路由，一次把整棵子树删干净。
									if (childIds.length === 0) {
										return ctxCallSessionDelete(readConnection, session.id, cwd).then((result) => {
											const value = result !== void 0 && result !== null ? result.value : void 0;
											// 宿主半边已经删了磁盘；还要让**侧边栏这一行**消失。
											//
											// ⚠ 这里**绝不能**退回 workspaces.archiveSession：
											//   它的第一步就是 `await this.sessionKnown(id)`
											//   （dsh-workspace/lib/index.js 的 archiveSession），
											//   而文件刚被删掉 → 会话已不存在 → 直接抛
											//   WorkspaceUnknownSessionError。也就是说「删完再归档」
											//   这条路在内核层面是关死的，吞掉这个错并不能让行消失。
											//
											// 行要靠内核的 api-session/removed 才会消失，而它只在
											// 宿主侧 Agent 彻底 dispose 时发出。详见 ctxReleaseSession
											// 的注释：宿主 Agent 是懒创建的，删一个冷会话本就无 Agent 可
											// dispose；唯一会漏的是「删的正好是当前选中会话」，所以那边
											// 先释放主视图引用、再重拉一次列表基线。全程能力探测 + 容错。
											return finish(value);
										}, fail);
									}
									const byId = ctxSessionSummaryIndex(sessions);
									const allIds = [session.id].concat(childIds);
									const entries = allIds.map((id) => {
										const summary = byId.get(id);
										return { sessionId: id, cwd: summary !== void 0 && summary !== null && typeof summary.cwd === "string" ? summary.cwd : "" };
									});
									ctxFlash(ctxFill(t("toast.deleteProgress"), { done: 0, total: entries.length }));
									return ctxCallSessionsDeleteStream(readConnection, entries, (record) => {
										if (record.done === void 0 || record.total === void 0) return;
										ctxFlash(ctxFill(t("toast.deleteProgress"), { done: record.done, total: record.total }));
									}).then((result) => finish(result !== void 0 && result !== null ? result.value : void 0), fail);
								},
								{ restoreIndex: deleteIndex }
							);
						} },
						null,
						{ label: t("menu.copySessionId"), run: () => ctxCopy(session.id).then(() => ctxToast(t("toast.copiedSessionId")), () => ctxToast(t("toast.clipboardFailed"))) },
						cwd === "" ? null : { label: t("menu.copyCwd"), run: () => ctxCopy(cwd).then(() => ctxToast(t("toast.copiedCwd")), () => ctxToast(t("toast.clipboardFailed"))) },
						null,
						{ label: t("menu.refresh"), run: () => { ctxReload(t("toast.reloading")); }, opts: { shortcut: "Ctrl+R" } }
					];
					event.preventDefault();
					event.stopPropagation();
					ctxOpenMenu(plan, event.clientX, event.clientY);
					return;
				}
			};

			const onPointerDown = (event) => {
				const open = ctxMenuState.node;
				if (open === null) return;
				if (!open.contains(event.target)) closeCtxMenu();
			};

			const onKeyDown = (event) => {
				const open = ctxMenuState.node;
				if (open === null) return;
				if (event.key === "Escape") { event.preventDefault(); closeCtxMenu(); return; }
				const items = open.querySelectorAll('[role="menuitem"]');
				if (items.length === 0) return;
				const list = Array.prototype.slice.call(items);
				const at = list.indexOf(document.activeElement);
				let next = null;
				if (event.key === "ArrowDown") next = list[(at + 1 + list.length) % list.length];
				else if (event.key === "ArrowUp") next = list[(at - 1 + list.length) % list.length];
				else if (event.key === "Home") next = list[0];
				else if (event.key === "End") next = list[list.length - 1];
				if (next !== null && next !== void 0) { event.preventDefault(); next.focus(); }
			};

			// 滚动/缩放会让固定定位的菜单与内容脱节，直接关掉最稳。
			const onViewportChange = () => { closeCtxMenu(); };
			// 【v0.4.15 修复】只在**窗口本身**失焦时关菜单。
			// 旧代码是 window.addEventListener("blur", onViewportChange, true)：
			// blur 不冒泡但有**捕获阶段**，window 上的捕获监听会收到每一个元素级
			// blur —— 鼠标按下菜单项时焦点从上一项（或菜单容器）移走，立刻触发
			// 元素 blur → closeCtxMenu() 把菜单从 DOM 里删掉 → 随后的 mouseup
			// 落在菜单下面的行上，**click 永远不会派发**，于是所有菜单项全部失效
			// （复制工作区路径、刷新页面、新建会话…都没反应）。
			// 真机 HUD 轨迹实证：C:pointerdown→C:mousedown→（焦点转移）→
			// C:pointerup 落在 projectRow 上→MENU_CLOSED，全程没有 C:click。
			// 所以去掉 capture，并显式判 target === window。
			const onWindowBlur = (event) => { if (event.target !== window) return; closeCtxMenu(); };

			document.addEventListener("contextmenu", onContextMenu, true);
			document.addEventListener("pointerdown", onPointerDown, true);
			document.addEventListener("keydown", onKeyDown, true);
			window.addEventListener("resize", onViewportChange, true);
			window.addEventListener("blur", onWindowBlur);

			// 返回拆卸函数：解开全部监听、清掉菜单与提示，**不留补丁**。
			return () => {
				document.removeEventListener("contextmenu", onContextMenu, true);
				document.removeEventListener("pointerdown", onPointerDown, true);
				document.removeEventListener("keydown", onKeyDown, true);
				window.removeEventListener("resize", onViewportChange, true);
				window.removeEventListener("blur", onWindowBlur);
				closeCtxMenu();
				const toast = document.querySelector(".dsh-ctx-toast");
				if (toast !== null) toast.remove();
			};
		}

		const CTX_CSS = `
.dsh-ctx-menu {
  position: fixed;
  z-index: 2147483000;
  min-width: 168px;
  max-width: 280px;
  padding: 4px;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  color: var(--dsw-alias-label-primary, #161616);
  border: 1px solid var(--dsw-alias-border-l2, #dddddd);
  border-radius: 7px;
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.16);
  font: 13px/18px system-ui, -apple-system, "Segoe UI", sans-serif;
}
.dsh-ctx-item {
  box-sizing: border-box;
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  color: inherit;
  text-align: left;
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
}
.dsh-ctx-item:hover,
.dsh-ctx-item:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  outline: none;
}
.dsh-ctx-item--danger {
  color: var(--dsw-alias-state-error-primary, #d93025);
}
.dsh-ctx-confirm {
  min-width: 240px;
  max-width: 320px;
  padding: 10px;
}
.dsh-ctx-confirm__title {
  padding: 2px 6px 6px;
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;
}
.dsh-ctx-confirm__body {
  padding: 0 6px 6px;
  color: var(--dsw-alias-label-tertiary, #777777);
  font-size: 12px;
  line-height: 17px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.dsh-ctx-shortcut {
  color: var(--dsw-alias-label-tertiary, #777777);
  font-size: 11px;
}
.dsh-ctx-separator {
  height: 1px;
  margin: 4px -4px;
  background: var(--dsw-alias-border-l2, #dddddd);
}
.dsh-ctx-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 2147483001;
  padding: 7px 12px;
  transform: translateX(-50%);
  color: #ffffff;
  background: #222222;
  border-radius: 7px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  font: 13px/18px system-ui, -apple-system, "Segoe UI", sans-serif;
}
`;

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
		/**
		* 「内核未提供可读的 context.current」只告警一次（避免每帧刷屏）。
		*
		* 该情形下 buildViewNode 无法证明「本 target 从未物化」，故保守地每帧都产出
		* 同 key 的 hidden 节点 —— 宁可多一帧隐藏节点，也不能因误判 previous=null 而
		* 返回 null 触发内核的撤回异常（代价是整条 chat 视图快照链停更）。
		* 置为模块级一次性开关而非每次调用新建，保证日志不被逐帧重复填满。
		*/
		let tspCurrentShapeWarned = false;
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

		/* ── 功能五取数段（compat-check 直接截取本段做断言，勿动这两条分隔注释）── */

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

		/* ── 功能五取数段结束 ── */

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
		* 停顿不计入）→ turn/end 置 ended。
		* publication 与内核 assistant-step 同规则：usage / finish chunk 不发布，
		* 其余增量按 animation-frame 发布。
		*
		* ⚠ turn/end 后**不是**返回 null 让节点消失（v0.4.6 的旧写法，会触发内核
		* 「撤回了已物化节点」并中断整条 chat 视图快照链）：改为返回**同 key +
		* `visibility:"hidden"`** 交棒精确 pill，由内核按可见性过滤。详见 buildViewNode。
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
					//
					// ⚠⚠⚠ 关键：**「读不到 context.current」≠「确认从未物化」**。
					// 两者若合并成同一个 previous=null，一旦内核换了形态（改名 / 去掉该字段 /
					// 换成不可读的容器），防御就**静默失效**、异常照旧复现（issue #1 指出的正是
					// 这一处不可区分性）。故拆成两件事分别判断：
					//   · canReadCurrent —— 内核是否提供了可读的 context.current；
					//   · previous       —— 已知时，上一帧该 target 的节点。
					// 读不到时**不敢断言「未物化」**，一律走保守分支（返回同 key + hidden）：
					// 撤回异常的代价（整条 chat 快照链停更、后续提问全不显示、同 bundle 插件
					// 被级联击落）远大于多挂一帧隐藏节点。
					const currentStore = context.current;
					const canReadCurrent = currentStore !== void 0 && currentStore !== null && typeof currentStore.get === "function";
					if (!canReadCurrent && !tspCurrentShapeWarned) {
						tspCurrentShapeWarned = true;
						console.warn("[dsh-ui-tools] context.current unavailable; token-speed live node falls back to always-emit hidden (cannot rule out materialization)");
					}
					const previous = canReadCurrent ? (currentStore.get("chat") ?? null) : null;
					const hasData = state !== void 0 && state.firstTokenAt !== null;
					// 只有**能确认**从未物化（内核给了 current、且该 target 上一帧为空）时，
					// 返回 null 才是安全的（内核无从「撤回」）。
					if (!hasData && previous === null && canReadCurrent) return null;
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
		* 功能五的 chat 快照源。
		*
		* 缓存键必须是**对象**：早期（功能三尚在时）曾想直接把 sessionId 字符串
		* 喂进 WeakMap，会在 set 时抛 TypeError。这里改为「先自己拿
		* BoundConversation（内核按 binding 缓存，同一会话稳定复用），再用它做键」，
		* 与官方 dsh-client-ui-chat 的 chatSource 同构。v0.4.9 功能三移除后，
		* 这段说明保留：它记录的是本函数为何不能写成一行。
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
		// v0.4.9：功能三移除后 mfsCompact 字段一并删除。旧 localStorage 里残留的
		// mfsCompact 由 normalizePrefs 的「逐字段白名单」自然丢弃——它只挑取认识
		// 的键，多余的键不会进入快照，因此不需要写迁移代码，也不需要升 key 版本。
		const PREFS_DEFAULTS = Object.freeze({
			chipEnabled: true,
			collapseDefaultCollapsed: false,
			tokenSpeedEnabled: true,
			// v0.4.13：右键菜单。默认**开启**（用户主动要求的功能）。
			// 关掉它时 installContextMenu 一根监听都不挂 —— 不劫持浏览器原生菜单。
			ctxMenuEnabled: true
		});

		/** 合并 user 覆盖与默认值，逐字段校验类型；坏数据回退默认。 */
		function normalizePrefs(partial) {
			const base = { ...PREFS_DEFAULTS };
			if (partial === null || typeof partial !== "object") return base;
			return {
				chipEnabled: typeof partial.chipEnabled === "boolean" ? partial.chipEnabled : base.chipEnabled,
				collapseDefaultCollapsed: typeof partial.collapseDefaultCollapsed === "boolean" ? partial.collapseDefaultCollapsed : base.collapseDefaultCollapsed,
				tokenSpeedEnabled: typeof partial.tokenSpeedEnabled === "boolean" ? partial.tokenSpeedEnabled : base.tokenSpeedEnabled,
				ctxMenuEnabled: typeof partial.ctxMenuEnabled === "boolean" ? partial.ctxMenuEnabled : base.ctxMenuEnabled
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
		 * alpha-only 功能（v0.4.9 后只剩功能五速度计）收在 alphaFeatures
		 * 子 fiber 里，旧内核上该 fiber 停在 PENDING、函数体不执行。子 fiber
		 * 激活时把本仓库置真，设置页据此灰显依赖 target 体系的开关——比在
		 * apply 期一次性 ctx.get() 探测更可靠：provider fiber 可能比本 entry
		 * 更晚激活。
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
		 * 功能四：插件设置页（settings.section，v0.4.0；v0.4.1 删快捷命令条）
		 * 官方设置中心新增「DSH UI 工具」页：集中开关各功能的偏好
		 * （工作区徽章 / 启动默认折叠 / 输出速度计）。偏好经 localStorage
		 * 持久化（见偏好仓库说明）。settings.section 是 root 作用域 list
		 * 槽，注册 id/order/label 即出现在设置导航。
		 * ══════════════════════════════════════════════════════════════ */

		const SET_NS = "ui-tools-settings";
		const SET_ZH = {
			"nav.label": "DSH UI 工具",
			"group.layout": "布局偏好",
			"chip.enabled": "会话标题旁显示工作区徽章",
			"collapse.defaultCollapsed": "启动时默认折叠所有工作区分组",
			"alpha.unavailable": "需内核 0.1.2-alpha.1+（当前内核没有会话 target 体系，该功能不可用）",
			"tokenSpeed.enabled": "在「用时」旁显示输出速度计（tok/s）",
			"ctxMenu.enabled": "会话 / 工作区列表右键菜单",
			"ctxMenu.hint": "在侧边栏会话与工作区上按右键弹出操作菜单（复制 ID、路径、归档、新建分支等）",
			"a11y.toggle": "切换 {label}"
		};
		const SET_EN = {
			"nav.label": "DSH UI Tools",
			"group.layout": "Layout preferences",
			"chip.enabled": "Show the workspace chip next to the session title",
			"collapse.defaultCollapsed": "Collapse all workspace groups on startup",
			"alpha.unavailable": "Requires kernel 0.1.2-alpha.1+ (this kernel has no session target API, so the feature is unavailable)",
			"tokenSpeed.enabled": "Show the output speed meter (tok/s) next to elapsed time",
			"ctxMenu.enabled": "Right-click menu for sessions / workspaces",
			"ctxMenu.hint": "Right-click a session or workspace in the sidebar for actions (copy ID, path, archive, fork, ...)",
			"a11y.toggle": "Toggle {label}"
		};

		/**
		 * 设置页内一行开关。`disabled` + `hint`（v0.4.2）用于能力缺席的灰显
		 * 态：旧内核上没有会话 target 体系，依赖它的开关（v0.4.9 后只剩
		 * 功能五速度计）灰显并提示所需内核版本。
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
		* PENDING）时，依赖 target 体系的开关灰显。
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
						label: t("tokenSpeed.enabled"),
						checked: p.tokenSpeedEnabled,
						onChange: (value) => prefs.set({ tokenSpeedEnabled: value }),
						disabled: !cap.alphaApi,
						hint: t("alpha.unavailable"),
						t
					}),
					h(SettingsToggleRow, {
						label: t("ctxMenu.enabled"),
						checked: p.ctxMenuEnabled,
						onChange: (value) => prefs.set({ ctxMenuEnabled: value }),
						hint: t("ctxMenu.hint"),
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
/* v0.4.2 能力缺席灰显态（旧内核上功能五不可用） */
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
		 * apply：合并注册五个功能
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
				tag.textContent = MSS_CSS + WC_CSS + WSC_CSS + SET_CSS + TSP_CSS + CTX_CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "ui-tools: inject model-select + workspace-chip + settings + token-speed + context-menu styles");

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

			// 定位：工具条注册在 sidebar.footer.action，官方渲染在 footer 顶部（紧贴工作区
			// 列表正下方），用 CSS 对齐列表内边距即可——不搬动 DOM。
			// 历史教训：v0.1.0 用全局 MutationObserver 搬节点、v0.1.2 用收窄观察器搬节点，
			// 都会与框架重渲染互相触发（框架把工具条放回 slot，观察器再搬走），渲染进程
			// 100% CPU 卡死。结论：绝不搬动 slot 渲染出来的节点。
			//
			// v0.4.12：删除原先的 injectWcStyle() 独立 <style id="dsh-ui-tools-wc-collapse-style">。
			// 它注入的 WC_CSS 与共享标签（apply 顶部，tag.textContent = MSS_CSS + WC_CSS + ...）
			// 内容重复，同一份规则在页面里存在两份；更糟的是两个标签由不同 effect 负责拆卸，
			// 卸载时存在「一份已移除、另一份还在」的中间帧，折叠条样式会闪断。
			// 现在 WC_CSS 只由共享标签注入（那份还有 querySelector 去重保护），功能二的
			// 卸载清理随共享标签一起完成，不再需要单独的 teardown effect。
			// 注意：这一改动的正确性依赖共享标签确实拼接了 WC_CSS——check-model-seat-hug
			// 的「共享标签含全部四份 CSS 哨兵」断言（v0.4.12 新增）专门钉住这一点。
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

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "ui-tools-workspace-collapse",
				locale: WC_NS,
				inject: () => ({
					collapseAll,
					expandAll
				})
			}, CollapseBar));

			// ── 功能五：「输出速度计 tok/s」—— alpha-only 子 fiber（v0.4.2）──
			// 取数依赖 0.1.2-alpha.1 才引入的 uiConversation，该硬依赖声明收进
			// alphaFeatures 子 fiber（见上方子 fiber 头注释）：新内核正常激活；
			// 旧内核该 fiber 停在 PENDING —— 不执行函数体、不计入 loader entry
			// 审计，其余四个功能照常可用（旧行为是整入口卡死 + 横幅）。
			// 渲染方式不变：纯 slot 注册，无观察器/定时器。
			ctx.plugin(alphaFeatures, { prefs, capability });

			// ── 功能三：会话标题旁工作区徽章 ──
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

			// ── 功能四：插件设置页（settings.section）──
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

			// ── 功能六：右键上下文菜单（v0.4.13）──
			// 纯 DOM 方案：只挂 document 级 contextmenu / pointerdown / keydown
			// 监听，**不注册任何 slot**，因此旧内核上也照常可用（无 alpha 依赖，
			// 故不进 alphaFeatures 子 fiber；用到的 sessions / workspaces 都在
			// 入口 inject 里）。
			//
			// ⚠ uiWorkspace 走**可选获取**，绝不能写进 inject：
			//   uiWorkspace 由 dsh-client-ui-workspace 提供，旧内核 / 精简
			//   bundle 里没有。inject 数组里的任何服务缺席都会让这条 fiber
			//   停在 PENDING 等它 —— 而 uiWorkspace 永远等不到，于是
			//   **整个 entry 都不激活**，五个功能一起消失（boot 末尾的 loader
			//   entry 审计报 "1 entry did not activate" + 加载横幅）。
			//   这正是 v0.4.2 在 uiConversation 上踩过的同一个坑（见 inject
			//   定义处的长注释）。用 ctx.get(name) 拿：服务缺席时它返回
			//   undefined 而不是抛错，功能六里所有 uiWorkspace 调用都已经做了
			//   能力探测（typeof fn === "function"）并在拿不到时给用户明确
			//   提示，所以降级是干净的。
			// R2 合规：只读查询既有 DOM，菜单节点是 appendChild 到 body 的新
			// 节点，不搬动、不包裹 slot 渲染出来的任何节点，无 MutationObserver、
			// 无轮询定时器。
			// 全部监听经这里返回的拆卸函数解除，插件卸载后不留补丁。
			ctx.effect(() => ctx.locale.register(CTX_NS, { zh: CTX_ZH, en: CTX_EN }), "ui-tools: context-menu dictionaries");
			const ctxT = ctx.locale.bind(CTX_NS);
			// 用 ctx.inject 划出子作用域而不是直接用 ctx：把功能六对 services 的
			// 访问显式化，也让它在 services 缺席时自动降级（不执行函数体、不报错），
			// 而不是在事件回调里才炸出 undefined。
			// 注意这里**只列必需的两项**；uiWorkspace 是可选的，且必须**延迟取值**：
			// 传的是 () => scope.get("uiWorkspace") 这个函数，而不是当场取到的值。
			// ⚠ 千万别写成 `const uiWorkspace = ctx.get("uiWorkspace")` 再传进去 ——
			//   那样会闭包捕获一个可能在本次回调执行时还不存在的 undefined，
			//   且永久不再刷新。uiWorkspace 的提供方（dsh-client-ui-workspace）
			//   自己也 inject 了 sessions + workspaces，所以它 ACTIVE 的时刻
			//   必然不早于我们这条回调；抢先执行时 get 返回 undefined，
			//   症状就是「右键菜单里只有重命名有效果」。见 v0.4.15 修复说明。
			ctx.inject(["sessions", "workspaces"], (scope) => {
				const readUiWorkspace = () => scope.get("uiWorkspace");
				// 删除会话要用内核的 connection 服务（宿主半边在它上面注册了
				// /ui-tools 通道）。同样走 ctx.get 可选获取：AGENT.md R3 —— 绝不
				// 加进入口 inject，缺席时只有「删除会话」这一项报错。
				const readConnection = () => scope.get("connection");
				// v0.4.13：接上设置页开关「会话 / 工作区列表右键菜单」。
				// 关掉时**一根监听都不挂**，浏览器原生右键菜单原样保留。
				//
				// 这里必须自己订阅 prefs：scope.effect 的重跑条件是它**读到的**
				// 响应式依赖，而 prefs 是普通 Set 仓库、不是 cordis 追踪服务，
				// 不会被自动收集。因此在回调里显式 prefs.subscribe，再把
				// disposable 交回去 —— 开关一改就重挂/卸掉监听，无需刷新页面。
				let teardown = null;
				let lastEnabled = null;
				const sync = () => {
					const enabled = prefs.getSnapshot().ctxMenuEnabled === true;
					if (enabled === lastEnabled) return;
					lastEnabled = enabled;
					if (teardown !== null) { teardown(); teardown = null; }
					if (enabled) teardown = installContextMenu(scope, ctxT, readUiWorkspace, readConnection);
				};
				sync();
				const unsubscribe = prefs.subscribe(sync);
				scope.effect(() => () => {
					unsubscribe();
					if (teardown !== null) { teardown(); teardown = null; }
				}, "ui-tools: session/workspace context menu");
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
