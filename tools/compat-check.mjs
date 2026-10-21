#!/usr/bin/env node
/**
 * dsh-ui-tools 内核自适应回归检查（v0.4.2，方案 B：软依赖 + 子 fiber 隔离）
 *
 * 做什么：用**真实的 @deepseek-ai/cordis**（从本机已安装的 DSH 内核副本里取）
 * 搭一个最小宿主，把 `lib/client.js` 的 loader entry 挂进去，在三种内核场景下
 * 验证行为矩阵（该矩阵源自 DSH-Exoskeleton 仓库的设计文档
 * docs/UI-TOOLS-KERNEL-ADAPT-DESIGN.md §4，**不在本仓库内**；本文件是它的可执行副本）：
 *
 *   0 声明层：入口 inject 只剩五个跨内核服务；bundle 只 require react
 *   A 旧内核（0.1.1-rc.x，不提供 uiConversation）
 *     → entry fiber ACTIVE，boot 审计 0 失败（= 无 `1 entry did not activate`
 *       / 无 Failed to load plugins 横幅）
 *     → alphaFeatures 子 fiber 停在 PENDING、函数体未执行（功能五缺席）
 *     → 功能一/二/三/四 的槽位注册全部在位；capability.alphaApi=false（灰显）
 *   B 新内核（0.1.2-alpha.1+，提供 uiConversation）→ 五个功能全部生效 + 无异常日志；
 *     entry dispose 后子 fiber 随之释放、能力位回落
 *   B2 功能五（v0.4.6）：精确 TPS 口径与内核同源、Definition 状态机全流程、
 *     两个组件的 DOM 与偏好门控（直接截取 bundle 源码段执行）
 *   C 服务后到：先按旧内核挂载，随后补上服务 → 子 fiber 自动激活补挂
 *     （§10「服务后到时补挂功能」一行，无需轮询）
 *   D 内核不提供 remote：功能一优雅缺席，entry 仍 ACTIVE（守住 v0.4.2 铁律）
 *
 * v0.4.9：功能三「修改的文件」tab 已移除，本文件同步去掉其全部断言，
 * 并新增「conversation.view 永不被注册」「uiSession.provide 永不被调用」
 * 「workspaces.openPath 永不被调用」三条**逆向钉**，防止残留代码复活。
 *
 * 为什么不用真浏览器跑：这些性质（fiber 状态、审计口径、子 fiber 生命周期）
 * 全在 cordis 的依赖解析层，用真 cordis 断言比看 UI 更精确，也不需要重启
 * dsh web（重启会打断当前会话）。
 *
 * 跑法：node tools/compat-check.mjs
 *      指定 cordis 入口：DSH_CORDIS_ENTRY=<...>/cordis/lib/index.js
 *      指定内核目录：DSH_KERNEL_DIR=<...>/kernels/0.1.1-rc.2
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
// DSH_BUNDLE 用于负向对照（喂一份故意改坏的 bundle，验证本检查真的抓得到回归）。
const BUNDLE = process.env.DSH_BUNDLE ? path.resolve(process.env.DSH_BUNDLE) : path.join(REPO, "lib", "client.js");

/* ══════════════════════ 断言与汇报 ══════════════════════ */

const results = [];
const check = (label, ok, detail = "") => results.push({ label, ok: !!ok, detail: ok ? detail : (detail || "未满足") });
const section = (title) => results.push({ section: title });

/* ══════════════════════ cordis 定位（本机内核副本） ══════════════════════ */

function kernelRoots() {
	const appData = process.env.APPDATA || path.join(process.env.HOME || "", "AppData", "Roaming");
	return [path.join(appData, "DSH-Exoskeleton", "kernels"), path.join(process.env.HOME || "", ".dsh", "kernels")]
		.filter((dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
}

/** 在候选内核里找 cordis 的 ESM 入口；默认取版本号最大的内核。 */
function locateCordis() {
	const explicit = process.env.DSH_CORDIS_ENTRY;
	if (explicit && fs.existsSync(explicit)) return { kernel: "DSH_CORDIS_ENTRY", entry: explicit };
	const wanted = process.env.DSH_KERNEL_DIR ? path.basename(path.resolve(process.env.DSH_KERNEL_DIR)) : null;
	const found = [];
	for (const root of kernelRoots()) {
		for (const kernel of fs.readdirSync(root)) {
			if (wanted && kernel !== wanted) continue;
			const pnpmDir = path.join(root, kernel, "node_modules", ".pnpm");
			let rows = [];
			try { rows = fs.readdirSync(pnpmDir); } catch { continue; }
			for (const row of rows) {
				if (!/^@deepseek-ai\+cordis@/.test(row)) continue;
				const entry = path.join(pnpmDir, row, "node_modules", "@deepseek-ai", "cordis", "lib", "index.js");
				if (fs.existsSync(entry)) found.push({ kernel, entry });
			}
		}
	}
	if (!found.length) return null;
	found.sort((a, b) => (a.kernel < b.kernel ? 1 : -1));
	return found[0];
}

const located = locateCordis();
if (!located) {
	console.error("找不到本机 cordis（DSH 内核副本）。可设 DSH_CORDIS_ENTRY 指向 cordis/lib/index.js 再跑。");
	process.exit(2);
}
const { Context, Service } = await import(pathToFileURL(located.entry).href);

/**
 * 本机内核自带的 semver（dsh CLI 的传递依赖）。
 *
 * 声明层断言必须用**真实 semver 语义**校验 `engines.dsh`，不能手搓匹配器：
 * npm 的预发布规则是整段声明的成败所在（`>=0.1.2-alpha.1` 竟不匹配 `0.1.5-rc.2`），
 * 自搓一份就等于把「被测语义」换成「我以为的语义」，断言随之失效。
 */
function locateSemver() {
	const explicit = process.env.DSH_SEMVER_ENTRY;
	if (explicit && fs.existsSync(explicit)) return explicit;
	for (const root of kernelRoots()) {
		let kernels = [];
		try { kernels = fs.readdirSync(root); } catch { continue; }
		for (const kernel of kernels) {
			const pnpmDir = path.join(root, kernel, "node_modules", ".pnpm");
			let rows = [];
			try { rows = fs.readdirSync(pnpmDir); } catch { continue; }
			for (const row of rows.sort().reverse()) {
				if (!/^semver@/.test(row)) continue;
				const entry = path.join(pnpmDir, row, "node_modules", "semver", "index.js");
				if (fs.existsSync(entry)) return entry;
			}
		}
	}
	return null;
}

const semverEntry = locateSemver();
const semver = semverEntry ? await import(pathToFileURL(semverEntry).href) : null;
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));

/** cordis 的 FiberState 是 const enum（不导出），数值顺序取自 cordis/src/fiber.ts。 */
const FIBER = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, DISPOSED: 4, UNLOADING: 5 };
const FIBER_NAME = ["PENDING", "LOADING", "ACTIVE", "FAILED", "DISPOSED", "UNLOADING"];
const stateOf = (fiber) => (fiber ? FIBER_NAME[fiber.state] : "missing");
const tick = async (rounds = 8) => { for (let i = 0; i < rounds; i += 1) await new Promise((r) => setTimeout(r, 0)); };

/* ══════════════════════ 浏览器侧桩（跑 bundle） ══════════════════════ */

const reactStub = {
	createElement: (type, props, ...children) => ({ type, props, children }),
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	useState: (init) => [init, () => {}],
	useEffect: () => {},
	useRef: (init) => ({ current: init }),
	useMemo: (fn) => fn()
};

/** 假 DOM：apply() 期只有 style 注入与查询；不引入观察器/定时器（本插件铁律）。 */
function makeFakeDom(logs) {
	const byId = new Map();
	return {
		head: { appendChild: (node) => { logs.appended.push(node); return node; } },
		getElementById: (id) => byId.get(id) ?? null,
		querySelector: () => null,
		createElement: (tag) => ({
			tag,
			dataset: {},
			textContent: "",
			remove() { /* noop */ },
			set id(value) { byId.set(value, this); },
			get id() { return ""; }
		})
	};
}

function makeFakeLocalStorage() {
	const store = new Map();
	return {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => { store.set(key, String(value)); },
		removeItem: (key) => { store.delete(key); }
	};
}

/** 读 lib/client.js，捕获 __ModuleLoader__.load 的 factory 并执行，得到 loader entry。 */
function loadClientBundle(logs) {
	const code = fs.readFileSync(BUNDLE, "utf8");
	const required = [];
	let captured = null;
	const fakeWindow = { __ModuleLoader__: { load: (descriptor) => { captured = descriptor; } } };
	const fakeConsole = {
		log: (...a) => logs.info.push(a.join(" ")),
		info: (...a) => logs.info.push(a.join(" ")),
		debug: () => {},
		warn: (...a) => logs.warn.push(a.join(" ")),
		error: (...a) => logs.error.push(a.join(" "))
	};
	// bundle 是浏览器单文件：只喂它用到的那几个全局，其余一律不可见。
	new Function("window", "document", "localStorage", "console", "setTimeout", code)(
		fakeWindow, makeFakeDom(logs), makeFakeLocalStorage(), fakeConsole, (fn, ms) => setTimeout(fn, ms)
	);
	if (!captured) throw new Error("bundle 未调用 window.__ModuleLoader__.load");
	const mod = captured.factory((id) => {
		required.push(id);
		// client 模块表铁律：除 react（seed word）外不得 require 任何 DSH client 包。
		if (id === "react") return reactStub;
		throw new Error(`require 了模块表外的包：${id}`);
	});
	return { id: captured.id, mod, required };
}

/* ══════════════════════ 假内核服务 ══════════════════════ */

const FAKE_CWD = "C:/ws/demo";
/** 内核 remote.session 命名空间的替身；调用方没声明 remote 时 cordis tracker 会在取它之前抛错。 */
const FAKE_REMOTE_SESSION = { selectModel: () => Promise.resolve() };
/** 会话内容快照（chat target 的 legacy 形状）。功能三移除后，仍被功能五的
 *  chat 快照源（tspChatSource）断言使用；保留 tool-call 节点是为了让快照形状
 *  与真内核一致，避免假数据比真实更宽松。 */
const FAKE_CHAT_SNAPSHOT = {
	legacy: {
		nodes: [
			{ kind: "assistant", blocks: [
				{ kind: "tool-call", name: "edit", argsRaw: JSON.stringify({ file_path: "src/a.ts" }) },
				{ kind: "tool-call", name: "run_code", argsRaw: JSON.stringify({ code: `const r = await tools.write({ file_path: "src/c.ts", content: "x" });
await tools.edit({ file_path: "src/d.ts", old_string: "a", new_string: "b" });
await tools.mkdir({ dirs: ["src/nested", "src/empty"] });` }) }
			] },
			{ kind: "tool-result", call: { name: "write", argsRaw: JSON.stringify({ file_path: "src/b.ts" }) } }
		],
		runningCalls: []
	}
};

/**
 * 从 bundle 源码截取功能五取数段，直接测 tsp* 纯函数（不经 VDOM/hooks）。
 * 与 loadClientBundle 同一份 BUNDLE 源码，保证测的就是被测 bundle。
 * @returns {{ tspFormatTps: Function, tspEstimateTokens: Function, tspBlocksEffort: Function, tspFoldTurn: Function, tspLastTurnSpeed: Function, tspTurnSpeed: Function }}
 */
function loadTspSpeed() {
	const src = fs.readFileSync(BUNDLE, "utf8");
	const si = src.indexOf("/* ── 功能五取数段");
	const ei = src.indexOf("/* ── 功能五取数段结束 ── */");
	if (si < 0 || ei < 0) throw new Error("TPS 取数段定位失败");
	const depSrc = src.slice(si, ei);
	// eslint-disable-next-line no-new-func
	return new Function(depSrc + "\nreturn { tspFormatTps, tspEstimateTokens, tspBlocksEffort, tspFoldTurn, tspLastTurnSpeed, tspTurnSpeed };")();
}

/**
 * 从 bundle 源码截取功能五的 dock 组件，用 reactStub 直接调用（不经真 DOM）。
 * 组件的 DOM 结构与偏好开关门控都能在这里断言 —— 不必依赖真机截图。
 * @param hooks - 可选 hooks 覆写（例如把 useRef 钉成可控累积器，测估算速度）。
 * @returns {{ TokenSpeedDockPill: Function }}
 */
function loadTspComponents(hooks = {}) {
	const src = fs.readFileSync(BUNDLE, "utf8");
	// 纯函数段与组件段都要（组件调用 tspFormatTps / tspLastTurnSpeed / tspBlocksEffort）。
	const pureStart = src.indexOf("/* ── 功能五取数段");
	const pureEnd = src.indexOf("/* ── 功能五取数段结束 ── */");
	const compStart = src.indexOf("function TokenSpeedDockPill(props)");
	const compEnd = src.indexOf("function tspChatSource(ctx, sessionId)");
	if (pureStart < 0 || pureEnd < 0 || compStart < 0 || compEnd < 0) throw new Error("TPS 组件段定位失败");
	const depSrc = src.slice(pureStart, pureEnd) + "\n" + src.slice(compStart, compEnd);
	// 组件只依赖 react、usePrefs（uSES 封装）与上面的纯函数；usePrefs 在 stub 下
	// 等价于「读快照」，因此把 prefs 仓库直接喂给 useSyncExternalStore 即可。
	const usePrefs = (prefs) => reactStub.useSyncExternalStore(prefs.subscribe, prefs.getSnapshot);
	// eslint-disable-next-line no-new-func
	const factory = new Function("react", "usePrefs", "useState", "useEffect", "useMemo", depSrc
		+ "\nreturn { TokenSpeedDockPill };");
	return factory(
		{ ...reactStub, useMemo: (fn) => fn(), useRef: hooks.useRef ?? reactStub.useRef },
		usePrefs,
		hooks.useState ?? reactStub.useState,
		hooks.useEffect ?? reactStub.useEffect,
		(fn) => fn()
	);
}

/**
 * 载入本机**全部可发现**的真内核 ConversationNodeAssembler（功能五最关键的一环）。
 *
 * 为什么必须用真内核而不是假内核：本插件功能五走 Definition 通道，内核
 * buildTargetUpserts() 对「上一帧已物化、本帧返回 null」有硬校验并**抛错**，
 * 该异常会让整条 chat 视图快照链停更（真机症状：回合结束后界面不再刷新、
 * 后续提问不显示）。假内核没有实现这一校验，因此必须让真内核来判。
 *
 * 且真机的流式增量是 transient 记录、回合收尾走 settleAssistant()：
 * retire transient 后 replayContext 会把状态**倒推**回 firstTokenAt=null /
 * estTokens=0（并非 ended=true）—— 只测状态机纯函数发现不了这条路径。
 *
 * 返回**数组**（而非首个命中）：不同内核的 Definition 契约可能各自演进，只测
 * 第一个会让其余版本静默缺席 —— issue #1 正是「桌面版 0.2.0-rc.1 上失效」而
 * 该版本当时根本不在验证矩阵里。全部跑一遍，任一版本失败都必须显式暴露。
 *
 * 两个来源：
 *   ① $APPDATA/DSH-Exoskeleton/kernels/<ver>/…（托管内核副本，含历史版本）
 *   ② app.asar 内的 dsh/node_modules/… （桌面版自带内核；大版本升级后真正生效的
 *      那一份，`kernels/` 下可能没有对应版本）
 * @returns {Array<{ ConversationNodeAssembler: Function, kernel: string }>} 可发现的内核（可能为空）。
 */
function loadKernelAssemblers() {
	/** 从一个 client bundle 源码里取出真内核的 ConversationNodeAssembler。 */
	const fromSource = (code, label) => {
		let captured = null;
		try {
			// bundle 是浏览器单文件：只喂它用到的全局。
			// eslint-disable-next-line no-new-func
			new Function("window", "document", "console", "setTimeout", "clearTimeout", code)(
				{ __ModuleLoader__: { load: (descriptor) => { captured = descriptor; } } },
				undefined, console, setTimeout, clearTimeout
			);
		} catch (error) { return null; }
		if (captured === null) return null;
		// 内核 bundle 在模块顶层就会用到 memo / jsx 等；缺一个就会在 factory 期抛出，
		// 而下面的 catch 会把它吞成「找不到内核」。故这里必须补齐形状。
		const kernelReact = Object.assign({}, reactStub, {
			memo: (fn) => fn,
			createElement: () => ({}), jsx: () => ({}), jsxs: () => ({}),
			useCallback: (fn) => fn, useContext: () => ({}), createContext: () => ({ Provider: () => ({}) }),
			forwardRef: (fn) => fn, Fragment: Symbol("Fragment"),
			useLayoutEffect: () => {}, useReducer: (reducer, init) => [init, () => {}],
			useTransition: () => [false, () => {}], useDeferredValue: (v) => v,
			useId: () => "stub-id", useDebugValue: () => {}
		});
		// 未知依赖模块的通用桩：内核 bundle 会 `class X extends SomeBase`、`zod.z.string()`、
		// `store.create(...)` 等。`() => ({})` 形状会在 class 继承处报
		// 「Class extends value () => ({}) is not a constructor」，故用「可调用 + 可构造 +
		// 任意属性都返回自身」的 Proxy 兜底，只让真正缺失的 API 暴露成错误。
		const stub = (() => {
			const target = function stub() { /* noop */ };
			const self = new Proxy(target, {
				get: (_t, key) => {
					if (key === "prototype") return {};
					if (key === "then" || key === Symbol.toPrimitive || key === "toJSON" || key === "toString") return void 0;
					return self;
				},
				apply: () => self,
				construct: () => ({})
			});
			return self;
		})();
		try {
			const mod = captured.factory((id) => {
				if (id === "@deepseek-ai/cordis") return { Context: Context, Service: Service };
				if (id === "react" || id === "react/jsx-runtime" || id === "react-dom") return kernelReact;
				return stub;
			});
			if (mod && typeof mod.ConversationNodeAssembler === "function") {
				return { ConversationNodeAssembler: mod.ConversationNodeAssembler, kernel: label };
			}
		} catch (error) { /* 换下一个来源 */ }
		return null;
	};

	const found = [];
	// 来源 ①：本机内核副本（$APPDATA/DSH-Exoskeleton/kernels/<ver>/…）。
	const appData = process.env.APPDATA || path.join(process.env.HOME || "", "AppData", "Roaming");
	const root = path.join(appData, "DSH-Exoskeleton", "kernels");
	let kernels = [];
	try { kernels = fs.readdirSync(root).sort().reverse(); } catch { kernels = []; }
	for (const kernel of kernels) {
		const pnpmDir = path.join(root, kernel, "node_modules", ".pnpm");
		let rows = [];
		try { rows = fs.readdirSync(pnpmDir); } catch { continue; }
		const pkgDir = rows
			.map((row) => path.join(pnpmDir, row, "node_modules", "@deepseek-ai", "dsh-client-ui-conversation"))
			.find((dir) => fs.existsSync(path.join(dir, "lib", "client.js")));
		if (pkgDir === void 0) continue;
		const hit = fromSource(fs.readFileSync(path.join(pkgDir, "lib", "client.js"), "utf8"), kernel);
		if (hit !== null) found.push(hit);
	}

	// 来源 ②：桌面版自带的内核（打包在 app.asar 内，**不在** kernels 目录）。
	// asar 头部是 JSON 目录表，条目 offset 相对「16 + headerSize」的数据区。
	const asarPath = path.join(
		process.env.LOCALAPPDATA || path.join(process.env.HOME || "", "AppData", "Local"),
		"Programs", "DeepSeek Harness", "resources", "app.asar"
	);
	try {
		const fd = fs.openSync(asarPath, "r");
		try {
			const head = Buffer.alloc(16);
			fs.readSync(fd, head, 0, 16, 0);
			const headerSize = head.readUInt32LE(12);
			const hbuf = Buffer.alloc(headerSize);
			fs.readSync(fd, hbuf, 0, headerSize, 16);
			const header = JSON.parse(hbuf.toString("utf8"));
			const baseOffset = 16 + headerSize;
			const target = ["dsh", "node_modules", "@deepseek-ai", "dsh-client-ui-conversation", "lib", "client.js"];
			let node = header;
			for (const part of target) {
				node = node && node.files ? node.files[part] : void 0;
				if (node === void 0) break;
			}
			if (node !== void 0 && typeof node.size === "number") {
				const buf = Buffer.alloc(node.size);
				fs.readSync(fd, buf, 0, node.size, baseOffset + Number(node.offset));
				// asar 条目前可能有 1..n 字节对齐填充；从 __ModuleLoader__ 处起算。
				const code = buf.toString("utf8");
				const at = code.indexOf("window.__ModuleLoader__");
				if (at >= 0) {
					const hit = fromSource(code.slice(at), "app.asar");
					if (hit !== null) found.push(hit);
				}
			}
		} finally { fs.closeSync(fd); }
	} catch (error) { /* asar 不存在或结构不同：静默跳过 */ }

	return found;
}/** 极简偏好仓库替身：只需 subscribe/getSnapshot。 */
function makePrefs(initial) {
	const state = { ...initial };
	return { subscribe: () => () => {}, getSnapshot: () => state, __state: state };
}

/** 把 createElement 的产物递归摊平成可断言的文本摘要。 */
function flatten(element) {
	if (element === null || element === void 0 || typeof element === "boolean") return "";
	if (typeof element === "string" || typeof element === "number") return String(element);
	if (Array.isArray(element)) return element.map(flatten).join("");
	// reactStub.createElement 把子节点放在独立的 children 字段（非 props.children）。
	const inner = element.children === void 0 ? "" : flatten(element.children);
	return inner;
}

/**
 * 造一个内核 modelDirectories 服务的替身（v0.4.4）。
 *
 * 为什么要有 `needsRemote` 两态：功能一的取数路径依赖调用方 fiber 声明 `remote`
 * （内核 `directoryFor()` 在调用方上下文里读 `this.ctx.remote.session`）。这里用
 * 「内核是否提供 remote」两种内核来夹住这个设计属性：
 *   - 提供 remote  → 功能一必须注册且能冷解析出目录（正向）；
 *   - 不提供 remote → 功能一必须**优雅缺席**，entry 仍 ACTIVE、审计 0 失败（负向）。
 * 后者正是 v0.4.2 那条铁律的守卫：硬依赖只能关在子作用域里，绝不能回到 entry 上。
 *
 * 注：cordis 的 Service tracker 把 `this.ctx` 重绑到调用方这一行为，在假内核里
 * 无法忠实复刻（真实的内核 remote.session 是嵌套追踪服务），因此「冷调抛错」本身
 * 由真机冒烟（tools/live-smoke.mjs）在真内核上负责验证，这里只钉住设计属性。
 */
function makeResolverClass({ needsRemote }) {
	return class FakeModelDirectoryResolver extends Service {
		static inject = needsRemote ? ["sessions", "remote", "remote.session"] : ["sessions"];

		constructor(ctx, config) {
			super(ctx, "modelDirectories");
			this.ledger = config.ledger;
		}

		directoryFor(sessionId) {
			const remoteSession = needsRemote ? this.ctx.remote.session : void 0;
			this.ledger.directoryCalls.push(String(sessionId));
			return {
				store: {
					subscribe: () => () => {},
					getSnapshot: () => ({ groups: [], current: null, status: "ready", routable: true })
				},
				load: () => Promise.resolve(),
				select: () => Promise.resolve(),
				__remoteSession: remoteSession
			};
		}
	};
}

/**
 * 造一个「内核」插件：把插件入口 inject 需要的服务 provide 出来。
 * alpha=false 模拟 0.1.1-rc.x（store 里没有 uiConversation / uiSession 的提供方），
 * alpha=true 模拟 0.1.2-alpha.1+。
 *
 * @param opts.alpha          是否提供 target 体系两个服务
 * @param opts.withholdRemote 是否扣掉 remote 命名空间（负向场景 D）
 * @param opts.ledger         观测点：registered/provided/opened/locale/directoryCalls
 * @param opts.seats          槽位注册表（name → [{ def, component }]），供取 inject face 断言
 */
function makeKernel({ alpha, withholdRemote = false, ledger, seats }) {
	const slot = (name) => {
		if (!seats.has(name)) seats.set(name, []);
		return seats.get(name);
	};
	const slots = {
		// 真实现里 factory 在「槽声明出现时」才被调用；宿主侧槽位早已声明，
		// 这里立即调用即可等价（并让 register 落进 seats）。
		inject: (name, factory) => { factory(); return () => {}; },
		register: (def, component) => {
			slot(def.name).push({ def, component });
			ledger.registered.push(`${def.name}/${def.id ?? ""}`);
			return () => {};
		},
		entries: (name) => seats.get(name)?.map((row) => row.def) ?? [],
		getVersion: () => 0,
		subscribe: () => () => {},
		hostFace: () => ({ storeOf: () => void 0 })
	};

	const dicts = new Map();
	const locale = {
		register: (ns, dict) => {
			dicts.set(ns, dict);
			ledger.locale.push(ns);
			return () => dicts.delete(ns);
		},
		bind: (ns) => (key, vars) => {
			const dict = dicts.get(ns) ?? {};
			let text = dict.zh?.[key] ?? dict.en?.[key] ?? key;
			for (const name of Object.keys(vars ?? {})) text = text.replace(`{${name}}`, String(vars[name]));
			return text;
		}
	};

	const services = {
		slots,
		locale,
		sessions: {
			list: { getSnapshot: () => ({ byId: { s1: { cwd: FAKE_CWD } } }) },
			subagentAddress: () => void 0
		},
		workspaces: {
			list: { getSnapshot: () => ({ items: [] }) },
			openPath: (target) => { ledger.opened.push(target); return Promise.resolve(); }
		},
		// modelDirectories 由下面真正的 cordis Service 提供（见 makeResolverClass），
		// 这里只负责 remote 命名空间的有无。
		...(withholdRemote ? {} : { remote: { session: FAKE_REMOTE_SESSION }, "remote.session": FAKE_REMOTE_SESSION })
	};
	if (alpha) {
		services.uiConversation = {
			binding: () => ({
				target: (name) => (name === "chat"
					? { getSnapshot: () => FAKE_CHAT_SNAPSHOT, subscribe: () => () => {} }
					: void 0)
			}),
			// 真内核的 UiConversation 同时提供 events（Definition 通道）与 views。
			// 功能五的「生成中估算条」走 events.register；这里忠实复刻并记录，
			// 供断言直接驱动该 Definition 的状态机。
			events: { register: (definition) => { ledger.definitions.push(definition); return () => {}; } }
		};
		services.uiSession = { provide: (def) => { ledger.provided.push(def); return () => {}; } };
	}
	return async function fakeKernel(ctx) {
		for (const [name, value] of Object.entries(services)) ctx.provide(name, value);
		// 必须在 provide 之后挂载并等它就位：Service 的 static inject 要能解析到
		// sessions（以及 needsRemote 时的 remote/remote.session），否则 bundle 的
		// modelDirectories 依赖会停在 PENDING。
		await ctx.plugin(makeResolverClass({ needsRemote: !withholdRemote }), { ledger });
	};
}

/** app-boot `assertEntriesActivated` 口径：只遍历 loader entry，PENDING 即失败。 */
function auditLoaderEntries(entries) {
	const failures = [];
	for (const { name, fiber } of entries) {
		if (fiber.state === FIBER.PENDING) {
			const missing = Object.keys(fiber.inject).filter((svc) => fiber.ctx.get(svc) === undefined);
			failures.push(`${name}: pending (waiting for services: ${missing.join(", ")})`);
		} else if (fiber.state === FIBER.FAILED) {
			failures.push(`${name}: failed`);
		}
	}
	return failures;
}

/** 子 fiber 不在 loader entry 里，只能按插件函数名从 registry 取。 */
function fibersOf(ctx, pluginName) {
	for (const runtime of ctx.registry.values()) {
		if (runtime.name === pluginName) return [...runtime.fibers];
	}
	return [];
}

/** 挂一个场景：假内核 + 真 bundle entry。 */
async function mount({ alpha, withholdRemote = false }) {
	const logs = { error: [], warn: [], info: [], appended: [] };
	const ledger = { registered: [], provided: [], opened: [], locale: [], directoryCalls: [], definitions: [] };
	const seats = new Map();
	const bundle = loadClientBundle(logs);
	const ctx = new Context();
	const kernelFiber = ctx.plugin(makeKernel({ alpha, withholdRemote, ledger, seats }));
	await kernelFiber;
	const entryFiber = ctx.plugin(bundle.mod);
	await entryFiber;
	const failures = auditLoaderEntries([{ name: "dsh-ui-tools", fiber: entryFiber }]);
	return { ctx, logs, ledger, seats, bundle, entryFiber, failures };
}

const faceAt = (seats, seatName) => seats.get(seatName)?.[0]?.def.inject();

/* ══════════════════════ 场景 0：声明层 ══════════════════════ */

section("0. 声明层：入口只声明跨内核服务");
const probe = loadClientBundle({ error: [], warn: [], info: [], appended: [] });
check("loader entry id = dsh-ui-tools", probe.id === "dsh-ui-tools", String(probe.id));
check("入口 inject = slots/modelDirectories/sessions/locale/workspaces",
	JSON.stringify(probe.mod.inject) === JSON.stringify(["slots", "modelDirectories", "sessions", "locale", "workspaces"]),
	probe.mod.inject.join(", "));
check("bundle 只 require react（client 模块表铁律）",
	probe.required.length > 0 && probe.required.every((id) => id === "react"),
	probe.required.join(",") || "（无）");

/* ── 场景 0b：机器可读内核约束（v0.4.5） ──
 * 生态实际消费的位置是 `engines.dsh`（dshmarket 的 manifestFacts 读它，并在
 * 安装/更新前拒装不兼容版本）；`dsh.engines.dsh` 是它的自然归属位置，两个位置都写。
 * 这里钉住的是「声明本身」——区间必须在真实 semver 下覆盖旧内核到当前内核，
 * 且不能把未来内核误判为不兼容（那会让 dshmarket 拒绝合法升级）。 */
{
	section("0b. 声明层：机器可读内核约束（engines.dsh）");
	const declared = manifest.engines?.dsh;
	const declaredNested = manifest.dsh?.engines?.dsh;
	check("package.json 声明 engines.dsh", typeof declared === "string" && declared.length > 0, String(declared));
	check("dsh.engines.dsh 与顶层一致（dshmarket 两处都读）", declared === declaredNested,
		`top=${String(declared)} nested=${String(declaredNested)}`);

	if (semver === null) {
		check("本机找到 semver（声明层断言需要真实语义）", false, "可用 DSH_SEMVER_ENTRY=<...>/semver/index.js 指定");
	} else {
		// npm 上**全部 29 个**已发布内核版本（@deepseek-ai/dsh）+ 3 个「未来」哨兵。
		// 逐项硬编码期望值，而不是按区间反推——否则断言退化成同义反复。
		//
		// ⚠ v0.4.8 修正：旧版本此处只列了 21 个内核，漏掉 0.1.6-alpha.2 / 0.1.5-rc.3（二者现已
		// 在列表内）以及整条 0.1.7 / 0.2.0 线——导致「双语义一致」类断言在那些版本上从未真正跑过。
		// 当前为全量 29 个已发布版本 + 3 个未来哨兵，逐项硬编码期望值（不再靠范围推导）。
		// （0.1.7-alpha.1 / 0.1.7-alpha.2 / 0.1.7-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.1 / 0.2.0-rc.2）。
		// 漏项让「两种 semver 语义判决一致」这条断言**假绿**：旧区间 `>=0.1.6-0` 在普通语义下
		// 不覆盖任何 0.1.7-*/0.2.0-* 预发布版（只在 includePrerelease 下才 true），恰是 6 条分流。
		// 现按发布线逐条声明并全量列表，令该类裂缝无处可藏（issue #1 暴露的正是这个缺口）。
		const KERNELS = [
			["0.0.1-rc.1", false], ["0.0.1-rc.2", false], ["0.0.1-rc.5", false],
			["0.1.0-rc.2", false], ["0.1.0-rc.3", false], ["0.1.0-rc.6", false], ["0.1.0-rc.7", false], ["0.1.0-rc.8", false],
			["0.1.1-rc.1", true], ["0.1.1-rc.2", true],
			["0.1.2-alpha.2", true], ["0.1.2-alpha.3", true], ["0.1.2-alpha.4", true], ["0.1.2-alpha.5", true],
			["0.1.2-rc.1", true], ["0.1.3-alpha.2", true],
			["0.1.5-alpha.1", true], ["0.1.5-alpha.2", true], ["0.1.5-rc.1", true], ["0.1.5-rc.2", true], ["0.1.5-rc.3", true],
			["0.1.6-alpha.1", true], ["0.1.6-alpha.2", true],
			// 0.1.7 / 0.2.0 线：旧区间在普通语义下**全部漏判**（只在 includePrerelease 下成立）。
			["0.1.7-alpha.1", true], ["0.1.7-alpha.2", true], ["0.1.7-rc.1", true], ["0.1.7-rc.2", true],
			["0.2.0-rc.1", true], ["0.2.0-rc.2", true],
			// 未发布：钉住「不硬顶未来内核」（误判会让 dshmarket 拒绝合法升级）
			["0.2.0", true], ["0.3.0-rc.1", true], ["1.0.0", true]
		];
		// 普通语义与市场语义（includePrerelease）必须逐项一致：两者不一致意味着
		// 声明在市场里和在本地 semver 下判决不同，是无声的兼容性裂缝。
		const divergent = KERNELS.filter(([v]) =>
			semver.satisfies(v, declared) !== semver.satisfies(v, declared, { includePrerelease: true }));
		check("两种 semver 语义（普通 / includePrerelease）判决一致",
			divergent.length === 0, divergent.map(([v]) => v).join(", ") || "一致");

		const wrong = KERNELS.filter(([v, want]) => semver.satisfies(v, declared) !== want);
		check(`区间覆盖全部已发布内核（29 个）+ 3 个未来哨兵`,
			wrong.length === 0,
			wrong.length ? wrong.map(([v, want]) => `${v} 期望 ${want} 实得 ${!want}`).join(", ")
				: "0.0.1-rc.1 → 1.0.0 逐项全对");

		// 回归钉子：README 曾写「0.1.2-alpha.1 及更新」，而该口径在真实 semver 下
		// **不匹配** 0.1.5-rc.2（预发布版只与同 x.y.z 的元组比较）。这条钉住本仓库
		// 当前实测内核 0.1.5-rc.2 必须被自己的声明覆盖。
		check("当前实测内核 0.1.5-rc.2 被自身声明覆盖（预发布回归钉）",
			semver.satisfies("0.1.5-rc.2", declared) === true,
			`${declared} vs 0.1.5-rc.2`);
		check("旧内核 0.1.1-rc.1 被覆盖（降级路径仍在声明内）",
			semver.satisfies("0.1.1-rc.1", declared) === true, `${declared} vs 0.1.1-rc.1`);
	}
}

/* ══════════════════════ 场景 A：旧内核 0.1.1-rc.x ══════════════════════ */

section("A. 旧内核（无 uiConversation）：静默降级");
{
	const env = await mount({ alpha: false });
	check("entry fiber = ACTIVE（入口不再卡死）", env.entryFiber.state === FIBER.ACTIVE, stateOf(env.entryFiber));
	check("boot 审计 0 失败 → 无「1 entry did not activate」/无横幅", env.failures.length === 0, env.failures.join(" | ") || "pass");

	const alpha = fibersOf(env.ctx, "alphaFeatures");
	check("alphaFeatures 子 fiber 已创建", alpha.length === 1, String(alpha.length));
	check("子 fiber 停在 PENDING（不报错、不计入审计）", alpha[0]?.state === FIBER.PENDING, stateOf(alpha[0]));
	check("未调用 ctx.uiSession.provide（函数体确实没执行）", env.ledger.provided.length === 0, String(env.ledger.provided.length));
	check("功能三已移除：任何内核都不再注册 conversation.view", env.ledger.registered.every((row) => !row.startsWith("conversation.view/")), env.ledger.registered.join(", "));

	for (const [label, seat] of [
		["功能一 模型双按钮", "conversation.input.right/ui-tools-model-seat"],
		["功能二 折叠条", "sidebar.footer.action/ui-tools-workspace-collapse"],
		["功能三 工作区徽章", "conversation.session.header.actions/ui-tools-workspace-chip"],
		["功能四 设置页", "settings.section/dsh-ui-tools"]
	]) {
		check(`旧内核保留 ${label}`, env.ledger.registered.includes(seat), seat);
	}

	const setFace = faceAt(env.seats, "settings.section");
	check("设置页 inject 暴露 capability 仓库", typeof setFace?.capability?.getSnapshot === "function");
	check("capability.alphaApi = false → 速度计开关灰显", setFace?.capability?.getSnapshot().alphaApi === false);
	check("灰显提示文案标注所需内核", /0\.1\.2-alpha\.1/.test(setFace?.t?.("alpha.unavailable") ?? ""), setFace?.t?.("alpha.unavailable") ?? "（无文案）");
	check("设置页不再含功能三开关文案（mfs.compact 已随功能三移除）",
		setFace?.t?.("mfs.compact") === "mfs.compact", String(setFace?.t?.("mfs.compact")));
	check("控制台无 dsh-ui-tools 异常（旧内核静默）", env.logs.error.length === 0, env.logs.error.join(" | ") || "clean");
	await env.entryFiber.dispose();
}

/* ══════════════════════ 场景 B：新内核 0.1.2-alpha.1+ ══════════════════════ */

section("B. 新内核（提供 uiConversation）：五个功能全部生效");
{
	const env = await mount({ alpha: true });
	check("boot 审计 0 失败", env.failures.length === 0, env.failures.join(" | ") || "pass");
	check("alphaFeatures 子 fiber = ACTIVE", fibersOf(env.ctx, "alphaFeatures")[0]?.state === FIBER.ACTIVE, stateOf(fibersOf(env.ctx, "alphaFeatures")[0]));
	check("功能三已移除：新内核上也不再注册 conversation.view",
		!env.ledger.registered.some((row) => row.startsWith("conversation.view/")),
		env.ledger.registered.join(", "));
	check("功能三已移除：不再调用 uiSession.provide（useModifiedFiles 随之消失）",
		env.ledger.provided.length === 0, String(env.ledger.provided.length));
	check("功能三已移除：不再调用 workspaces.openPath（openFile 链路已删）",
		env.ledger.opened.length === 0, env.ledger.opened.join(", ") || "（无调用）");

	// v0.4.4：功能一必须能「冷」解析出目录 —— 内核 directoryFor() 在**调用方**上下文里读
	// remote.session（Service tracker 重绑 this.ctx），插件少声明 remote 就会抛错。
	// 这正是 v0.4.3 在 0.1.5-rc.1 上每次挂载会话抛一次的缺陷。
	{
		const seatFace = env.seats.get("conversation.input.right")?.[0]?.def.inject("s1");
		check("功能一座位冷解析出可用目录（remote / remote.session 已声明）", seatFace?.available === true,
			JSON.stringify({ available: seatFace?.available }));
		check("功能一 directoryFor 真的被调到（冷路径走通）",
			env.ledger.directoryCalls.includes("s1"), env.ledger.directoryCalls.join(", ") || "（无调用）");
	}

	const setFace = faceAt(env.seats, "settings.section");
	check("capability.alphaApi = true → 速度计开关可用", setFace?.capability?.getSnapshot().alphaApi === true);

	// v0.4.12：样式注入必须「只有一份共享标签，且五份 CSS 全在里面」。
	// 历史缺陷：共享标签漏拼 WC_CSS，功能二又自建了一个只装 WC_CSS 的
	// <style id="dsh-ui-tools-wc-collapse-style">，等于同一份规则注入两次、
	// 且两个标签由不同 effect 各自拆卸（卸载中间帧会闪断折叠条样式）。
	{
		const styleTags = env.logs.appended.filter((node) => node && node.tag === "style");
		check("样式标签有且仅有一个（无第二份重复注入）",
			styleTags.length === 1, `appendChild 的 <style> 数 = ${styleTags.length}`);
		const css = styleTags[0]?.textContent ?? "";
		// 五份 CSS 各自的哨兵选择器，必须都出现在共享标签里
		const sentinels = [
			["功能一 MSS_CSS", "[data-mss-seat]"],
			["功能二 WC_CSS", ".wc-collapse-bar"],
			["功能三 WSC_CSS", "[data-wsc-chip]"],
			["功能四 SET_CSS", "[data-set-root]"],
			["功能五 TSP_CSS", "[data-tsp-pill]"]
		];
		const missing = sentinels.filter(([, needle]) => !css.includes(needle)).map(([label]) => label);
		check("共享样式标签含全部五份 CSS 哨兵（WC_CSS 不再漏拼）",
			missing.length === 0, missing.length === 0 ? "五份齐全" : `缺失：${missing.join("、")}`);
		check("不再存在功能二的独立 style 标签（id 已废弃）",
			!styleTags.some((node) => node.id === "dsh-ui-tools-wc-collapse-style"),
			styleTags.map((node) => `id=${String(node.id)}`).join(", ") || "（无 id）");
	}

	check("全程无异常/告警日志", env.logs.error.length === 0 && env.logs.warn.length === 0, env.logs.error.concat(env.logs.warn).join(" | ") || "clean");

	await env.entryFiber.dispose();
	check("entry dispose 后子 fiber 随之释放（无泄漏）", fibersOf(env.ctx, "alphaFeatures").length === 0, String(fibersOf(env.ctx, "alphaFeatures").length));
	check("dispose 后 capability.alphaApi 回落 false", setFace?.capability?.getSnapshot().alphaApi === false);
}

/* ══════════════════════ 场景 B2：功能五 输出速度计（v0.4.25 迁到 composer.dock） ══════════════════════ */

section("B2. 功能五：输出速度计（dock 统计行 pill：末回合精确 + 生成中估算）");
{
	const env = await mount({ alpha: true });

	// ① 注册位：conversation.composer.dock（输入框下方「N 轮 M 步」那一行），
	//    新 id + order 2（排在官方 activity 0 / usage 1 之后，纯增量新增）。
	const dockRows = env.seats.get("conversation.composer.dock") ?? [];
	const pill = dockRows.find((row) => row.def.id === "ui-tools-token-speed");
	check("功能五速度计注册进 conversation.composer.dock（输入框下方统计行）", pill !== void 0,
		env.ledger.registered.join(", "));
	check("dock 控件 order = 2（排在官方 activity/usage 之后）", pill?.def.order === 2, String(pill?.def.order));
	check("dock 控件 name 与注册名一致（内核 buildNode 校验 name）",
		pill?.def.name === "conversation.composer.dock", String(pill?.def.name));

	// 反向钉：旧的 assistant-actions pill 与 chat.node 渲染器 + Definition 通道必须全部消失。
	check("不再注册 conversation.chat.assistant-actions 的速度 pill",
		!env.ledger.registered.some((row) => row.startsWith("conversation.chat.assistant-actions/")),
		env.ledger.registered.join(", "));
	check("不再注册 conversation.chat.node 渲染器（自建 chat 节点方案已删）",
		!env.ledger.registered.some((row) => row.startsWith("conversation.chat.node/")),
		env.ledger.registered.join(", "));
	check("不再走 Definition 通道（ledger.definitions 为空）",
		env.ledger.definitions.length === 0,
		env.ledger.definitions.map((def) => def.kind).join(", ") || "（无）");

	const speed = loadTspSpeed();
	// 口径对齐内核：ΣoutputTokens ÷ Σ(completedTime − firstTokenTime)，只计 timing 齐备的 step。
	{
		const nodes = [
			{ kind: "assistant", turn: 1, messageId: "m1", timing: { firstTokenTime: 1000, completedTime: 3000 }, usage: { outputTokens: 100 } },
			{ kind: "assistant", turn: 1, messageId: "m2", timing: { firstTokenTime: 3000, completedTime: 5000 }, usage: { outputTokens: 200 } },
			// 同回合但 timing 不全 → 必须被跳过（只累加不完整的会让分母偏大）
			{ kind: "assistant", turn: 1, messageId: "m3", timing: { completedTime: 9000 }, usage: { outputTokens: 999 } },
			// 别的回合 → 必须被排除
			{ kind: "assistant", turn: 2, messageId: "m4", timing: { firstTokenTime: 0, completedTime: 1000 }, usage: { outputTokens: 777 } }
		];
		check("tspTurnSpeed（按 messageId）口径 = ΣoutputTokens ÷ ΣdecodeMs（跳过 timing 不全/异回合）",
			speed.tspTurnSpeed(nodes, "m2") === 300 / 4, `${String(speed.tspTurnSpeed(nodes, "m2"))} 期望 75`);
		check("tspFoldTurn（按回合号）与 tspTurnSpeed 同口径", speed.tspFoldTurn(nodes, 1) === 300 / 4,
			String(speed.tspFoldTurn(nodes, 1)));
		// 最近一回合：取最大 turn（此处 turn 2 只有 m4 → 777/1 = 777）。
		check("tspLastTurnSpeed 取最大回合再折叠", speed.tspLastTurnSpeed(nodes) === 777,
			String(speed.tspLastTurnSpeed(nodes)));
		check("tspLastTurnSpeed 空/非法入参返回 null",
			speed.tspLastTurnSpeed([]) === null && speed.tspLastTurnSpeed(void 0) === null);
	}

	check("无该 messageId 时返回 null（不猜、不显示）", speed.tspTurnSpeed([{ kind: "assistant", turn: 1, messageId: "x", timing: {}, usage: {} }], "nope") === null);
	check("解码时长为 0 时返回 null（避免除零得 Infinity）",
		speed.tspTurnSpeed([{ kind: "assistant", turn: 1, messageId: "m1", timing: { firstTokenTime: 5, completedTime: 5 }, usage: { outputTokens: 10 } }], "m1") === null);
	check("空/非法入参不抛错", speed.tspTurnSpeed(void 0, "m1") === null && speed.tspTurnSpeed(null, null) === null);

	// 显示口径与内核 formatTokensPerSecond 对齐：≥10 取整，否则一位小数。
	check("TPS 显示口径与内核一致（≥10 取整 / <10 一位小数）",
		speed.tspFormatTps(42.4) === "42" && speed.tspFormatTps(9.87) === "9.9", `${speed.tspFormatTps(42.4)} / ${speed.tspFormatTps(9.87)}`);

	// 字符→token 折算：CJK 按 1:1，拉丁按 4:1（仅在流式期间使用）。
	check("流式估算口径：CJK 1字≈1token / 拉丁 4字≈1token",
		speed.tspEstimateTokens("中文四字") === 4 && speed.tspEstimateTokens("abcd") === 1,
		`${speed.tspEstimateTokens("中文四字")} / ${speed.tspEstimateTokens("abcd")}`);

	// blocks 折算：text/reasoning 计 text，tool-call 计 name+argsRaw，其余（image/other）为 0。
	check("tspBlocksEffort：正文/推理/工具调用参数计努力量，其它 block 为 0",
		speed.tspBlocksEffort([
			{ kind: "text", text: "中文四字" },          // 4
			{ kind: "reasoning", text: "abcd" },        // 1
			{ kind: "tool-call", name: "edit", argsRaw: "abcd" }, // name(4字=1) + args(4字=1) = 2
			{ kind: "image" }                            // 0
		]) === 7,
		String(speed.tspBlocksEffort([{ kind: "text", text: "中文四字" }, { kind: "reasoning", text: "abcd" }, { kind: "tool-call", name: "edit", argsRaw: "abcd" }, { kind: "image" }])));
	check("tspBlocksEffort：非数组/空数组返回 0", speed.tspBlocksEffort(void 0) === 0 && speed.tspBlocksEffort([]) === 0);

	// ② 偏好开关：默认开、可持久化、坏数据回退。
	check("偏好新增 tokenSpeedEnabled 且默认开",
		env.seats.get("settings.section")?.[0]?.def.inject().prefs.getSnapshot().tokenSpeedEnabled === true);

	// ③ 组件层：直接调起 dock pill，钉住 DOM 结构与开关门控（不必依赖真机截图）。
	{
		const t = (key, vars) => {
			const dict = { "tps.exact": "{tps} tok/s", "tps.estimated": "≈ {tps} tok/s", "tps.liveNote": "生成中估算", "tps.title": "T", "tps.liveTitle": "L", "a11y.exact": "a{tps}", "a11y.estimated": "e{tps}" };
			let text = dict[key] ?? key;
			for (const name of Object.keys(vars ?? {})) text = text.replace(`{${name}}`, String(vars[name]));
			return text;
		};
		const on = makePrefs({ tokenSpeedEnabled: true });
		const off = makePrefs({ tokenSpeedEnabled: false });
		const nodes = [
			{ kind: "assistant", turn: 1, messageId: "m1", timing: { firstTokenTime: 0, completedTime: 4000 }, usage: { outputTokens: 120 } }
		];
		const snapshot = { legacy: { nodes, partial: void 0 } };
		const useTspChat = (sel) => sel(snapshot);

		// 精确值路径（无 partial）：120/4 = 30 → 「⚡30 tok/s」。
		const { TokenSpeedDockPill } = loadTspComponents();
		const pillEl = TokenSpeedDockPill({ useTspChat, t, prefs: on });
		check("dock pill：末回合精确值 30 tok/s 渲染文案", flatten(pillEl) === "⚡30 tok/s", flatten(pillEl));
		check("dock pill：带 data-tsp-pill 与 title/aria（真机选择器与可访问性）",
			pillEl?.props?.["data-tsp-pill"] === "" && typeof pillEl.props.title === "string" && pillEl.props["aria-label"] === "a30");
		check("dock pill：开关关闭时渲染 null（不占位）",
			TokenSpeedDockPill({ useTspChat, t, prefs: off }) === null);
		check("dock pill：无任何可算数据时渲染 null（不显示假值）",
			TokenSpeedDockPill({ useTspChat: (sel) => sel({ legacy: { nodes: [] } }), t, prefs: on }) === null);

		// 标准 props 路径（真机唯一可靠来源）：dock 是 session 作用域槽，内核通过
		// uiSession.provide({hooks:["chat"]}) 给组件注入 useChat（官方 ActivityPill
		// 同款）。v0.4.25 首发曾误用 inject(sessionId)，真机上 sessionId 为
		// undefined → 空快照 → 永不渲染；这里钉住「只给 useChat 也能算出来」。
		const useChatStd = (sel) => sel(snapshot);
		const stdEl = TokenSpeedDockPill({ useChat: useChatStd, t, prefs: on });
		check("dock pill：走内核标准 props useChat 即可算出末回合速度（真机路径）",
			flatten(stdEl) === "⚡30 tok/s", flatten(stdEl));
		check("dock pill：useChat 与 useTspChat 同时存在时优先用标准 useChat",
			TokenSpeedDockPill({
				useChat: (sel) => sel({ legacy: { nodes: [] } }),
				useTspChat: useTspChat,
				t,
				prefs: on
			}) === null);

		// 生成中估算路径：用可控 useRef + 受控时钟，模拟两帧流式增量。
		let clock = 0;
		const realNow = performance.now;
		performance.now = () => clock;
		const sharedRef = { current: null };
		const { TokenSpeedDockPill: DynPill } = loadTspComponents({ useRef: () => sharedRef });
		const partialState = { legacy: { nodes: [], partial: { turn: 1, step: 0, blocks: [{ kind: "text", text: "abcdabcd" }] } } };
		const useDyn = (sel) => sel(partialState);
		// 帧 1：建累积器（estTokens=0，尚不足以下结论）→ null。
		const frame1 = DynPill({ useTspChat: useDyn, t, prefs: on });
		// 帧 2：blocks 引用变化（新增量），时钟前进 1500ms（按 GAP_CAP 截断为 1000ms）。
		clock = 1500;
		partialState.legacy.partial = { turn: 1, step: 0, blocks: [{ kind: "text", text: "abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd" }] };
		const frame2 = DynPill({ useTspChat: useDyn, t, prefs: on });
		performance.now = realNow;
		check("dock pill：生成中按 blocks 折算并标注估算口径（≈ + 生成中估算）",
			flatten(frame2).includes("≈ ") && flatten(frame2).includes("生成中估算"), `${flatten(frame1)} → ${flatten(frame2)}`);
		check("dock pill：生成中 pill 带 data-tsp-pill 且 role=status（无障碍播报）",
			frame2?.props?.["data-tsp-pill"] === "" && frame2?.props?.role === "status");
	}

	await env.entryFiber.dispose();
}


/* ══════════════════════ 场景 B3：功能五 已移除的 Definition 通道（v0.4.25 反向钉） ══════════════════════
 * v0.4.25 把功能五从「assistant-actions 精确 pill + 自建 chat 节点 Definition」
 * 整体迁到 conversation.composer.dock。原方案里最脆弱的一环是 Definition 的
 * 「撤回了已物化节点」硬校验（v0.4.7 曾因此让整条 chat 快照链停更）—— 迁移后
 * 这条链路彻底不存在，本节改为**反向钉**：源码里不得再出现那套锚点符号。
 *
 * 保留此节的目的：防止有人「顺手」把 Definition 方案加回来而绕过 B2 的断言。
 * ═══════════════════════════════════════════════════════════════════════════════ */
section("B3. 功能五：Definition 通道已移除（反向钉）");
{
	const src = fs.readFileSync(BUNDLE, "utf8");
	check("源码不再含 tspLiveDefinition（自建 chat 节点方案已删）",
		!src.includes("function tspLiveDefinition"));
	check("源码不再含 token-speed-live kind / TSP_LIVE_KIND / TSP_LIVE_ANCHOR",
		!src.includes("token-speed-live") && !src.includes("TSP_LIVE_KIND") && !src.includes("TSP_LIVE_ANCHOR"));
	check("源码不再含 tspChunkEffort（按 chunk 折算已改为按 partial.blocks 折算）",
		!src.includes("tspChunkEffort"));
	check("源码不再含 data-tsp-live（生成中估算条样式已并入 dock pill）",
		!src.includes("data-tsp-live"));
	// 真内核装配器仍可发现时，顺带确认本插件的注册面只有 slots，没有 events.register。
	const kernels = loadKernelAssemblers();
	check("本机内核可载入 ConversationNodeAssembler（无内核时此信息项不阻塞）",
		kernels.length > 0, kernels.length === 0 ? "未找到内核副本（仅信息，不阻塞）" : kernels.map((k) => k.kernel).join(", "));
}

/* ══════════════════════ 场景 C：服务后到 ══════════════════════ */

section("C. 服务后到：子 fiber 自动补挂（无需轮询）");
{
	const env = await mount({ alpha: false });
	check("先按旧内核挂载：子 fiber PENDING", fibersOf(env.ctx, "alphaFeatures")[0]?.state === FIBER.PENDING, stateOf(fibersOf(env.ctx, "alphaFeatures")[0]));

	const lateFiber = env.ctx.plugin(function lateAlphaProvider(ctx) {
		ctx.provide("uiConversation", { binding: () => ({ target: () => ({ getSnapshot: () => FAKE_CHAT_SNAPSHOT, subscribe: () => () => {} }) }) });
	}, {});
	await lateFiber;
	await tick(12);

	check("服务出现后子 fiber 自动 = ACTIVE", fibersOf(env.ctx, "alphaFeatures")[0]?.state === FIBER.ACTIVE, stateOf(fibersOf(env.ctx, "alphaFeatures")[0]));
	check("补挂后功能五 速度计 pill 到位（子 fiber 函数体确实执行了）",
		env.ledger.registered.includes("conversation.composer.dock/ui-tools-token-speed"),
		env.ledger.registered.join(", "));
	check("功能三已移除：补挂后也不出现 conversation.view",
		!env.ledger.registered.some((row) => row.startsWith("conversation.view/")),
		env.ledger.registered.join(", "));
	check("补挂后 entry 仍 ACTIVE、审计仍 0 失败",
		env.entryFiber.state === FIBER.ACTIVE
		&& auditLoaderEntries([{ name: "dsh-ui-tools", fiber: env.entryFiber }]).length === 0);
	await env.entryFiber.dispose();
}

/* ══════════════════════ 场景 D：内核不提供 remote（v0.4.4 负向） ══════════════════════ */

section("D. 内核不提供 remote：功能一优雅缺席，不拖垮 entry（守住 v0.4.2 铁律）");
{
	const env = await mount({ alpha: true, withholdRemote: true });
	check("entry 仍 ACTIVE（remote 依赖没有逃到 entry 上）", env.entryFiber.state === FIBER.ACTIVE, stateOf(env.entryFiber));
	check("boot 审计 0 失败 → 无「1 entry did not activate」/无横幅", env.failures.length === 0, env.failures.join(" | ") || "pass");
	check("功能一缺席（子作用域停在 PENDING，可接受降级）",
		!env.ledger.registered.includes("conversation.input.right/ui-tools-model-seat"),
		env.ledger.registered.join(", "));

	for (const [label, seat] of [
		["功能二 折叠条", "sidebar.footer.action/ui-tools-workspace-collapse"],
		["功能三 工作区徽章", "conversation.session.header.actions/ui-tools-workspace-chip"],
		["功能四 设置页", "settings.section/dsh-ui-tools"]
	]) {
		check(`remote 缺席时仍保留 ${label}`, env.ledger.registered.includes(seat), seat);
	}
	check("无 dsh-ui-tools 异常日志（静默降级）", env.logs.error.length === 0, env.logs.error.join(" | ") || "clean");
	await env.entryFiber.dispose();
}

/* ══════════════════════ 汇报 ══════════════════════ */

let failed = 0;
for (const row of results) {
	if (row.section) { console.log(`\n${row.section}`); continue; }
	if (!row.ok) failed += 1;
	console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.label}${row.detail ? `  — ${row.detail}` : ""}`);
}
const total = results.filter((row) => !row.section).length;
console.log(`\n合计 ${total - failed}/${total} 通过（cordis：${located.kernel} → ${path.relative(process.cwd(), located.entry) || located.entry}）`);
console.log("行为矩阵：新内核 5/5 槽位功能（功能六为纯 DOM、无 slot，不参与该矩阵）；旧内核 4/5 槽位功能 + 无横幅（功能五缺席属预期降级）");
if (failed) process.exitCode = 1;
