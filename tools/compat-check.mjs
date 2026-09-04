#!/usr/bin/env node
/**
 * dsh-ui-tools 内核自适应回归检查（v0.4.2，方案 B：软依赖 + 子 fiber 隔离）
 *
 * 做什么：用**真实的 @deepseek-ai/cordis**（从本机已安装的 DSH 内核副本里取）
 * 搭一个最小宿主，把 `lib/client.js` 的 loader entry 挂进去，在三种内核场景下
 * 验证 docs/UI-TOOLS-KERNEL-ADAPT-DESIGN.md §4 的行为矩阵：
 *
 *   0 声明层：入口 inject 只剩五个跨内核服务；bundle 只 require react
 *   A 旧内核（0.1.1-rc.x，不提供 uiConversation / uiSession）
 *     → entry fiber ACTIVE，boot 审计 0 失败（= 无 `1 entry did not activate`
 *       / 无 Failed to load plugins 横幅）
 *     → alphaFeatures 子 fiber 停在 PENDING、函数体未执行（功能三缺席）
 *     → 功能一/二/四/五 的槽位注册全部在位；capability.alphaApi=false（灰显）
 *   B 新内核（0.1.2-alpha.1+，两服务齐备）→ 五个功能全部生效 + 无异常日志；
 *     entry dispose 后子 fiber 随之释放、能力位回落
 *   C 服务后到：先按旧内核挂载，随后补上两个服务 → 子 fiber 自动激活补挂
 *     （§10「服务后到时补挂功能」一行，无需轮询）
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
const { Context } = await import(pathToFileURL(located.entry).href);

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

/** 从 bundle 源码截取 MFS 提取段，直接测 collectModifiedFiles（不经 VDOM/hooks）。
 *  与 loadClientBundle 同一份 BUNDLE 源码，保证测的就是被测 bundle。 */
function loadMfsCollector() {
	const src = fs.readFileSync(BUNDLE, "utf8");
	const si = src.indexOf("/* 会改动文件系统的工具");
	const ei = src.indexOf("\t\t/** 展示用相对路径");
	if (si < 0 || ei < 0) throw new Error("MFS 提取段定位失败");
	const depSrc = src.slice(si, ei);
	// eslint-disable-next-line no-new-func
	return new Function(depSrc + "\nreturn collectModifiedFiles;")();
}

/**
 * 造一个「内核」插件：把插件入口 inject 需要的服务 provide 出来。
 * alpha=false 模拟 0.1.1-rc.x（store 里没有 uiConversation / uiSession 的提供方），
 * alpha=true 模拟 0.1.2-alpha.1+。
 *
 * @param opts.alpha   是否提供 target 体系两个服务
 * @param opts.ledger  观测点：registered/provided/opened/locale
 * @param opts.seats   槽位注册表（name → [{ def, component }]），供取 inject face 断言
 */
function makeKernel({ alpha, ledger, seats }) {
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
		modelDirectories: {
			directoryFor: () => ({
				store: { subscribe: () => () => {}, getSnapshot: () => ({}) },
				load: () => Promise.resolve(),
				select: () => Promise.resolve()
			})
		}
	};
	if (alpha) {
		services.uiConversation = {
			binding: () => ({
				target: (name) => (name === "chat"
					? { getSnapshot: () => FAKE_CHAT_SNAPSHOT, subscribe: () => () => {} }
					: void 0)
			})
		};
		services.uiSession = { provide: (def) => { ledger.provided.push(def); return () => {}; } };
	}
	return function fakeKernel(ctx) {
		for (const [name, value] of Object.entries(services)) ctx.provide(name, value);
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
async function mount({ alpha }) {
	const logs = { error: [], warn: [], info: [], appended: [] };
	const ledger = { registered: [], provided: [], opened: [], locale: [] };
	const seats = new Map();
	const bundle = loadClientBundle(logs);
	const ctx = new Context();
	const kernelFiber = ctx.plugin(makeKernel({ alpha, ledger, seats }));
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

/* ══════════════════════ 场景 A：旧内核 0.1.1-rc.x ══════════════════════ */

section("A. 旧内核（无 uiConversation / uiSession）：静默降级");
{
	const env = await mount({ alpha: false });
	check("entry fiber = ACTIVE（入口不再卡死）", env.entryFiber.state === FIBER.ACTIVE, stateOf(env.entryFiber));
	check("boot 审计 0 失败 → 无「1 entry did not activate」/无横幅", env.failures.length === 0, env.failures.join(" | ") || "pass");

	const alpha = fibersOf(env.ctx, "alphaFeatures");
	check("alphaFeatures 子 fiber 已创建", alpha.length === 1, String(alpha.length));
	check("子 fiber 停在 PENDING（不报错、不计入审计）", alpha[0]?.state === FIBER.PENDING, stateOf(alpha[0]));
	check("未调用 ctx.uiSession.provide（函数体确实没执行）", env.ledger.provided.length === 0, String(env.ledger.provided.length));
	check("功能三缺席：没有注册 conversation.view", env.ledger.registered.every((row) => !row.startsWith("conversation.view/")), env.ledger.registered.join(", "));

	for (const [label, seat] of [
		["功能一 模型双按钮", "conversation.input.right/ui-tools-model-seat"],
		["功能二 折叠条", "sidebar.footer.action/ui-tools-workspace-collapse"],
		["功能四 工作区徽章", "conversation.session.header.actions/ui-tools-workspace-chip"],
		["功能五 设置页", "settings.section/dsh-ui-tools"]
	]) {
		check(`旧内核保留 ${label}`, env.ledger.registered.includes(seat), seat);
	}

	const setFace = faceAt(env.seats, "settings.section");
	check("设置页 inject 暴露 capability 仓库", typeof setFace?.capability?.getSnapshot === "function");
	check("capability.alphaApi = false → 功能三开关灰显", setFace?.capability?.getSnapshot().alphaApi === false);
	check("灰显提示文案标注所需内核", /0\.1\.2-alpha\.1/.test(setFace?.t?.("mfs.unavailable") ?? ""), setFace?.t?.("mfs.unavailable") ?? "（无文案）");
	check("控制台无 dsh-ui-tools 异常（旧内核静默）", env.logs.error.length === 0, env.logs.error.join(" | ") || "clean");
	await env.entryFiber.dispose();
}

/* ══════════════════════ 场景 B：新内核 0.1.2-alpha.1+ ══════════════════════ */

section("B. 新内核（两服务齐备）：五个功能全部生效");
{
	const env = await mount({ alpha: true });
	check("boot 审计 0 失败", env.failures.length === 0, env.failures.join(" | ") || "pass");
	check("alphaFeatures 子 fiber = ACTIVE", fibersOf(env.ctx, "alphaFeatures")[0]?.state === FIBER.ACTIVE, stateOf(fibersOf(env.ctx, "alphaFeatures")[0]));
	check("功能三注册进 conversation.view（order 20）",
		env.ledger.registered.includes("conversation.view/ui-tools-modified-files")
		&& env.seats.get("conversation.view")?.[0]?.def.order === 20,
		env.ledger.registered.join(", "));
	check("注册 useModifiedFiles 标准 hook", (env.ledger.provided[0]?.hooks ?? []).includes("modifiedFiles"), JSON.stringify(env.ledger.provided[0]?.hooks ?? null));

	const viewFace = env.seats.get("conversation.view")?.[0]?.def.inject("s1");
	check("子 fiber 内仍能读跨内核服务（sessions 快照 cwd）", viewFace?.cwd === FAKE_CWD, String(viewFace?.cwd));
	await viewFace?.openFile("src/a.ts");
	check("openFile 经 workspaces.openPath 打开绝对路径", env.ledger.opened.includes(`${FAKE_CWD}/src/a.ts`), env.ledger.opened.join(", "));

	const hook = env.ledger.provided[0]?.resolve({ sessionId: "s1" })?.hooks?.modifiedFiles;
	check("useModifiedFiles 读到 chat target 快照", hook?.getSnapshot() === FAKE_CHAT_SNAPSHOT);

	// v0.4.3：run_code 内嵌工具调用的路径也要被提取（tools.write/edit/mkdir…）
	{
		const collect = loadMfsCollector();
		const files = collect(FAKE_CHAT_SNAPSHOT.legacy?.nodes ?? [], FAKE_CHAT_SNAPSHOT.legacy?.runningCalls ?? []);
		const paths = files.map((f) => f.path).sort();
		check("run_code 内嵌 write/edit/mkdir 路径被提取",
			["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/nested", "src/empty"].every((p) => paths.includes(p)),
			paths.join(", "));
	}

	const setFace = faceAt(env.seats, "settings.section");
	check("capability.alphaApi = true → 开关可用", setFace?.capability?.getSnapshot().alphaApi === true);
	check("全程无异常/告警日志", env.logs.error.length === 0 && env.logs.warn.length === 0, env.logs.error.concat(env.logs.warn).join(" | ") || "clean");

	await env.entryFiber.dispose();
	check("entry dispose 后子 fiber 随之释放（无泄漏）", fibersOf(env.ctx, "alphaFeatures").length === 0, String(fibersOf(env.ctx, "alphaFeatures").length));
	check("dispose 后 capability.alphaApi 回落 false", setFace?.capability?.getSnapshot().alphaApi === false);
}

/* ══════════════════════ 场景 C：服务后到 ══════════════════════ */

section("C. 服务后到：子 fiber 自动补挂（无需轮询）");
{
	const env = await mount({ alpha: false });
	check("先按旧内核挂载：子 fiber PENDING", fibersOf(env.ctx, "alphaFeatures")[0]?.state === FIBER.PENDING, stateOf(fibersOf(env.ctx, "alphaFeatures")[0]));

	const lateFiber = env.ctx.plugin(function lateAlphaProvider(ctx) {
		ctx.provide("uiConversation", { binding: () => ({ target: () => ({ getSnapshot: () => FAKE_CHAT_SNAPSHOT, subscribe: () => () => {} }) }) });
		ctx.provide("uiSession", { provide: (def) => { env.ledger.provided.push(def); return () => {}; } });
	}, {});
	await lateFiber;
	await tick(12);

	check("服务出现后子 fiber 自动 = ACTIVE", fibersOf(env.ctx, "alphaFeatures")[0]?.state === FIBER.ACTIVE, stateOf(fibersOf(env.ctx, "alphaFeatures")[0]));
	check("功能三选项卡被补挂", env.ledger.registered.includes("conversation.view/ui-tools-modified-files"), env.ledger.registered.join(", "));
	check("补挂后 entry 仍 ACTIVE、审计仍 0 失败",
		env.entryFiber.state === FIBER.ACTIVE
		&& auditLoaderEntries([{ name: "dsh-ui-tools", fiber: env.entryFiber }]).length === 0);
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
console.log("行为矩阵：新内核 5/5 功能；旧内核 4/5 功能 + 无横幅（功能三缺席属预期降级）");
if (failed) process.exitCode = 1;
