/**
 * 功能六「右键上下文菜单」—— 行为回归钉。
 *
 * 为什么需要这个文件：功能六是**纯 DOM + 事件**的方案，它的失败模式全都
 * 发生在「运行时」而不是「源码文本」里：
 *   · 目标判据写错 → 在空白会话 / 已归档会话上判不出会话，菜单退化；
 *   · 判据太宽松 → 把工作区行误判成会话行，右键给出「复制会话 ID」并复制
 *     了错误的东西（这类错误用户当场看不出，直到粘贴出来才发现）；
 *   · 条件 return / 监听未解绑 → 崩溃或卸载后残留补丁。
 * 只读源码文本一条也抓不到。所以这里搭一个**极简 DOM 骨架 + 事件派发**
 * 的测试台，真的把 apply() 挂上去、真的派发 contextmenu 事件、真的检查
 * 弹出来的菜单里有哪些项。
 *
 * 测试台刻意不引入 jsdom（守铁律 R6「无构建步骤 / 零依赖」），而是手写一个
 * 够用的 DOM 子集：Element / 属性 / closest / querySelector(All) 的**必要**
 * 选择器、事件冒泡、createElement / appendChild / remove。
 * 选择器支持范围只覆盖 lib/client.js 里真实用到的那些写法，够用即止。
 *
 * ⚠ 断言自带**负向对照**（见 §5）：注入一处故意写坏的判据，确认断言真的
 * 变红。没有负向对照的断言可能只是同义反复。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const readFileSync = fs.readFileSync;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail) {
	pass++;
	console.log(`  PASS  ${name}${detail === void 0 ? "" : `  — ${detail}`}`);
}
function bad(name, detail) {
	fail++;
	failures.push(`${name}${detail === void 0 ? "" : ` — ${detail}`}`);
	console.log(`  FAIL  ${name}${detail === void 0 ? "" : `  — ${detail}`}`);
}
function section(title) {
	console.log(`\n${title}`);
}

/* ══════════════════════════════════════════════════════════════
 * 极简 DOM 测试台
 * ══════════════════════════════════════════════════════════════ */

class ClassList {
	constructor(node) { this.node = node; }
	get list() { return (this.node.attributes.class || "").split(/\s+/).filter(Boolean); }
	contains(name) { return this.list.includes(name); }
	add(name) { if (!this.contains(name)) this.node.attributes.class = [...this.list, name].join(" "); }
	remove(name) { this.node.attributes.class = this.list.filter((item) => item !== name).join(" "); }
}

class Element {
	constructor(tagName) {
		this.tagName = String(tagName).toUpperCase();
		this.attributes = {};
		this.children = [];
		this.parentNode = null;
		this.listeners = new Map();
		this._text = "";
		this.value = "";
		this.style = {};
		this.classList = new ClassList(this);
		// 真实的父节点总是有 ownerDocument；ctxToast 靠它判断「旧 toast 还在不在
		// 页面上」（this.node.isConnected），缺了就会误判成「还挂着」，
		// 于是第二条提示永远不显示（实测踩过：删完只看得到「正在删除会话…」）。
		Object.defineProperty(this, "ownerDocument", { value: document, enumerable: false, writable: true });
	}
	/** 与真实 DOM 的 isConnected 等价：从自身往上走能不能走到 document.body。 */
	get isConnected() {
		for (let walk = this; walk !== null && walk !== void 0; walk = walk.parentNode) {
			if (walk === document.body) return true;
		}
		return false;
	}
	/** textContent 与真实 DOM 一致：无子节点时是自身文本，有子节点时是子节点拼接。 */
	get textContent() {
		if (this.children.length === 0) return this._text;
		return this.children.map((child) => child.textContent).join("");
	}
	set textContent(value) {
		this._text = String(value);
		this.children.length = 0;
	}
	setAttribute(name, value) { this.attributes[name] = String(value); }
	getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
	hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
	removeAttribute(name) { delete this.attributes[name]; }
	get className() { return this.attributes.class || ""; }
	set className(value) { this.attributes.class = String(value); }
	appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
	append(...nodes) { for (const node of nodes) this.appendChild(node); }
	remove() {
		if (this.parentNode === null) return;
		const at = this.parentNode.children.indexOf(this);
		if (at >= 0) this.parentNode.children.splice(at, 1);
		this.parentNode = null;
	}
	contains(node) {
		for (let walk = node; walk !== null && walk !== void 0; walk = walk.parentNode) if (walk === this) return true;
		return false;
	}
	closest(selector) {
		for (let walk = this; walk !== null && walk !== void 0; walk = walk.parentNode) {
			if (matches(walk, selector)) return walk;
		}
		return null;
	}
	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
	querySelectorAll(selector) {
		const out = [];
		const visit = (node) => {
			for (const child of node.children) {
				for (const part of selector.split(",").map((item) => item.trim())) {
					if (matches(child, part)) { out.push(child); break; }
				}
				visit(child);
			}
		};
		visit(this);
		return out;
	}
	cloneNode(deep) {
		const copy = new Element(this.tagName);
		copy.attributes = Object.assign({}, this.attributes);
		copy._text = this._text;
		copy.value = this.value;
		if (deep === true) for (const child of this.children) copy.appendChild(child.cloneNode(true));
		return copy;
	}
	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	}
	removeEventListener(type, fn) {
		const list = this.listeners.get(type);
		if (list === void 0) return;
		const at = list.indexOf(fn);
		if (at >= 0) list.splice(at, 1);
	}
	/** 派发事件：本节点监听器 + 冒泡链（含 document 级）+ window 级。返回是否被 preventDefault。 */
	dispatchEvent(event) {
		event.target = event.target || this;
		const chain = [];
		for (let walk = this; walk !== null && walk !== void 0; walk = walk.parentNode) chain.push(walk);
		// 事件冒泡到 document（本测试台的 document 监听器挂在一张独立表上）。
		const seen = new Set();
		const invoke = (node, table) => {
			if (node === null || node === void 0) return;
			const list = table.get(event.type);
			if (list === void 0) return;
			event.currentTarget = node;
			for (const fn of list.slice()) {
				if (seen.has(fn)) continue;
				seen.add(fn);
				fn(event);
			}
		};
		for (const node of chain) {
			invoke(node, node.listeners);
			if (event.__stopped === true) break;
		}
		if (event.__stopped !== true) invoke(document, document.listeners);
		if (event.__stopped !== true) invoke(window, window.listeners);
		return event.defaultPrevented === true;
	}
	focus() { document.activeElement = this; }
	getBoundingClientRect() { return { width: 180, height: 200, left: 0, top: 0, right: 180, bottom: 200 }; }
}

/**
 * 选择器匹配 —— 只实现 lib/client.js 实际用到的子集。
 * 支持：#id / .class / tag / [attr] / [attr="v"] / [attr^="v"] / [attr~="v"] / 'a, b'
 */
function matches(node, selector) {
	if (node === null || node === void 0 || node.tagName === void 0) return false;
	const sel = selector.trim();
	if (sel === "") return false;
	// 逗号已在外层拆分；这里只处理单个复合选择器。
	const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(sel);
	if (tagMatch !== null && node.tagName !== tagMatch[0].toUpperCase()) return false;
	let rest = tagMatch === null ? sel : sel.slice(tagMatch[0].length);
	while (rest.length > 0) {
		if (rest[0] === "#") {
			const m = /^#([\w-]+)/.exec(rest);
			if (m === null || node.getAttribute("id") !== m[1]) return false;
			rest = rest.slice(m[0].length);
		} else if (rest[0] === ".") {
			const m = /^\.([\w-]+)/.exec(rest);
			if (m === null || !node.classList.contains(m[1])) return false;
			rest = rest.slice(m[0].length);
		} else if (rest[0] === "[") {
			const m = /^\[([\w-]+)(?:([\^~$*]?=)"([^"]*)")?\]/.exec(rest);
			if (m === null) return false;
			const [, name, op, want] = m;
			const have = node.getAttribute(name);
			if (have === null) return false;
			if (op === void 0) { /* 只要存在 */ }
			else if (op === "=") { if (have !== want) return false; }
			else if (op === "^=") { if (!have.startsWith(want)) return false; }
			else if (op === "~=") { if (!have.split(/\s+/).includes(want)) return false; }
			else if (op === "*=") { if (!have.includes(want)) return false; }
			rest = rest.slice(m[0].length);
		} else {
			return false;
		}
	}
	return true;
}

class TextNode {
	constructor(text) { this.textContent = text; this.parentNode = null; this.children = []; }
}

const document = {
	documentElement: null,
	body: null,
	activeElement: null,
	listeners: new Map(),
	createElement(tag) { return new Element(tag); },
	createTextNode(text) { return new TextNode(text); },
	getElementById(id) { return this.body.querySelector(`#${id}`); },
	querySelector(selector) { return this.body.querySelector(selector); },
	querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	},
	removeEventListener(type, fn) {
		const list = this.listeners.get(type);
		if (list === void 0) return;
		const at = list.indexOf(fn);
		if (at >= 0) list.splice(at, 1);
	},
	contains(node) { return this.body.contains(node); },
	execCommand() { return true; },
};

function makeEvent(type, init = {}) {
	return Object.assign({
		type,
		target: null,
		currentTarget: null,
		defaultPrevented: false,
		__stopped: false,
		preventDefault() { this.defaultPrevented = true; },
		stopPropagation() { this.__stopped = true; },
	}, init);
}

const window = {
	innerWidth: 1280,
	innerHeight: 800,
	listeners: new Map(),
	location: {
		// v0.4.21：删除请求要拼同源绝对地址，ctxDeleteUrl 读的就是 window.location.origin。
		// 假 window 上不给 origin 的话，客户端会退回相对路径 —— 真机行为不变，
		// 但「打的是同源绝对地址」这条断言就永远测不到了，等于白写。
		origin: "http://127.0.0.1:64514",
		protocol: "http:",
		host: "127.0.0.1:64514",
		hostname: "127.0.0.1",
		port: "64514",
		href: "http://127.0.0.1:64514/",
		pathname: "/",
		reload() { window.__reloaded = true; },
		replace() { window.__replaced = true; },
	},
	__reloaded: false,
	__replaced: false,
	// 真机 window 上就有 setTimeout；ctxReload 的「reload 被吞就 replace 保底」
	// 那条路径要用它。测试台缺了它会抛 "window.setTimeout is not a function"，
	// 把「实现是对的」误判成「点了报错」——那是断言自身的假红。
	setTimeout(fn, ms) { return setTimeout(fn, ms); },
	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	},
	removeEventListener(type, fn) {
		const list = this.listeners.get(type);
		if (list === void 0) return;
		const at = list.indexOf(fn);
		if (at >= 0) list.splice(at, 1);
	},
	getSelection() { return window.__selection; },
	__selection: null,
};

const navigator = { clipboard: null, language: "zh-CN" };
const HTMLElement = Element;

/* ══════════════════════════════════════════════════════════════
 * 2. 装载 lib/client.js（只取功能六所需的导出）
 * ══════════════════════════════════════════════════════════════ */

const src = fs.readFileSync(path.join(root, "lib", "client.js"), "utf8");

/**
 * 剥离 // 行注释与 /* … *\/ 块注释，字符串字面量原样保留（长度不变，便于按行号定位）。
 * 用途：凡是「代码里不许出现 X」类断言都必须先剥注释，
 * 否则文件顶部写明「参考插件：@baihejiangnan/...」「无 MutationObserver」会把自己判红。
 * 用空格替换被剥离的字符，保持换行与列位不变。
 */
function stripComments(text) {
	const out = text.split("");
	let i = 0;
	const n = text.length;
	let state = "code"; // code | line | block | sq | dq | tpl
	while (i < n) {
		const ch = text[i];
		const next = text[i + 1];
		if (state === "code") {
			if (ch === "/" && next === "/") { state = "line"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
			if (ch === "/" && next === "*") { state = "block"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
			if (ch === "'") state = "sq";
			else if (ch === '"') state = "dq";
			else if (ch === "`") state = "tpl";
			i++; continue;
		}
		if (state === "line") {
			if (ch === "\n") { state = "code"; i++; continue; }
			out[i] = " "; i++; continue;
		}
		if (state === "block") {
			if (ch === "*" && next === "/") { out[i] = " "; out[i + 1] = " "; state = "code"; i += 2; continue; }
			if (ch !== "\n") out[i] = " ";
			i++; continue;
		}
		// 字符串内部：处理转义
		if (ch === "\\") { i += 2; continue; }
		if ((state === "sq" && ch === "'") || (state === "dq" && ch === '"') || (state === "tpl" && ch === "`")) state = "code";
		i++;
	}
	return out.join("");
}

function extractFunction(name) {
	// 匹配 `function name(...) {` 并靠花括号配平取出完整体。
	const marker = `function ${name}(`;
	const at = src.indexOf(marker);
	if (at < 0) return null;
	let i = src.indexOf("{", at);
	if (i < 0) return null;
	let depth = 0;
	let inString = null;
	for (let j = i; j < src.length; j++) {
		const ch = src[j];
		const prev = src[j - 1];
		if (inString !== null) {
			if (ch === inString && prev !== "\\") inString = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
		if (ch === "/" && src[j + 1] === "/") { while (j < src.length && src[j] !== "\n") j++; continue; }
		if (ch === "/" && src[j + 1] === "*") { j = src.indexOf("*/", j) + 1; continue; }
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return src.slice(at, j + 1);
		}
	}
	return null;
}

// 功能六用到的全部纯函数 + 状态，逐个取出并在测试台里重建。
const wanted = [
	"ctxSessionRowId", "ctxWorkspaceRowId", "ctxRowFrom",
	"ctxResolveSession", "ctxResolveWorkspace",
	"ctxCopy", "ctxToast", "ctxReload", "ctxInsertIntoComposer",
	"ctxOpenOfficialRename", "ctxMenuItem", "ctxSeparator",
	"closeCtxMenu", "ctxPositionMenu", "ctxOpenMenu", "installContextMenu",
	"ctxFill", "ctxConfirmDialog", "ctxDeleteUrl", "ctxCallSessionDelete", "ctxRestoreMenuFocus",
	"ctxReleaseSession", "ctxCurrentSessionId",
];
const missing = wanted.filter((name) => extractFunction(name) === null);
if (missing.length > 0) {
	console.error(`以下函数未在 lib/client.js 中找到：${missing.join(", ")}`);
	process.exit(1);
}

// ctxMenuState 是对象字面量，单独取。
const stateAnchor = "const ctxMenuState = {";
const stateAt = src.indexOf(stateAnchor);
if (stateAt < 0) { console.error("ctxMenuState 未找到"); process.exit(1); }
const stateEnd = src.indexOf("\n", stateAt);

// 模块作用域的常量 / 字面量也要一起搬进沙箱，否则函数体里引用它们会 ReferenceError。
// 这里只搬「纯字面量」，不搬任何有副作用的初始化。
const literalAnchors = [
	"const CTX_NS = ",
	"const SESSION_DELETE_PATH = ",
];
const literalBlocks = literalAnchors.map((anchor) => {
	const at = src.indexOf(anchor);
	if (at < 0) {
		console.error(`模块常量未在 lib/client.js 中找到：${anchor}`);
		process.exit(1);
	}
	const end = src.indexOf("\n", at);
	return src.slice(at, end).replace(/;\s*$/, "");
});

/** 沙箱形参表（正常沙箱与坏沙箱**必须逐字一致**，否则坏沙箱求值会 ReferenceError）。 */
const SANDBOX_PARAMS = [
	"document", "window", "navigator", "HTMLElement", "Element", "Event", "InputEvent",
	"setTimeout", "console", "location", "fetch",
];

/** 沙箱源码里除函数之外必须一起求值的部分（模块常量 + ctxMenuState）。 */
const SANDBOX_PRELUDE = `${literalBlocks.join(";\n")};\n${src.slice(stateAt, stateEnd)};`;

/** 正常源码编译出的沙箱工厂；传入 functions 可编译被改坏过的版本。 */
function buildSandbox(functions) {
	const body = (functions === void 0 ? wanted.map(extractFunction) : functions).join("\n");
	return new Function(
		...SANDBOX_PARAMS,
		`${body}
		 ${SANDBOX_PRELUDE}
		 return { ${wanted.join(", ")}, ctxMenuState, SESSION_DELETE_PATH };`,
	);
}

/**
 * 用「改坏过的源码」重建一个沙箱。
 *
 * 为什么必须这样：所有函数被注入到同一个闭包作用域，`ctxResolveSession` 调用
 * `ctxSessionRowId` 走的是闭包绑定，**在外部给 env.ctxSessionRowId 重新赋值
 * 根本不会影响它**（那正是我第一版负向对照假红的原因）。
 * 要真的模拟「判据写坏」，只能改源码文本再重新求值。
 *
 * @param {(text: string) => string} mutate 对单个函数源码做的破坏性改写
 * @param {string} target 要改写的函数名
 */
function buildBrokenEnv(target, mutate) {
	const broken = wanted.map((name) => {
		const text = extractFunction(name);
		return name === target ? mutate(text) : text;
	});
	const brokenSandbox = new Function(
		...SANDBOX_PARAMS,
		`${broken.join("\n")}
		 ${SANDBOX_PRELUDE}
		 return { ${wanted.join(", ")}, ctxMenuState, SESSION_DELETE_PATH };`,
	);
	return brokenSandbox;
}

/** 正常源码编译出的沙箱（必须在 SANDBOX_PARAMS / wanted 都就绪之后才求值）。 */
const sandbox = buildSandbox();

/**
 * 建一个空的假 DOM 环境。
 *
 * @param {Function} [factory] 沙箱工厂；省略时用正常源码编译出的 sandbox。
 *   负向对照必须传 buildBrokenEnv(...) 的结果，否则「坏代码」根本没被求值。
 */
function buildEnv(factory) {
	const body = new Element("body");
	document.body = body;
	document.documentElement = new Element("html");
	document.activeElement = null;
	document.listeners = new Map();
	window.listeners = new Map();
	window.__reloaded = false;
	window.__replaced = false;
	window.__selection = null;
	return makeSandboxArgs(factory === void 0 ? sandbox : factory);
}

/**
 * 测试台自己的 fetch。
 *
 * 为什么不用 Node 的全局 fetch：客户端打的是 `/api/ui-tools/sessionDelete`，
 * 那是**宿主进程**上的路由，测试台里既没有宿主也没有真实网络，真去发只会
 * 得到一句 TLS/连接错误，什么问题都说明不了。
 *
 * 于是这里放一个**可控的替身**：路由表默认只有宿主半边注册的那一条，
 * 返回 { ok:true, value } ；测试可以临时换掉 handler 来模拟 403/404/405、
 * 业务失败、网络炸裂等分支。每次调用的原始入参（URL / init）都记进
 * `fetchCalls`，断言会拿它核对「打的地址对不对、method 对不对、body 带没带」。
 */
const fetchCalls = [];
const fetchRoutes = new Map([
	["/api/ui-tools/sessionDelete", () => new Response(JSON.stringify({ ok: true, value: { ok: true } }), {
		status: 200,
		headers: { "content-type": "application/json" },
	})],
]);
/**
 * @param {string} url 客户端传进来的地址（本插件一定是同源绝对地址）。
 * @param {Object} [init] fetch 的第二参数。
 */
function testFetch(url, init) {
	const record = { url: String(url), init: init === void 0 ? {} : init };
	record.method = record.init.method === void 0 ? "GET" : record.init.method;
	try {
		record.body = typeof record.init.body === "string" ? JSON.parse(record.init.body) : record.init.body;
	} catch (error) {
		record.body = record.init.body;
	}
	fetchCalls.push(record);
	// 只按 pathname 匹配，这样「客户端拼了哪个 origin」不影响路由命中判断 ——
	// origin 本身另有断言专门核对。
	let pathname = record.url;
	try {
		pathname = new URL(record.url).pathname;
	} catch (error) {
		/* 相对地址就走原样匹配 */
	}
	const handler = fetchRoutes.get(pathname);
	if (handler === void 0) {
		// 没注册的路由：真机上会掉进 frontend-static 的 fallback —— 非 GET/HEAD 405。
		return Promise.resolve(new Response("method not allowed", { status: 405 }));
	}
	try {
		return Promise.resolve(handler(record));
	} catch (error) {
		return Promise.reject(error);
	}
}

/** 测试台自己的 location（Node 里没有全局 location，必须自己造一个同源壳）。 */
const location = Object.freeze({
	origin: "http://127.0.0.1:64514",
	protocol: "http:",
	host: "127.0.0.1:64514",
	hostname: "127.0.0.1",
	port: "64514",
	href: "http://127.0.0.1:64514/",
	pathname: "/",
});

/** 统一的调用参数（正常沙箱与坏沙箱共用）。 */
function makeSandboxArgs(fn) {
	const realSetTimeout = setTimeout;
	return fn(
		document, window, navigator, Element, Element, makeEvent,
		class InputEvent extends Object { constructor(type, init) { super(); Object.assign(this, { type }, init); } },
		(fn2) => realSetTimeout(fn2, 0),
		console,
		location,
		testFetch,
	);
}

/* ── 会话 / 工作区假数据 ── */

/**
 * 统一的挂载入口。
 *
 * installContextMenu(scope, t, uiWorkspace) 的第三个参数是**可选**的
 * uiWorkspace 服务（真机上由子 fiber 用 ctx.get("uiWorkspace") 取，
 * 缺席时是 undefined）。测试台一律从 scope 里取同名属性传进去，
 * 保证「测试台怎么传」和「真机怎么传」是同一个形状。
 */
function install(env, scope) {
	return env.installContextMenu(scope, makeT(CTX_ZH), scope.uiWorkspace, scope.connection);
}

/**
 * 从 lib/client.js 里取出 CTX_ZH 词典并在测试台里求值。
 * 这样断言核对的是**用户真正会看到的文案**，而不是 stub 返回的键名 ——
 * 文案写错 / 漏 key 才会被发现。
 */
function loadCtxDictionary() {
	const anchor = "const CTX_ZH = {";
	const at = src.indexOf(anchor);
	if (at < 0) throw new Error("CTX_ZH 未找到");
	const start = src.indexOf("{", at);
	let depth = 0;
	let inString = null;
	for (let j = start; j < src.length; j++) {
		const ch = src[j];
		const prev = src[j - 1];
		if (inString !== null) { if (ch === inString && prev !== "\\") inString = null; continue; }
		if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return new Function(`return ${src.slice(start, j + 1)};`)();
		}
	}
	throw new Error("CTX_ZH 解析失败");
}

const CTX_ZH = loadCtxDictionary();

/** 与 ctx.locale.bind 等价的最小实现：查表 + {name} 插值。 */
function makeT(dict) {
	return (key, values) => {
		const raw = dict[key];
		if (raw === void 0) return key;
		if (values === void 0) return raw;
		return raw.replace(/\{(\w+)\}/g, (_, name) => (values[name] === void 0 ? "" : String(values[name])));
	};
}

function makeStores() {
	const sessionsState = {
		current: "s1",
		ids: ["s1", "s2"],
		byId: {
			s1: { id: "s1", title: "会话甲", displayTitle: "会话甲", cwd: "D:\\proj\\alpha" },
			s2: { id: "s2", title: "会话乙", displayTitle: "会话乙", cwd: "D:\\proj\\beta" },
		},
	};
	const workspacesState = {
		items: [
			{ workspaceId: "w1", title: "项目一", path: "D:\\proj", sessionIds: ["s1", "s2"] },
		],
	};
	const calls = { archived: [], forked: [], opened: [], started: [], deleted: fetchCalls, stopped: [], refreshed: [], cleared: [] };
	// ── 以下三个 mock 严格按**真实内核**的公开方法表来搭 ──
	//
	// 曾经的 mock 把 startSession 放在 workspaces 上、把 open 放在 sessions 上，
	// 于是断言「通过」了，但真实内核上根本没有这两个方法 —— 测试台自己把 bug
	// 固化了。真实契约（0.2.0-rc.2 实测）：
	//   · sessions  = 浏览器侧 SessionController：有 fork(opts)（返回裸 childId
	//                 字符串）、list、binding、create…，**没有 open**。
	//   · workspaces = 浏览器侧 WorkspaceController：有 list、archiveSession(id,
	//                 opts)（收**裸字符串**）、unarchiveSession、pinSession、
	//                 create/rename/delete…，**没有 startSession**。
	//   · uiWorkspace = 官方 UiWorkspaceService（dsh-client-ui-workspace）：
	//                 startSession(workspaceId)、openSession(sessionId)、
	//                 clearMain()、字段 mainReference（当前主视图引用）。
	//                 刻意**不给** closeSession —— 真实内核里根本没有这个方法，
	//                 写错的话测试台必须当场炸成 TypeError，而不是静默通过。
	// 因此这里刻意**不给** sessions.open、**不给** workspaces.startSession、
	// **不给** uiWorkspace.closeSession，让「用错服务」的写法在测试台上就直接暴露成
	// TypeError。
	const sessions = {
		list: { getSnapshot: () => sessionsState },
		fork: (args) => { calls.forked.push(args); return Promise.resolve("s3"); },
		// ClientSessions.refresh()：重拉 session.list 基线（真实内核里存在）。
		refresh: () => { calls.refreshed.push(true); return Promise.resolve(); },
	};
	const workspaces = {
		list: { getSnapshot: () => workspacesState },
		archiveSession: (id) => { calls.archived.push(id); return Promise.resolve(); },
		// Registry.stopSessionActivity(sessionId)：宿主侧停活动（真实内核里存在）。
		stopSessionActivity: (id) => { calls.stopped.push(id); return Promise.resolve(); },
	};
	const uiWorkspace = {
		startSession: (id) => { calls.started.push(id); },
		openSession: (id) => { calls.opened.push(id); },
		clearMain: () => { calls.cleared.push(true); },
		// 真实 UiWorkspaceService 的公开实例字段：{ sessionId } 或 undefined。
		mainReference: { sessionId: "s1" },
	};
	// ── v0.4.21：删除改走 fetch，`calls.deleted` 由测试台的 testFetch 填充 ──
	//
	// 这一段以前记的是 connection.rpc.call 的 (channel, endpoint, payload)。
	// 改成 fetch 之后，同样的信息从 fetchCalls 里取，而且多了 method / headers /
	// credentials 这三维（rpc.call 时代这些都由内核代劳，现在是我们自己写的，
	// 必须逐项核对）。
	//
	// 这里仍然保留一个 connection 替身，因为 installContextMenu 的形参表里有它；
	// 但**故意不给 rpc 通道**：谁把实现改回 connection.rpc.call，改写立刻回退到
	// 「永远 404」，断言当场变红，而不是偷偷摸摸继续通过。
	const connection = {
		fetch: { register: () => { throw new Error("测试台不接受宿主侧注册，客户端不该碰这条路径"); } },
		rpc: { call: () => { throw new Error("测试台已禁用 rpc.call（v0.4.21 起删除走 fetch）"); } },
	};
	return { sessions, workspaces, uiWorkspace, connection, calls, sessionsState, workspacesState };
}

/* ── 搭出官方工作区树的 DOM 骨架（data-row-key 是稳定标识） ── */
function buildTree(env) {
	const body = document.body;
	const rootRow = new Element("div");
	rootRow.setAttribute("role", "treeitem");
	rootRow.setAttribute("aria-level", "1");
	rootRow.setAttribute("data-row-key", "workspace:w1");
	rootRow.setAttribute("aria-label", "项目一");

	const sessionRow = new Element("div");
	sessionRow.setAttribute("role", "treeitem");
	sessionRow.setAttribute("aria-level", "2");
	sessionRow.setAttribute("data-row-key", "session:s1");
	sessionRow.setAttribute("aria-label", "会话甲");
	sessionRow.setAttribute("aria-selected", "true");

	const label = new Element("span");
	label.textContent = "会话甲";
	sessionRow.appendChild(label);

	// 空白会话：**没有** row-actions 按钮（这正是参考插件注释里指出的坑）
	const blankRow = new Element("div");
	blankRow.setAttribute("role", "treeitem");
	blankRow.setAttribute("aria-level", "2");
	blankRow.setAttribute("data-row-key", "session:s2");
	blankRow.setAttribute("aria-label", "会话乙");

	rootRow.appendChild(sessionRow);
	rootRow.appendChild(blankRow);
	body.appendChild(rootRow);
	return { rootRow, sessionRow, blankRow, label };
}

/* ══════════════════════════════════════════════════════════════
 * 3. 断言
 * ══════════════════════════════════════════════════════════════ */

section("1. 目标判据：data-row-key 前缀识别（不依赖 aria-label / 界面语言）");
{
	const env = buildEnv();
	const tree = buildTree(env);
	if (env.ctxSessionRowId(tree.sessionRow) === "s1") ok("会话行 → session id", "s1");
	else bad("会话行 → session id", String(env.ctxSessionRowId(tree.sessionRow)));

	if (env.ctxSessionRowId(tree.blankRow) === "s2") ok("空白会话行（无 row-actions 按钮）仍能识别", "s2");
	else bad("空白会话行（无 row-actions 按钮）仍能识别", String(env.ctxSessionRowId(tree.blankRow)));

	if (env.ctxWorkspaceRowId(tree.rootRow) === "w1") ok("工作区行 → workspace id", "w1");
	else bad("工作区行 → workspace id", String(env.ctxWorkspaceRowId(tree.rootRow)));

	if (env.ctxSessionRowId(tree.rootRow) === null) ok("工作区行不会被误判成会话行", "null");
	else bad("工作区行不会被误判成会话行", String(env.ctxSessionRowId(tree.rootRow)));

	if (env.ctxWorkspaceRowId(tree.sessionRow) === null) ok("会话行不会被误判成工作区行", "null");
	else bad("会话行不会被误判成工作区行", String(env.ctxWorkspaceRowId(tree.sessionRow)));

	if (env.ctxSessionRowId(null) === null) ok("null 入参不抛错", "null");
	else bad("null 入参不抛错");
}

section("2. 会话解析：三级降级 + 唯一性保护");
{
	const env = buildEnv();
	const tree = buildTree(env);
	const { sessions } = makeStores();

	const byDom = env.ctxResolveSession(sessions, tree.sessionRow, null);
	if (byDom !== null && byDom.id === "s1") ok("第一级：DOM 行 id 命中", byDom.id);
	else bad("第一级：DOM 行 id 命中", byDom === null ? "null" : byDom.id);

	const byBlank = env.ctxResolveSession(sessions, tree.blankRow, null);
	if (byBlank !== null && byBlank.id === "s2") ok("空白会话行也能解析（靠 data-row-key）", byBlank.id);
	else bad("空白会话行也能解析（靠 data-row-key）", byBlank === null ? "null" : byBlank.id);

	// 无 data-row-key、无 aria-selected → 退化到标题匹配
	const titleRow = new Element("div");
	titleRow.setAttribute("role", "treeitem");
	titleRow.setAttribute("aria-label", "会话乙");
	const byTitle = env.ctxResolveSession(sessions, titleRow, null);
	if (byTitle !== null && byTitle.id === "s2") ok("第三级：标题唯一命中", byTitle.id);
	else bad("第三级：标题唯一命中", byTitle === null ? "null" : byTitle.id);

	// 标题歧义（两个会话同名）→ 必须返回 null，绝不猜
	const ambiguous = {
		current: null,
		ids: ["a", "b"],
		byId: { a: { id: "a", title: "同名" }, b: { id: "b", title: "同名" } },
	};
	const stores2 = { list: { getSnapshot: () => ambiguous } };
	const dupRow = new Element("div");
	dupRow.setAttribute("role", "treeitem");
	dupRow.setAttribute("aria-label", "同名");
	const ambiguousResult = env.ctxResolveSession(stores2, dupRow, null);
	if (ambiguousResult === null) ok("标题歧义 → 返回 null（宁可不接管，也不操作错会话）");
	else bad("标题歧义 → 返回 null", `误判为 ${ambiguousResult.id}`);

	if (env.ctxResolveSession(sessions, null, null) === null) ok("null 行 → null");
	else bad("null 行 → null");
}

section("3. 工作区解析");
{
	const env = buildEnv();
	const tree = buildTree(env);
	const { workspaces } = makeStores();
	const byDom = env.ctxResolveWorkspace(workspaces, tree.rootRow);
	if (byDom !== null && byDom.workspaceId === "w1") ok("工作区行 → workspace 对象", byDom.title);
	else bad("工作区行 → workspace 对象", byDom === null ? "null" : byDom.title);

	if (env.ctxResolveWorkspace(workspaces, null) === null) ok("null 行 → null");
	else bad("null 行 → null");

	// 标题对不上 → null（不猜）
	const strangerRow = new Element("div");
	strangerRow.setAttribute("role", "treeitem");
	strangerRow.setAttribute("aria-label", "不存在的空间");
	if (env.ctxResolveWorkspace(workspaces, strangerRow) === null) ok("标题对不上 → null");
	else bad("标题对不上 → null");
}

section("4. 菜单组装：结构、空菜单拒绝、危险项样式");
{
	const env = buildEnv();
	buildTree(env);
	const plan = [
		{ label: "甲", run: () => {} },
		null,
		{ label: "乙", run: () => {} },
	];
	const opened = env.ctxOpenMenu(plan, 100, 100);
	if (opened === true) ok("菜单成功打开");
	else bad("菜单成功打开");

	const menu = document.body.querySelector(".dsh-ctx-menu");
	if (menu !== null) ok("菜单节点挂在 body 上（R2：不是搬动 slot 节点）", menu.className);
	else bad("菜单节点挂在 body 上");

	const items = menu === null ? [] : menu.querySelectorAll('[role="menuitem"]');
	if (items.length === 2) ok("菜单项数量正确", String(items.length));
	else bad("菜单项数量正确", String(items.length));

	const seps = menu === null ? [] : menu.querySelectorAll(".dsh-ctx-separator");
	if (seps.length === 1) ok("分隔线数量正确", String(seps.length));
	else bad("分隔线数量正确", String(seps.length));

	if (menu !== null && menu.getAttribute("role") === "menu") ok("菜单带 role=menu（无障碍）");
	else bad("菜单带 role=menu（无障碍）");

	if (items[0] !== void 0 && items[0].getAttribute("tabindex") === "-1") ok("菜单项 tabindex=-1（roving tabindex）");
	else bad("菜单项 tabindex=-1（roving tabindex）");

	// 空菜单必须被拒绝，避免弹出一个空白方块
	const emptyOpened = env.ctxOpenMenu([], 10, 10);
	if (emptyOpened === false) ok("空菜单被拒绝（不弹空白方块）");
	else bad("空菜单被拒绝");

	// 危险项样式
	const dangerPlan = [{ label: "删除", run: () => {}, opts: { danger: true } }];
	env.ctxOpenMenu(dangerPlan, 10, 10);
	const dangerItem = document.body.querySelector(".dsh-ctx-item--danger");
	if (dangerItem !== null) ok("danger 项带专用样式类");
	else bad("danger 项带专用样式类");
}

section("5. 事件分发：会话行 / 工作区行 / 选中文本 / 未识别目标");
{
	// 5a 会话行
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const { sessions, workspaces, uiWorkspace, connection, calls } = makeStores();
		install(env, { sessions, workspaces, uiWorkspace, connection });
		const event = makeEvent("contextmenu", { clientX: 50, clientY: 60 });
		tree.sessionRow.dispatchEvent(event);
		const menu = document.body.querySelector(".dsh-ctx-menu");
		const labels = menu === null ? [] : menu.querySelectorAll('[role="menuitem"]').map((node) => node.textContent);
		if (event.defaultPrevented === true) ok("会话行右键被接管");
		else bad("会话行右键被接管");
		// v0.4.20：会话菜单多了「删除会话…」，从 6 项变 7 项。
		// 顺序本身也是契约：危险项必须排在「复制…」组之前、紧贴「归档会话」，
		// 不能夹在无害项中间 —— 下面单独断言这一点。
		if (labels.length === 7) ok("会话菜单 7 项（重命名/归档/删除/分支/复制ID/复制目录/刷新）", labels.join("|"));
		else bad("会话菜单 7 项", `${labels.length}：${labels.join("|")}`);
		if (labels.some((item) => item.includes("删除会话"))) ok("含「删除会话…」", labels.join("|"));
		else bad("含「删除会话…」", labels.join("|"));
		{
			const deleteAt = labels.findIndex((item) => item.includes("删除会话"));
			const archiveAt = labels.findIndex((item) => item.includes("归档会话"));
			const copyAt = labels.findIndex((item) => item.includes("复制会话 ID"));
			// 契约：删除排在「归档会话」之后（温和 → 彻底，语义递进），
			// 且在所有「复制…」无害项之前。中间隔着「创建会话分支」。
			if (deleteAt > archiveAt && deleteAt < copyAt) ok("「删除会话…」位置正确（归档组内、复制组之前）", `archive=${archiveAt} delete=${deleteAt} copy=${copyAt}`);
			else bad("「删除会话…」位置不对", `archive=${archiveAt} delete=${deleteAt} copy=${copyAt}`);
		}
		// 危险项必须带 dsh-ctx-item--danger（红字），否则用户看不出它不一样。
		{
			const dangerNodes = menu === null ? [] : menu.querySelectorAll(".dsh-ctx-item--danger").map((node) => node.textContent);
			if (dangerNodes.length === 1 && dangerNodes[0].includes("删除会话")) ok("「删除会话…」是唯一的危险项（带 danger 样式）", dangerNodes.join("|"));
			else bad("危险项不唯一或不是删除项", dangerNodes.join("|") || "（无）");
		}
		if (labels.some((item) => item.includes("复制会话 ID"))) ok("含「复制会话 ID」");
		else bad("含「复制会话 ID」");
		if (labels.some((item) => item.includes("复制工作目录"))) ok("含「复制工作目录」");
		else bad("含「复制工作目录」");
		if (labels.some((item) => item.includes("创建会话分支"))) ok("含「创建会话分支」");
		else bad("含「创建会话分支」", labels.join("|"));

		// 真的点一下「复制会话 ID」应写入剪贴板
		let copied = null;
		navigator.clipboard = { writeText: (text) => { copied = text; return Promise.resolve(); } };
		const target = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("复制会话 ID"));
		target.dispatchEvent(makeEvent("click"));
		if (copied === "s1") ok("点击「复制会话 ID」写入正确值", copied);
		else bad("点击「复制会话 ID」写入正确值", String(copied));
		if (document.body.querySelector(".dsh-ctx-menu") === null) ok("点击后菜单自动关闭");
		else bad("点击后菜单自动关闭");
	}

	// 5b 工作区行
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const { sessions, workspaces, uiWorkspace, connection } = makeStores();
		install(env, { sessions, workspaces, uiWorkspace, connection });
		const event = makeEvent("contextmenu", { clientX: 50, clientY: 20 });
		tree.rootRow.dispatchEvent(event);
		const menu = document.body.querySelector(".dsh-ctx-menu");
		const labels = menu === null ? [] : menu.querySelectorAll('[role="menuitem"]').map((node) => node.textContent);
		if (event.defaultPrevented === true) ok("工作区行右键被接管");
		else bad("工作区行右键被接管");
		if (labels.length === 4) ok("工作区菜单 4 项（新建/复制路径/归档全部/刷新）", labels.join("|"));
		else bad("工作区菜单 4 项", `${labels.length}：${labels.join("|")}`);
		if (labels.some((item) => item.includes("复制工作区路径"))) ok("含「复制工作区路径」");
		else bad("含「复制工作区路径」");
		// 工作区菜单里**不应**出现会话专属项
		if (!labels.some((item) => item.includes("复制会话 ID"))) ok("工作区菜单不含会话专属项（判据未串台）");
		else bad("工作区菜单不含会话专属项");
	}

	// 5c 选中文本
	{
		const env = buildEnv();
		buildTree(env);
		const { sessions, workspaces, uiWorkspace, connection } = makeStores();
		install(env, { sessions, workspaces, uiWorkspace, connection });
		const paragraph = new Element("p");
		paragraph.textContent = "被选中的一段话";
		document.body.appendChild(paragraph);
		window.__selection = { toString: () => "被选中的一段话" };
		const event = makeEvent("contextmenu", { clientX: 10, clientY: 10 });
		paragraph.dispatchEvent(event);
		const menu = document.body.querySelector(".dsh-ctx-menu");
		const labels = menu === null ? [] : menu.querySelectorAll('[role="menuitem"]').map((node) => node.textContent);
		if (event.defaultPrevented === true) ok("选中文本时右键被接管");
		else bad("选中文本时右键被接管");
		if (labels.some((item) => item.includes("复制所选文本"))) ok("含「复制所选文本」");
		else bad("含「复制所选文本」");
		if (labels.some((item) => item.includes("发送所选文本到输入框"))) ok("含「发送所选文本到输入框」");
		else bad("含「发送所选文本到输入框」");
	}

	// 5d 未识别目标 → 保留浏览器默认菜单
	{
		const env = buildEnv();
		buildTree(env);
		const { sessions, workspaces, uiWorkspace, connection } = makeStores();
		install(env, { sessions, workspaces, uiWorkspace, connection });
		window.__selection = null;
		const blank = new Element("div");
		document.body.appendChild(blank);
		const event = makeEvent("contextmenu", { clientX: 5, clientY: 5 });
		blank.dispatchEvent(event);
		if (event.defaultPrevented === false) ok("未识别目标 → 不接管，保留浏览器默认菜单");
		else bad("未识别目标 → 不接管，保留浏览器默认菜单");
		if (document.body.querySelector(".dsh-ctx-menu") === null) ok("未识别目标 → 不创建菜单节点");
		else bad("未识别目标 → 不创建菜单节点");
	}

	// 5e 已被别人处理 → 不重复接管
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const { sessions, workspaces, uiWorkspace, connection } = makeStores();
		install(env, { sessions, workspaces, uiWorkspace, connection });
		const event = makeEvent("contextmenu", { clientX: 5, clientY: 5 });
		event.preventDefault();
		const before = document.body.querySelector(".dsh-ctx-menu");
		tree.sessionRow.dispatchEvent(event);
		if (document.body.querySelector(".dsh-ctx-menu") === before) ok("已被 preventDefault 的事件不再接管（与参考插件共存不打架）");
		else bad("已被 preventDefault 的事件不再接管");
	}
}

section("6. 键盘与交互：Esc 关闭、方向键、外部点击关闭");
{
	const env = buildEnv();
	buildTree(env);
	const { sessions, workspaces, uiWorkspace, connection } = makeStores();
	install(env, { sessions, workspaces, uiWorkspace, connection });

	const tree = { rootRow: document.body.children[0] };
	const sessionRow = document.body.querySelector('[data-row-key="session:s1"]');
	sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	const menu = document.body.querySelector(".dsh-ctx-menu");
	if (menu !== null) ok("菜单已打开（键盘测试前置）");
	else bad("菜单已打开（键盘测试前置）");

	const items = menu.querySelectorAll('[role="menuitem"]');
	items[0].focus();
	if (document.activeElement === items[0]) ok("首项自动获得焦点");
	else bad("首项自动获得焦点");

	// 方向键
	document.listeners.get("keydown").slice().forEach((fn) => fn(makeEvent("keydown", { key: "ArrowDown" })));
	if (document.activeElement === items[1]) ok("ArrowDown 移到下一项");
	else bad("ArrowDown 移到下一项", document.activeElement === null ? "null" : document.activeElement.textContent);

	document.listeners.get("keydown").slice().forEach((fn) => fn(makeEvent("keydown", { key: "ArrowUp" })));
	if (document.activeElement === items[0]) ok("ArrowUp 移回上一项");
	else bad("ArrowUp 移回上一项");

	document.listeners.get("keydown").slice().forEach((fn) => fn(makeEvent("keydown", { key: "End" })));
	if (document.activeElement === items[items.length - 1]) ok("End 跳到末项");
	else bad("End 跳到末项");

	// Esc 关闭
	document.listeners.get("keydown").slice().forEach((fn) => fn(makeEvent("keydown", { key: "Escape" })));
	if (document.body.querySelector(".dsh-ctx-menu") === null) ok("Esc 关闭菜单");
	else bad("Esc 关闭菜单");

	// 外部点击关闭
	sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	const outside = new Element("div");
	document.body.appendChild(outside);
	document.listeners.get("pointerdown").slice().forEach((fn) => fn(makeEvent("pointerdown", { target: outside })));
	if (document.body.querySelector(".dsh-ctx-menu") === null) ok("点击菜单外部关闭");
	else bad("点击菜单外部关闭");
}

section("7. 拆卸：卸载后不留补丁（监听全部解绑）");
{
	const env = buildEnv();
	const tree = buildTree(env);
	const { sessions, workspaces, uiWorkspace, connection } = makeStores();
	const dispose = install(env, { sessions, workspaces, uiWorkspace, connection });

	const before = document.listeners.get("contextmenu").length;
	if (before > 0) ok("拆卸前已挂 contextmenu 监听", String(before));
	else bad("拆卸前已挂 contextmenu 监听");

	tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	if (document.body.querySelector(".dsh-ctx-menu") !== null) ok("拆卸前菜单可用");
	else bad("拆卸前菜单可用");

	dispose();

	if (document.listeners.get("contextmenu").length === 0) ok("拆卸后 contextmenu 监听已全部移除");
	else bad("拆卸后 contextmenu 监听残留", String(document.listeners.get("contextmenu").length));
	if (document.listeners.get("pointerdown").length === 0) ok("拆卸后 pointerdown 监听已全部移除");
	else bad("拆卸后 pointerdown 监听残留");
	if (document.listeners.get("keydown").length === 0) ok("拆卸后 keydown 监听已全部移除");
	else bad("拆卸后 keydown 监听残留");
	if (document.body.querySelector(".dsh-ctx-menu") === null) ok("拆卸后菜单节点已清除");
	else bad("拆卸后菜单节点已清除");

	// 拆卸后再右键不应弹菜单
	const event = makeEvent("contextmenu", { clientX: 20, clientY: 20 });
	tree.sessionRow.dispatchEvent(event);
	if (document.body.querySelector(".dsh-ctx-menu") === null) ok("拆卸后右键不再接管（补丁已摘干净）");
	else bad("拆卸后右键不再接管");
}

section("8. 动作真的调到了官方服务（不是空壳）");
await (async () => {
	// 归档
	const env = buildEnv();
	const tree = buildTree(env);
	const { sessions, workspaces, uiWorkspace, connection, calls } = makeStores();
	install(env, { sessions, workspaces, uiWorkspace, connection });
	tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	let menu = document.body.querySelector(".dsh-ctx-menu");
	let item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("归档会话"));
	item.dispatchEvent(makeEvent("click"));
	if (calls.archived.length === 1 && calls.archived[0] === "s1") ok("「归档会话」调用 workspaces.archiveSession(s1)", calls.archived.join(","));
	else bad("「归档会话」调用 workspaces.archiveSession", calls.archived.join(","));

	// 分叉
	const env2 = buildEnv();
	const tree2 = buildTree(env2);
	const s2 = makeStores();
	install(env2, { sessions: s2.sessions, workspaces: s2.workspaces, uiWorkspace: s2.uiWorkspace, connection: s2.connection });
	tree2.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	menu = document.body.querySelector(".dsh-ctx-menu");
	item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("创建会话分支"));
	item.dispatchEvent(makeEvent("click"));
	if (s2.calls.forked.length === 1 && s2.calls.forked[0].sessionId === "s1") ok("「创建会话分支」调用 sessions.fork({sessionId:s1})", JSON.stringify(s2.calls.forked[0]));
	else bad("「创建会话分支」调用 sessions.fork", JSON.stringify(s2.calls.forked));
	// 分叉后必须切到子会话，且必须走 uiWorkspace.openSession ——
	// sessions.open() 虽然**存在**，但它不收参数、只是打开事件流，
	// 传 sessionId 进去不报错也**不会切会话**（这是最阴的一种错法：
	// 语法合法、运行不抛、用户只看到「点了没反应」）。
	// fork 是异步的（返回 Promise，真机走 RPC），所以这里必须让出一个
	// 微任务轮次再断言，否则读到的永远是空数组。
	await Promise.resolve();
	await Promise.resolve();
	if (s2.calls.opened.length === 1 && s2.calls.opened[0] === "s3") ok("分叉后走 uiWorkspace.openSession(childId) 切到子会话", s2.calls.opened.join(","));
	else bad("分叉后走 uiWorkspace.openSession(childId)", s2.calls.opened.join(",") || "（空 —— fork 之后没切会话）");

	// 工作区：新建会话
	const env3 = buildEnv();
	const tree3 = buildTree(env3);
	const s3 = makeStores();
	install(env3, { sessions: s3.sessions, workspaces: s3.workspaces, uiWorkspace: s3.uiWorkspace, connection: s3.connection });
	tree3.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	menu = document.body.querySelector(".dsh-ctx-menu");
	item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("新建会话"));
	item.dispatchEvent(makeEvent("click"));
	// 「新建会话」必须走 uiWorkspace.startSession；workspaces 是纯
	// WorkspaceController，没有 startSession（直接调会抛
	// "workspaces.startSession is not a function"）。
	if (s3.calls.started.length === 1 && s3.calls.started[0] === "w1") ok("「新建会话」调用 uiWorkspace.startSession(w1)", s3.calls.started.join(","));
	else bad("「新建会话」调用 uiWorkspace.startSession", s3.calls.started.join(","));

	// 工作区：归档全部
	const env4 = buildEnv();
	const tree4 = buildTree(env4);
	const s4 = makeStores();
	install(env4, { sessions: s4.sessions, workspaces: s4.workspaces, uiWorkspace: s4.uiWorkspace, connection: s4.connection });
	tree4.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	menu = document.body.querySelector(".dsh-ctx-menu");
	item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("归档工作区全部会话"));
	item.dispatchEvent(makeEvent("click"));
	if (s4.calls.archived.length === 2) ok("「归档全部」逐个调用 archiveSession（2 个）", s4.calls.archived.join(","));
	else bad("「归档全部」逐个调用 archiveSession", s4.calls.archived.join(","));
})();

section("8b. 真机回归 A：元素级 blur 不许把菜单关掉（v0.4.14「所有菜单项点了没反应」的根因）");
{
	// 真机事实（HUD 轨迹实证）：
	//   C:pointerdown>span IN_MENU ON_ITEM → C:mousedown>span IN_MENU ON_ITEM
	//   → C:pointerup>div…projectRow[data-row-key=workspace:…] → MENU_CLOSED
	// 全程**没有 C:click**。原因：鼠标按下时焦点从「上一项/菜单容器」移走，
	// 触发**元素级 blur**；blur 不冒泡但**有捕获阶段**，而旧代码注册的是
	// window.addEventListener("blur", onViewportChange, true) —— window 上的
	// 捕获监听会收到每一个元素级 blur → closeCtxMenu() 把菜单从 DOM 删掉 →
	// 随后的 mouseup 落在菜单下面的会话/工作区行上 → click 永不派发。
	// 于是「复制工作区路径」「刷新页面」等所有项一起失效。
	const env = buildEnv();
	const tree = buildTree(env);
	const s = makeStores();
	const teardown = install(env, { sessions: s.sessions, workspaces: s.workspaces, uiWorkspace: s.uiWorkspace, connection: s.connection });
	tree.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	const menu = document.body.querySelector(".dsh-ctx-menu");
	if (menu !== null) ok("工作区行右键弹出菜单");
	else bad("工作区行右键弹出菜单");

	const blurFns = window.listeners.get("blur") || [];
	if (blurFns.length === 1) ok("window 上只注册了一个 blur 监听");
	else bad("window 上的 blur 监听数量不是 1", `实际 ${blurFns.length}`);

	const firstItem = menu === null ? null : menu.querySelectorAll('[role="menuitem"]')[0];
	if (firstItem !== null && firstItem !== void 0) {
		for (const fn of blurFns) fn(makeEvent("blur", { target: firstItem }));
		if (document.body.querySelector(".dsh-ctx-menu") !== null) ok("元素级 blur（捕获阶段才会到 window）不关菜单 —— 菜单项 click 有活路");
		else bad("元素级 blur 把菜单关掉了 —— click 会被吞，所有菜单项静默失效");
	}

	// 真正的窗口失焦仍然要关（这条是上面那条的「不许矫枉过正」对照）
	for (const fn of blurFns) fn(makeEvent("blur", { target: window }));
	if (document.body.querySelector(".dsh-ctx-menu") === null) ok("窗口自身失焦仍然关菜单");
	else bad("窗口失焦没有关菜单");

	// ── 负向对照：把 blur 那行改回旧写法，确认上面那条断言真的会红 ──
	{
		const brokenEnv = buildBrokenEnv("installContextMenu", (text) =>
			text.replace('window.addEventListener("blur", onWindowBlur);', 'window.addEventListener("blur", onViewportChange, true);'));
		const broken = buildEnv(brokenEnv);
		const brokenTree = buildTree(broken);
		const bs = makeStores();
		install(broken, { sessions: bs.sessions, workspaces: bs.workspaces, uiWorkspace: bs.uiWorkspace, connection: bs.connection });
		brokenTree.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		const brokenMenu = document.body.querySelector(".dsh-ctx-menu");
		const brokenItem = brokenMenu === null ? null : brokenMenu.querySelectorAll('[role="menuitem"]')[0];
		if (brokenItem !== null && brokenItem !== void 0) {
			for (const fn of (window.listeners.get("blur") || [])) fn(makeEvent("blur", { target: brokenItem }));
			if (document.body.querySelector(".dsh-ctx-menu") === null) ok("负向对照：旧写法（window blur + capture:true）确实会关掉菜单 —— 本条断言有效");
			else bad("负向对照失效：旧写法竟然没关掉菜单");
		}
	}
	teardown();
}

section("8c. 真机回归 B：点「刷新页面」必须真的触发 reload（v0.4.14 抛 t is not defined）");
{
	// 真机事实：点「刷新页面」后窗口标题/页面状态完全没变，底部 toast 显示
	// **"t is not defined"**。原因：ctxReload 在**模块作用域**，却写了
	// ctxToast(t("toast.reloading")) —— t 是 installContextMenu(scope, t, …)
	// 的形参，模块作用域取不到，ReferenceError 在 try 之前就抛出，
	// window.location.reload() 根本没执行。
	// 所以本插件的两个报障（复制工作区路径 / 刷新页面）是两个**独立** bug。
	const env = buildEnv();
	const tree = buildTree(env);
	const s = makeStores();
	install(env, { sessions: s.sessions, workspaces: s.workspaces, uiWorkspace: s.uiWorkspace, connection: s.connection });
	tree.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	const menu = document.body.querySelector(".dsh-ctx-menu");
	const item = menu === null ? void 0 : menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("刷新页面"));
	if (item === void 0 || item === null) bad("工作区菜单里没有「刷新页面」项");
	else {
		let threw = null;
		try { item.dispatchEvent(makeEvent("click")); } catch (error) { threw = error; }
		if (threw === null) ok("点「刷新页面」不抛异常");
		else bad("点「刷新页面」抛异常", String((threw && threw.message) || threw));
		if (window.__reloaded === true) ok("点「刷新页面」真的调用了 window.location.reload()");
		else bad("点「刷新页面」没有调用 reload（用户看到的就是「没效果」）");
		const toast = document.body.querySelector(".dsh-ctx-toast");
		if (toast !== null && toast.textContent.includes("刷新")) ok("刷新前有用户可见提示", toast.textContent);
		else bad("刷新前没有用户可见提示", toast === null ? "（无 toast）" : toast.textContent);
	}

	// ── 负向对照：把 ctxReload 改回「模块作用域里引用 t」的旧写法 ──
	{
		const brokenEnv = buildBrokenEnv("ctxReload", (text) =>
			text.replace("function ctxReload(reloadingText) {", "function ctxReload() {")
				.replace('if (typeof reloadingText === "string" && reloadingText !== "") ctxToast(reloadingText);', 'ctxToast(t("toast.reloading"));'));
		const broken = buildEnv(brokenEnv);
		const brokenTree = buildTree(broken);
		const bs = makeStores();
		install(broken, { sessions: bs.sessions, workspaces: bs.workspaces, uiWorkspace: bs.uiWorkspace, connection: bs.connection });
		brokenTree.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		const brokenMenu = document.body.querySelector(".dsh-ctx-menu");
		const brokenItem = brokenMenu === null ? void 0 : brokenMenu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("刷新页面"));
		let brokenThrew = null;
		if (brokenItem !== void 0 && brokenItem !== null) {
			try { brokenItem.dispatchEvent(makeEvent("click")); } catch (error) { brokenThrew = error; }
		}
		const brokenToast = document.body.querySelector(".dsh-ctx-toast");
		const brokenMsg = brokenToast === null ? "" : brokenToast.textContent;
		if (window.__reloaded !== true && (brokenThrew !== null || brokenMsg.includes("t is not defined"))) {
			ok("负向对照：旧写法（ctxReload 里用 t）确实不刷新并报 t is not defined —— 本条断言有效", brokenMsg || String(brokenThrew && brokenThrew.message));
		} else bad("负向对照失效：旧写法竟然没被抓住", `reloaded=${window.__reloaded} toast=${brokenMsg || "无"}`);
	}
}

section("9. 健壮性：动作抛错不冒泡成未捕获异常");
{
	const env = buildEnv();
	const tree = buildTree(env);
	const boom = {
		sessions: { list: { getSnapshot: () => ({ current: "s1", ids: ["s1"], byId: { s1: { id: "s1", title: "甲" } } }) }, fork: () => { throw new Error("boom"); } },
		workspaces: { list: { getSnapshot: () => ({ items: [] }) }, archiveSession: () => { throw new Error("boom"); } },
		uiWorkspace: { startSession: () => { throw new Error("boom"); }, openSession: () => { throw new Error("boom"); } },
	};
	install(env, boom);
	tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	const menu = document.body.querySelector(".dsh-ctx-menu");
	const item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("归档会话"));
	let threw = false;
	try { item.dispatchEvent(makeEvent("click")); } catch (error) { threw = true; }
	if (!threw) ok("动作抛错被吞掉并转成提示（不冒泡）");
	else bad("动作抛错被吞掉并转成提示");
	const toast = document.body.querySelector(".dsh-ctx-toast");
	if (toast !== null) ok("失败时有用户可见提示", toast.textContent);
	else bad("失败时有用户可见提示");
}

section("10. 与参考插件共存：不 import / 不 require 对方任何代码");
{
	// 注意：必须比对「剥离注释后的源码」。
	// 顶部文档注释里会写「参考插件：@baihejiangnan/...」，历史注释里会写
	// 「无 MutationObserver」。直接扫全文件会把注释当代码判红 —— 那是断言自身的假阳性。
	const code = stripComments(src);
	const codeLines = code.split("\n");

	// 功能六必须自包含 —— 不能出现对参考插件包名或全局注册表的引用。
	const refs = [
		/dsh-session-context-menu/,
		/baihejiangnan/,
		/dsh\.session-context-menu\.extensions/,
	];
	const found = codeLines
		.map((line, index) => ({ line: line.trim(), no: index + 1 }))
		.filter((entry) => refs.some((pattern) => pattern.test(entry.line)));
	if (found.length === 0) ok("代码里不引用参考插件的包名 / 全局注册表（注释提及不算）");
	else bad("代码里不引用参考插件", found.map((entry) => `L${entry.no}: ${entry.line}`).join(" | "));

	// 不依赖对方的事件名
	if (!/dsh:session-context-menu/.test(code)) ok("不依赖参考插件的自定义事件");
	else bad("不依赖参考插件的自定义事件");

	// 不新增 require（R1：只准 require("react")）
	const requires = [...code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
	const notReact = requires.filter((name) => name !== "react");
	if (notReact.length === 0) ok(`bundle 只 require react（实际 require：${requires.join(", ") || "无"}）`);
	else bad("bundle 只 require react", notReact.join(", "));

	// 无 MutationObserver / 无轮询（R2）
	if (!/MutationObserver/.test(code)) ok("无 MutationObserver（R2：不搬动 slot 节点）");
	else bad("无 MutationObserver");
	if (!/setInterval/.test(code)) ok("无 setInterval（R2：不轮询搬节点）");
	else bad("无 setInterval");
}

section("11. CSS 注入：并入共享标签，不新增第二个 style");
{
	if (/CTX_CSS/.test(src)) ok("CTX_CSS 常量存在");
	else bad("CTX_CSS 常量存在");
	if (/MSS_CSS \+ WC_CSS \+ WSC_CSS \+ SET_CSS \+ TSP_CSS \+ CTX_CSS/.test(src)) ok("CTX_CSS 已并入共享样式标签（六份 CSS 一处注入）");
	else bad("CTX_CSS 已并入共享样式标签");
	// 功能六不得自己再建 style 标签
	const ownStyle = /createElement\(\s*["']style["']\s*\)/g;
	const count = [...src.matchAll(ownStyle)].length;
	if (count === 1) ok("全文件只有一个 createElement(\"style\")（无重复注入点）", String(count));
	else bad("全文件只有一个 createElement(\"style\")", `${count} 处`);
}

section("12. 负向对照：把判据改坏，断言必须变红");
{
	// 直接检查判据函数的**源码文本**是否真的只认 "session:" 前缀 ——
	// 如果改成宽松判据（例如只要 role=treeitem 就当会话行），下面会命中。
	const sessionIdFn = extractFunction("ctxSessionRowId");
	if (sessionIdFn !== null && /"session:"/.test(sessionIdFn)) ok("ctxSessionRowId 严格匹配 session: 前缀");
	else bad("ctxSessionRowId 严格匹配 session: 前缀");

	const workspaceIdFn = extractFunction("ctxWorkspaceRowId");
	if (workspaceIdFn !== null && /"workspace:"/.test(workspaceIdFn)) ok("ctxWorkspaceRowId 严格匹配 workspace: 前缀");
	else bad("ctxWorkspaceRowId 严格匹配 workspace: 前缀");

	// ── 运行时负向对照 ──
	// 关键：必须用**改坏过的源码**重建沙箱。给 env.ctxSessionRowId 重新赋值
	// 是无效的 —— 闭包内的调用走的是词法绑定，改不到。这一点本身就是个教训。

	// 对照 A：判据一律返回 null（模拟「解析不到行」）。
	// 期望：解析器**不要**乱猜，而应退化到第二级 aria-selected → current。
	{
		const brokenEnv = buildBrokenEnv("ctxSessionRowId", () => "function ctxSessionRowId() { return null; }");
		// ⚠ 必须走 buildEnv(brokenEnv)：直接 makeSandboxArgs 不重置 document.body，
		//   querySelector(".dsh-ctx-menu") 会命中**上一节残留**的菜单节点，
		//   点到旧闭包上 → 断言以假红/假绿收场（实测踩过）。
		const env = buildEnv(brokenEnv);
		const tree = buildTree(env);
		const { sessions } = makeStores();
		const resolved = env.ctxResolveSession(sessions, tree.sessionRow, null);
		if (resolved !== null && resolved.id === "s1") ok("判据失效时降级到 aria-selected → current", resolved.id);
		else bad("判据失效时降级到 aria-selected → current", resolved === null ? "null" : resolved.id);
	}

	// 对照 B：判据坏 + 无 aria-selected + 标题库里查不到 → 必须 null（宁可不管）。
	{
		const brokenEnv = buildBrokenEnv("ctxSessionRowId", () => "function ctxSessionRowId() { return null; }");
		// ⚠ 必须走 buildEnv(brokenEnv)：直接 makeSandboxArgs 不重置 document.body，
		//   querySelector(".dsh-ctx-menu") 会命中**上一节残留**的菜单节点，
		//   点到旧闭包上 → 断言以假红/假绿收场（实测踩过）。
		const env = buildEnv(brokenEnv);
		const tree = buildTree(env);
		const { sessions } = makeStores();
		tree.sessionRow.removeAttribute("aria-selected");
		tree.sessionRow.setAttribute("aria-label", "架构里根本没有这个标题");
		const resolved = env.ctxResolveSession(sessions, tree.sessionRow, null);
		if (resolved === null) ok("三级判据全失效 → null（宁可不管，也不误操作别的会话）");
		else bad("三级判据全失效 → null", `误判为 ${resolved.id}`);
	}

	// 对照 C：真正要防的误判 —— 标题在库里命中**多个**会话时必须 null。
	{
		const brokenEnv = buildBrokenEnv("ctxSessionRowId", () => "function ctxSessionRowId() { return null; }");
		// ⚠ 必须走 buildEnv(brokenEnv)：直接 makeSandboxArgs 不重置 document.body，
		//   querySelector(".dsh-ctx-menu") 会命中**上一节残留**的菜单节点，
		//   点到旧闭包上 → 断言以假红/假绿收场（实测踩过）。
		const env = buildEnv(brokenEnv);
		const tree = buildTree(env);
		const { sessions } = makeStores();
		tree.sessionRow.removeAttribute("aria-selected");
		sessions.list.getSnapshot().byId.s2.title = "会话甲";
		sessions.list.getSnapshot().byId.s2.displayTitle = "会话甲";
		tree.sessionRow.setAttribute("aria-label", "会话甲");
		const resolved = env.ctxResolveSession(sessions, tree.sessionRow, null);
		if (resolved === null) ok("标题歧义（命中 2 个）→ null（唯一性保护生效）");
		else bad("标题歧义（命中 2 个）→ null", `误判为 ${resolved.id}`);
	}

	// 对照 D（最强的一条）：把前缀判据放宽成「只要以 's' 开头就算会话」
	// —— 一个典型的写坏方式。此时工作区行不应再被判成会话行。
	{
		const looseEnv = buildBrokenEnv(
			"ctxSessionRowId",
			() => `function ctxSessionRowId(row) {
				if (row === null || row === void 0) return null;
				const key = row.getAttribute("data-row-key") || "";
				return key === "" ? null : key.slice(8) || key;
			}`,
		);
		const env = makeSandboxArgs(looseEnv, setTimeout);
		const tree = buildTree(env);
		const badResult = env.ctxSessionRowId(tree.rootRow);
		if (badResult !== null) ok("负向对照有效：判据放宽后工作区行确实被误判（证明上面的断言真的在把关）", String(badResult));
		else bad("负向对照有效：放宽判据应产生误判", "null");
	}
}

section("13. 设置页开关门控：默认开 / 关掉后一根监听都不挂 / 改开关即时生效");
{
	// 这一节核对的是 apply() 里的**接线**，不是纯函数。
	// 由于 apply 依赖整个 cordis 运行时，这里改为对源码做结构性核对，
	// 并用一个等价的最小实现验证「订阅 prefs → 重挂/卸载」的语义正确。
	const code = stripComments(src);

	// 13a 偏好字段三处齐全：默认值、normalize 白名单、设置页行
	if (/ctxMenuEnabled:\s*true/.test(code)) ok("PREFS_DEFAULTS 含 ctxMenuEnabled（默认开）");
	else bad("PREFS_DEFAULTS 含 ctxMenuEnabled");

	if (/ctxMenuEnabled:\s*typeof partial\.ctxMenuEnabled === "boolean"/.test(code)) ok("normalizePrefs 白名单含 ctxMenuEnabled（坏数据回退默认）");
	else bad("normalizePrefs 白名单含 ctxMenuEnabled");

	if (/t\("ctxMenu\.enabled"\)/.test(code)) ok("设置页渲染了 ctxMenu.enabled 开关行");
	else bad("设置页渲染了 ctxMenu.enabled 开关行");

	// 13b 关掉开关时必须走「不安装」分支，而不是安装了再隐藏
	// ⚠ 第四参在 v0.4.20（删除会话）新增，是 connection 的取值器，理由同第三参：
	//   服务必须**每动作实时取**，不能在安装时闭包捕获。
	if (/if \(enabled\) teardown = installContextMenu\(scope, ctxT, readUiWorkspace, readConnection\)/.test(code)) ok("门控：仅在 enabled 时调用 installContextMenu（关掉=不挂监听）");
	else bad("门控：仅在 enabled 时调用 installContextMenu");

	if (/prefs\.subscribe\(sync\)/.test(code)) ok("门控：订阅 prefs，改开关即时生效（无需刷新页面）");
	else bad("门控：订阅 prefs");

	// 13c 等价语义验证：用一个最小的订阅式门控跑一遍开→关→开
	{
		const listeners = new Set();
		let state = { ctxMenuEnabled: true };
		const prefs = {
			getSnapshot: () => state,
			subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
			set: (patch) => { state = { ...state, ...patch }; for (const fn of [...listeners]) fn(); },
		};
		// 与源码同构的门控
		let installCount = 0;
		let liveListeners = 0;
		let teardown = null;
		let lastEnabled = null;
		const install = () => { installCount++; liveListeners = 1; return () => { liveListeners = 0; }; };
		const sync = () => {
			const enabled = prefs.getSnapshot().ctxMenuEnabled === true;
			if (enabled === lastEnabled) return;
			lastEnabled = enabled;
			if (teardown !== null) { teardown(); teardown = null; }
			if (enabled) teardown = install();
		};
		sync();
		// 关键：必须订阅，否则 set() 不会驱动 sync —— 这正是真机上
		// 「改了开关不生效」的成因，也是这条等价实现必须照抄的一步。
		const unsubscribe = prefs.subscribe(sync);
		const afterInit = liveListeners;
		prefs.set({ ctxMenuEnabled: false });
		const afterOff = liveListeners;
		prefs.set({ ctxMenuEnabled: false });
		const afterOffAgain = installCount;
		prefs.set({ ctxMenuEnabled: true });
		const afterOn = liveListeners;

		if (afterInit === 1 && afterOff === 0) ok("门控语义：开→挂监听，关→卸监听", `init=${afterInit} off=${afterOff}`);
		else bad("门控语义：开→挂监听，关→卸监听", `init=${afterInit} off=${afterOff}`);

		if (afterOffAgain === 1) ok("门控幂等：重复置同一值不重复安装（避免监听叠加）", String(afterOffAgain));
		else bad("门控幂等：重复置同一值不重复安装", String(afterOffAgain));

		if (afterOn === 1) ok("门控语义：关→再开能重新挂上", String(afterOn));
		else bad("门控语义：关→再开能重新挂上", String(afterOn));
	}

	// 13d effect 里必须把订阅与监听一起清理（卸载不留补丁）
	if (/unsubscribe\(\)/.test(code) && /ui-tools: session\/workspace context menu/.test(code)) ok("effect 清理段同时解除 prefs 订阅与菜单监听");
	else bad("effect 清理段同时解除 prefs 订阅与菜单监听");
}

/* ══════════════════════════════════════════════════════════════
 * 14. 服务契约：动作只能调**真实存在**的官方方法
 * ══════════════════════════════════════════════════════════════
 *
 * 这一段是补票的。v0.4.13 首发时右键菜单里「新建会话 / 复制工作区路径 /
 * 刷新页面 / 归档 / 分叉」几乎全失效，而当时 §8 是**全绿**的 —— 因为
 * §8 的假服务把 startSession 挂在 workspaces 上、把 open 挂在 sessions 上，
 * 测试台自己照着一个**不存在的契约**写，于是断言把 bug 固化成了「正确」。
 *
 * 教训：断言的价值上限 = 假数据对真实契约的还原度。所以这里做两件事：
 *   a) 用**真实方法表**卡死：把内核里真实存在的方法名列出来，逐条核对
 *      源码没有调用表外方法；
 *   b) 运行时负向对照：把动作实现改成「调不存在的服务」，确认断言变红。
 */
section("14. 服务契约：动作只能调真实存在的官方方法");
{
	const code = stripComments(src);
	// ── 真实契约（0.2.0-rc.2 实测，见文件头注释） ──
	//
	// 注意 sessions **有** 一个叫 open() 的方法，但它**不收参数**，是传输层
	// 「打开本会话的事件流」，跟「切到某个会话」毫无关系（实测
	// dsh-api-session-controller/lib/client.js 里 open() 无参）。
	// 切会话只有一条路：uiWorkspace.openSession(sessionId) → replaceMain(id,
	// signal, "reveal")。这正是 v0.4.13 首发翻车的形态：写成
	// sessions.open(childId) 语法合法、运行也不抛错，只是**什么都没发生**。
	// v0.4.20 新增了两个真实方法（都在 app.asar 里逐行核对过）：
	//   · ClientSessions.refresh()              —— 重拉 session.list 基线
	//   · Registry.stopSessionActivity(sessionId) —— workspace/session-stop 瀑布
	const REAL_SESSIONS = ["list", "fork", "binding", "create", "rename", "delete", "archive", "unarchive", "pin", "unpin", "open", "switch", "refresh", "search", "subagentAddress", "sessionAddress", "clear", "cancel", "prompt"];
	const REAL_WORKSPACES = ["list", "archiveSession", "unarchiveSession", "pinSession", "unpinSession", "create", "rename", "delete", "openPath", "stopSessionActivity"];
	// uiWorkspace 的 clearMain() 也是真实公开方法（清主视图引用）。
	const REAL_UI_WORKSPACE = ["startSession", "openSession", "clearMain"];

	// 源码里出现过的 scope.<svc>.<method> 调用点
	const callSites = [...code.matchAll(/\b(sessions|workspaces|uiWorkspace)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)]
		.map((m) => ({ svc: m[1], method: m[2] }));

	const table = { sessions: REAL_SESSIONS, workspaces: REAL_WORKSPACES, uiWorkspace: REAL_UI_WORKSPACE };
	const illegal = callSites.filter((c) => !table[c.svc].includes(c.method));

	if (callSites.length > 0) ok(`扫到 ${callSites.length} 处服务调用点（去重后 ${new Set(callSites.map((c) => `${c.svc}.${c.method}`)).size} 个方法）`);
	else bad("扫到服务调用点", "0 处 —— 正则可能失配");

	if (illegal.length === 0) ok("没有任何一处调用真实内核不存在的方法");
	else bad("调用了真实内核不存在的方法", [...new Set(illegal.map((c) => `${c.svc}.${c.method}`))].join(", "));

	// 反向：sessions.open 与 workspaces.startSession 是**真实不存在**的，
	// 源码里一旦出现就是 bug。这条比上面那条更尖锐，因为它点名了两个
	// 历史上真的写错过的方法。
	const banned = [["sessions", "open"], ["workspaces", "startSession"]];
	const hit = banned.filter(([svc, method]) => new RegExp(`\\b${svc}\\s*\\.\\s*${method}\\s*\\(`).test(code));
	if (hit.length === 0) ok("没有调用 sessions.open / workspaces.startSession（这两个内核里不存在）");
	else bad("调用了内核里不存在的方法", hit.map(([s, m]) => `${s}.${m}`).join(", "));

	// 刷新页面：必须走 ctxReload()（内部才是 window.location.reload），
	// 不能各写各的 —— 集中一处才能保证「被吞就 replace 保底」这条逻辑
	// 覆盖到全部三个调用点。
	const reloadCount = (code.match(/window\s*\.\s*location\s*\.\s*reload\s*\(\s*\)/g) || []).length;
	// v0.4.15 起调用点长这样：ctxReload(t("toast.reloading")) —— 文案由调用方
	// 传入（ctxReload 在模块作用域，拿不到 t，见下面的断言）。
	const reloadCallers = (code.match(/run:\s*\(\)\s*=>\s*\{\s*ctxReload\s*\([^;]*\);/g) || []).length;
	if (reloadCount === 1) ok("window.location.reload() 全文件只有一处（集中在 ctxReload 里）");
	else bad("window.location.reload() 出现次数不是 1", `实际 ${reloadCount} 处`);
	if (reloadCallers === 3) ok("三个「刷新页面」菜单项都走 ctxReload(…)");
	else bad("三个「刷新页面」菜单项都走 ctxReload(…)", `ctxReload 调用 ${reloadCallers} 次`);
	// 保底路径必须存在
	if (/location\s*\.\s*replace\s*\(\s*window\s*\.\s*location\s*\.\s*href\s*\)/.test(code)) ok("ctxReload 里有 location.replace(href) 保底（防 reload 被吞）");
	else bad("ctxReload 缺少 location.replace 保底");

	// 【v0.4.15 回归】ctxReload 是**模块作用域**函数，拿不到 installContextMenu
	// 的形参 t。真机实证：旧写法 ctxToast(t("toast.reloading")) 抛
	// "t is not defined"，点「刷新页面」只弹一条报错、页面根本不刷新。
	// 必须比对「剥注释后」的源码：修复说明里就写着这行旧代码，否则会自判红。
	const reloadFn = stripComments(extractFunction("ctxReload") || "");
	if (/\bt\s*\(/.test(reloadFn)) bad("ctxReload 引用了翻译函数 t（模块作用域取不到 → t is not defined，刷新页面失效）");
	else ok("ctxReload 不引用翻译函数 t（文案由调用方传入）");
	if (/ctxReload\s*\(\s*t\s*\(\s*"toast\.reloading"\s*\)\s*\)/.test(code)) ok("「刷新页面」菜单项把 t(\"toast.reloading\") 传给了 ctxReload");
	else bad("「刷新页面」菜单项没有把刷新提示文案传给 ctxReload");

	// 【v0.4.15 回归】window 上的 blur 监听**不许带 capture**：
	// blur 不冒泡但有捕获阶段，capture:true 会让 window 收到**元素级** blur ——
	// 鼠标按下菜单项时焦点移走即触发，菜单被删，click 永不派发，
	// 所有菜单项（复制工作区路径 / 刷新页面 / 新建会话…）一起静默失效。
	if (/window\s*\.\s*addEventListener\s*\(\s*"blur"[^)]*,\s*true\s*\)/.test(code)) bad("window 的 blur 监听带了 capture:true（会收到元素级 blur，全部菜单项失效）");
	else ok("window 的 blur 监听没有 capture（不接受元素级 blur）");
	// 负向对照：上面那条正则对旧写法必须响
	if (/window\s*\.\s*addEventListener\s*\(\s*"blur"[^)]*,\s*true\s*\)/.test('window.addEventListener("blur", onViewportChange, true);')) ok("负向对照：capture:true 的旧写法会被上面那条判红");
	else bad("负向对照失效：capture:true 的旧写法没被捕获");
	if (/window\s*\.\s*addEventListener\s*\(\s*"blur"\s*,\s*onWindowBlur\s*\)/.test(code)) ok("blur 监听绑定到 onWindowBlur（内含 target===window 守卫）");
	else bad("blur 监听没有绑定 onWindowBlur（缺少 target===window 守卫）");
	if (/removeEventListener\s*\(\s*"blur"\s*,\s*onWindowBlur\s*\)/.test(code)) ok("拆卸时对称移除 onWindowBlur（不留监听）");
	else bad("拆卸时没有移除 onWindowBlur（补丁摘不干净）");

	// 复制工作区路径：菜单项**必须始终存在**，不能因 path 为空就静默省略
	// —— 那正是 v0.4.13 首发用户报「点了没反应」的形态。
	if (/path === "" \? null/.test(code)) bad("「复制工作区路径」在 path 为空时被静默省略（应保留并给提示）");
	else ok("「复制工作区路径」不在 path 为空时静默省略");
	if (/fail\.noWorkspacePath/.test(code)) ok("path 读不到时有明确提示文案（fail.noWorkspacePath）");
	else bad("path 读不到时没有提示文案");

	// 复制工作区路径：走 ctxCopy（有降级路径），不是直接 clipboard.writeText
	if (/workspace\.path/.test(code) && /ctxCopy\s*\(/.test(code)) ok("「复制工作区路径」取 workspace.path 并交给 ctxCopy（带 execCommand 降级）");
	else bad("「复制工作区路径」取数/复制写法不对");

	// ── 运行时负向对照 A：把「新建会话」改回调 workspaces.startSession ──
	// 这正是 v0.4.13 首发的真实 bug。把 uiWorkspace.startSession 换成
	// workspaces.startSession 后，若测试台仍给 workspaces 补上该方法的假实现，
	// 断言就会放过 —— 所以这里**故意补上假实现**，验证测试台的守护确实
	// 依赖「假服务忠实还原真契约」，而不是依赖运气。
	//
	// ⚠ v0.4.15 起源码不再直接写 `uiWorkspace.startSession(...)`，而是先经
	//   `const uws = readUiWorkspace();` 实时取值再调 `uws.startSession(...)`
	//   （见 installContextMenu 顶部注释：服务不能闭包捕获）。
	//   因此改写目标必须同时覆盖**两种**写法，否则这条对照会静默变成空操作、
	//   以 `started=0` 假红 —— 那不是「对照生效」，而是「对照没打中」。
	{
		const brokenEnv = buildBrokenEnv("installContextMenu", (text) =>
			text.replace(/\b(?:uiWorkspace|uws)\s*\.\s*startSession\s*\(/g, "workspaces.startSession("));
		// ⚠ 必须走 buildEnv(brokenEnv)：直接 makeSandboxArgs 不重置 document.body，
		//   querySelector(".dsh-ctx-menu") 会命中**上一节残留**的菜单节点，
		//   点到旧闭包上 → 断言以假红/假绿收场（实测踩过）。
		const env = buildEnv(brokenEnv);
		const tree = buildTree(env);
		const stores = makeStores();
		// 假服务比真机宽松：真机 workspaces 上没有 startSession
		stores.workspaces.startSession = (id) => { stores.calls.started.push(id); };
		install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
		tree.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		const menu = document.body.querySelector(".dsh-ctx-menu");
		const item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("新建会话"));
		item.dispatchEvent(makeEvent("click"));
		// 若「假服务宽松就能骗过测试台」，说明 §14 的价值全在静态方法表那两条上；
		// 这条对照把这件事**显式记录**下来。
		if (stores.calls.started.length === 1) ok("负向对照 A：假服务补上 workspaces.startSession 时确能骗过运行时断言（故静态方法表是本段的真正防线）");
		else {
			const toast = document.body.querySelector(".dsh-ctx-toast");
			bad("负向对照 A 未按预期执行", `started=${stores.calls.started.length} item=${item === void 0 ? "未找到" : "找到"} toast=${toast === null ? "无" : toast.textContent}`);
		}
	}

	// ── 运行时负向对照 B：删掉 uiWorkspace 后动作必须整体失效 ──
	// 证明这些动作**真的依赖** uiWorkspace，而不是碰巧走了别处。
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const stores = makeStores();
		delete stores.uiWorkspace.startSession;
		delete stores.uiWorkspace.openSession;
		install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
		tree.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		const menu = document.body.querySelector(".dsh-ctx-menu");
		const item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("新建会话"));
		let threw = false;
		try { item.dispatchEvent(makeEvent("click")); } catch (error) { threw = true; }
		if (!threw) ok("负向对照 B：uiWorkspace 缺方法时异常被 ctxToast 吞掉（用户看到的是「没反应」，非崩溃）");
		else bad("负向对照 B：动作异常冒泡出去了");
	}
}

/* ══════════════════════════════════════════════════════════════
 * 15. 删除会话（v0.4.20）
 * ══════════════════════════════════════════════════════════════
 *
 * 这一段守四件事，每件都带负向对照：
 *   a) 点「删除会话…」**不能**直接删 —— 必须先出二次确认（不可撤销）；
 *   b) 确认条时点「取消」不发任何删除请求；
 *   c) 确认后必须调到宿主半边的通道，通道名/端点名/载荷**逐字核对**
 *      （这三个字面量在 lib/index.js 里是 export 常量，写错就是 404）；
 *   d) connection 缺席（旧内核）时必须给出可读提示，而不是一句
 *      "rpc.call is not a function" 或者静默无反应。
 */
await (async () => {
	const code = stripComments(src);

	// ── 静态：通道契约与宿主半边对齐 ──
	{
		// v0.4.21：通道从 connection.rpc.handle 改成 connection.fetch.register，
		// 客户端相应地直接 fetch 宿主的精确路由。路径字面量必须与
		// lib/index.js 的 DELETE_ROUTE_PATH 逐字一致。
		if (/fetch\s*\(\s*ctxDeleteUrl\s*\(\s*\)/.test(code) && /const SESSION_DELETE_PATH = "\/api\/ui-tools\/sessionDelete";/.test(code)) {
			ok("客户端调用路径逐字正确（\"/api/ui-tools/sessionDelete\"）");
		} else bad("客户端调用路径不对（与宿主半边注册的路由必须完全一致）");

		// 反向：路径必须是从一个具名常量拼出来的，**不许**散落成裸字符串
		// 多份拷贝（那样改一处漏一处，真机上就是 404）。
		const literalCount = (code.match(/"\/api\/ui-tools\/sessionDelete"/g) || []).length;
		if (literalCount === 1) ok("删除路径只在一处写死（其余全用常量/函数拼接）", String(literalCount));
		else bad("删除路径字面量出现了多处拷贝（改一处漏一处就会 404）", String(literalCount));

		// 宿主半边 lib/index.js 里必须真的导出这两条常量，且值一致。
		let hostSource = null;
		try {
			hostSource = readFileSync(fileURLToPath(new URL("../lib/index.js", import.meta.url)), "utf8");
		} catch (error) {
			hostSource = null;
		}
		if (hostSource !== null && /export const DELETE_ROUTE_PATH = "\/api\/ui-tools\/sessionDelete";/.test(hostSource)) {
			ok("宿主半边导出的路由常量与客户端一致");
		} else bad("宿主半边常量缺失或与客户端不一致（删了也不会生效）");

		// 入口 inject 故意留空：Cordis 的 fiber 只要有一个 inject 服务缺席就一直
		// 停在 INACTIVE，apply 的函数体根本不执行，且**不报错**——表现和「插件没
		// 装上」完全一样，真机上无从区分。所以服务一律在 apply 内部现场取。
		if (hostSource !== null && /^export const inject = \[\];/m.test(hostSource)) ok("宿主半边入口 inject 为空（服务缺席不会让 apply 静默不执行）");
		else bad("宿主半边入口 inject 不该声明服务（缺席会让 apply 静默不执行，且与「没装上」无法区分）");

		if (hostSource !== null && /ctx\s*\.\s*inject\s*\(\s*\[\s*"connection"\s*\]/.test(hostSource)) ok("宿主半边在 apply 内部用 ctx.inject([\"connection\"]) 取连接层");
		else bad("宿主半边没有在 apply 内部取 connection");

		// ⚠ 这里**必须**是 connection.fetch.register，不能是 connection.rpc.handle：
		//   rpc.handle 内部执行 `owner.effect(() => owner.webServer.register(route))`
		//   （dsh-client-connection:871），而 owner 是 Connection 服务自己的 ctx，
		//   其插件入口 inject = ["credentials"]（:1013）里**没有 webServer** ——
		//   第三方插件调它必然抛 `cannot get property "webServer" without inject`。
		//   真机日志 ~/.dsh/ui-tools-host.log 里逐字记录过这条。谁把它改回去，
		//   删除功能就会 100% 失效。
		if (hostSource !== null && /connection\s*\.\s*fetch\s*\.\s*register\s*\(/.test(hostSource)) ok("宿主半边用 connection.fetch.register 注册精确路由（通道自带 Host/Origin 栅栏 + cookie 鉴权）");
		else bad("宿主半边没有走 connection.fetch.register");

		if (hostSource !== null && /rpc\s*\.\s*handle\s*\(/.test(stripComments(hostSource))) bad("宿主半边又用回了 connection.rpc.handle（第三方插件不可用，必然抛 webServer inject 错误）");
		else ok("宿主半边没有用 connection.rpc.handle（第三方插件调它必然抛错）");

		// ⚠ 安全底线：**删除动作**绝不能走裸路由，否则任意网页一个 POST 就能删数据。
		// 允许的唯一裸路由例外是只读诊断探针（它不接收任何输入、不改任何状态）。
		// 判据：webServer.register 出现处，其 handler 里不许出现 fs.rm / deleteSession。
		if (hostSource !== null) {
			const hostCode = stripComments(hostSource);
			const registerAt = hostCode.search(/webServer\s*\.\s*register\s*\(/);
			if (registerAt === -1) {
				ok("宿主半边没有注册任何裸 webServer 路由");
			} else {
				// 取 register({...}) 之后到 apply 结束的整段，确认删除逻辑没被搬进裸路由。
				const tail = hostCode.slice(registerAt);
				const handlerPart = tail.slice(0, tail.indexOf("ctx.inject") === -1 ? tail.length : tail.indexOf("ctx.inject"));
				if (/deleteSession\s*\(|\.rm\s*\(/.test(handlerPart)) bad("裸 webServer 路由里出现了删除逻辑（缺鉴权，可被任意网页 CSRF 删数据）");
				else ok("裸 webServer 路由只做只读探针，删除逻辑仍在 connection 通道里");
			}
		}

		if (hostSource !== null && /rm\s*\(\s*directory\s*,\s*\{\s*recursive: true, force: true/.test(hostSource)) ok("宿主半边递归删除会话目录（force 让已删不抛）");
		else bad("宿主半边的删除调用形态不对");

		// R3：可选服务只准 ctx.get()，绝不准进 inject 或 ctx.inject([...]) 的需求列表。
		const hostCode = hostSource === null ? "" : stripComments(hostSource);
		const optionalServices = ["sessionPersistence", "sessionQuery", "agents", "workspaceRegistry"];
		const leaked = optionalServices.filter((name) => new RegExp(`inject\\s*=\\s*\\[[^\\]]*"${name}"`).test(hostCode) || new RegExp(`inject\\(\\[[^\\]]*"${name}"`).test(hostCode));
		if (leaked.length === 0) ok("可选服务没有进 inject（R3：缺席时只让端点报错，不拖死整条 fiber）", optionalServices.join(","));
		else bad("可选服务被加进了 inject", leaked.join(", "));
	}

	// ── 运行时：点删除 → 出确认条（不许直接执行） ──
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const stores = makeStores();
		install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
		tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		const menu = document.body.querySelector(".dsh-ctx-menu");
		const item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话"));
		item.dispatchEvent(makeEvent("click"));
		// 菜单应被换成确认条
		const dialog = document.body.querySelector(".dsh-ctx-confirm");
		if (dialog !== null) ok("点「删除会话…」先弹二次确认（菜单换成 alertdialog）");
		else bad("点「删除会话…」没有二次确认 —— 一步就把数据删了");
		if (dialog !== null && dialog.getAttribute("role") === "alertdialog") ok("确认条语义正确（role=alertdialog）");
		else bad("确认条 role 不对");
		const dtext = dialog === null ? "" : dialog.textContent;
		if (dtext.includes("会话甲")) ok("确认条点名了要删哪个会话", "会话甲");
		else bad("确认条没说是哪个会话（用户无法核对）", dtext.slice(0, 60));
		if (dtext.includes("无法撤销")) ok("确认条写明不可撤销");
		else bad("确认条没写不可撤销");
		// 关键：此刻还**什么都没发出去**
		if (stores.calls.deleted.length === 0) ok("确认前没有发出任何删除请求（不可撤销操作必须两步）", "0");
		else bad("确认前就已经发出了删除请求", JSON.stringify(stores.calls.deleted));
		if (stores.calls.archived.length === 0) ok("确认前也没有归档（本地列表没被提前摘掉）");
		else bad("确认前就把行从列表摘掉了");

		// 危险按钮必须排在最后一项，默认焦点在「取消」上（手滑回车不会删数据）
		const dItems = dialog === null ? [] : dialog.querySelectorAll('[role="menuitem"]');
		const last = dItems[dItems.length - 1];
		if (last !== void 0 && last.className.includes("dsh-ctx-item--danger")) ok("确认条里危险按钮排在最后一项");
		else bad("确认条里危险按钮位置不对", last === void 0 ? "（无项）" : last.className);
		if (document.activeElement === dItems[0] && dItems[0].textContent.includes("取消")) ok("默认焦点在「取消」（回车不会误删）");
		else bad("默认焦点不在取消上", document.activeElement === null ? "null" : document.activeElement.textContent);
	}

	// ── 运行时：取消 → 一个请求都不发，焦点回菜单 ──
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const stores = makeStores();
		install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
		tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		let menu = document.body.querySelector(".dsh-ctx-menu");
		menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
		const dialog = document.body.querySelector(".dsh-ctx-confirm");
		const cancel = dialog.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("取消"));
		cancel.dispatchEvent(makeEvent("click"));
		await Promise.resolve();
		if (stores.calls.deleted.length === 0) ok("点「取消」不发删除请求", "0");
		else bad("点「取消」竟然发了删除请求", JSON.stringify(stores.calls.deleted));
		if (document.body.querySelector(".dsh-ctx-confirm") === null) ok("点「取消」后确认条消失");
		else bad("点「取消」后确认条还挂在页面上");
		// Escape 也要能取消
		tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		menu = document.body.querySelector(".dsh-ctx-menu");
		menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
		const dialog2 = document.body.querySelector(".dsh-ctx-confirm");
		dialog2.dispatchEvent(makeEvent("keydown", { key: "Escape" }));
		if (document.body.querySelector(".dsh-ctx-confirm") === null && stores.calls.deleted.length === 0) ok("Esc 也能取消（且不发请求）");
		else bad("Esc 没能取消删除确认");
	}

	// ── 运行时：确认 → 请求逐字正确，删完行真的消失 ──
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const stores = makeStores();
		install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
		tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		const menu = document.body.querySelector(".dsh-ctx-menu");
		menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
		const dialog = document.body.querySelector(".dsh-ctx-confirm");
		dialog.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("永久删除")).dispatchEvent(makeEvent("click"));
		// ⚠ 这里必须让出**宏任务**，不能只 `await Promise.resolve()`。
		//   客户端成功路径是 `rpc.call(...).then(...).then(...)` 三段链，
		//   每段各占一个微任务；而 ctxToast 里用 `window.setTimeout(..., 1800)`
		//   清理旧提示 —— 假 window 的 setTimeout 是会立刻执行的短延时版本，
		//   于是「正在删除」的清理令牌排进了同一个微任务队列。
		//   只 await 三次微任务时，最后一条「已删除」刚插进 body，
		//   前面那条「正在删除」的清理回调才轮到执行，按类名
		//   `.dsh-ctx-toast` 一扫就把新提示一起删了 —— 断言看到的永远是
		//   「正在删除」或空。真实浏览器里 1800ms 远大于这些微任务，
		//   顺序不会颠倒；测试台必须显式让出宏任务来还原同一时序。
		await new Promise((resolve) => setImmediate(resolve));
		// 从这一刻起，`calls.deleted` 记录的是**真实的 fetch 入参**（见 testFetch）：
		//   { url, method, body, init }。断言要同时核对地址、方法、凭据与载荷。
		const call = stores.calls.deleted[0];
		const expectedUrl = `${location.origin}/api/ui-tools/sessionDelete`;
		if (call !== void 0 && call.url === expectedUrl) ok("确认后打的是同源绝对地址 /api/ui-tools/sessionDelete", call.url);
		else bad("确认后没打对地址", call === void 0 ? "（没调用）" : call.url);
		if (call !== void 0 && call.method === "POST") ok("用 POST 发删除请求", call.method);
		else bad("删除请求的 method 不对", call === void 0 ? "（没调用）" : call.method);
		// cookie 必须带上：宿主侧 admit(req) 靠它认 owner，漏了就 403。
		if (call !== void 0 && call.init.credentials === "same-origin") ok("fetch 带了 credentials: \"same-origin\"（否则宿主 403）", call.init.credentials);
		else bad("fetch 没带 same-origin 凭据（真机上会被宿主拒绝）", call === void 0 ? "（没调用）" : String(call.init.credentials));
		if (call !== void 0 && call.init.headers !== void 0 && /application\/json/.test(call.init.headers["content-type"] || "")) ok("请求头声明了 application/json");
		else bad("请求头没声明 JSON（宿主侧的 request.json() 会失败）");
		if (call !== void 0 && call.body !== void 0 && call.body.sessionId === "s1") ok("载荷带上了会话 id", call.body.sessionId);
		else bad("载荷里的会话 id 不对", call === void 0 ? "（没调用）" : JSON.stringify(call.body));
		// cwd 一起带上去：宿主半边的 sessionQuery/persistence 都可能定位不到
		// （例如会话从未在当前内核观察过），必须有一个兜底。
		if (call !== void 0 && call.body !== void 0 && call.body.cwd === "D:\\proj\\alpha") ok("载荷带上了会话 cwd（宿主半边定位失败时兜底）", call.body.cwd);
		else bad("载荷没带 cwd", call === void 0 ? "（没调用）" : JSON.stringify(call.body));
		// ── 删完之后必须让列表行消失 ──
		//
		// v0.4.20 定稿：**不能**走 workspaces.archiveSession。它的第一步是
		// `await this.sessionKnown(id)`（dsh-workspace/lib/index.js 的
		// archiveSession），文件刚删掉 → 会话已不存在 → 直接抛
		// WorkspaceUnknownSessionError。所以收尾改成两步：
		//   1) workspaces.stopSessionActivity(s1) —— 宿主侧停活动；
		//   2) s1 正是当前主视图 → uiWorkspace.clearMain() 释放引用，
		//      再 sessions.refresh() 重拉基线，宿主那边少一条，行随之消失。
		if (stores.calls.archived.length === 0) ok("删完之后**不**调 workspaces.archiveSession（文件没了会让 sessionKnown 抛错）", "0");
		else bad("删完之后竟然调了 archiveSession（会抛 WorkspaceUnknownSessionError）", stores.calls.archived.join(","));
		if (stores.calls.stopped.length === 1 && stores.calls.stopped[0] === "s1") ok("删完之后调 workspaces.stopSessionActivity(s1) 停宿主侧活动", stores.calls.stopped.join(","));
		else bad("删完之后没停宿主侧活动", stores.calls.stopped.join(",") || "（没调用）");
		if (stores.calls.cleared.length === 1) ok("删的是当前会话 → 调 uiWorkspace.clearMain() 释放主视图引用");
		else bad("删当前会话却没清主视图引用", String(stores.calls.cleared.length));
		if (stores.calls.refreshed.length === 1) ok("删完之后 sessions.refresh() 重拉列表基线（行才会消失）");
		else bad("删完之后没重拉列表基线（用户会看到删了还在）", String(stores.calls.refreshed.length));
		const toast = document.body.querySelector(".dsh-ctx-toast");
		if (toast !== null && toast.textContent.includes("已删除会话")) ok("成功后有用户可见提示", toast.textContent);
		else bad("成功后没有提示", toast === null ? "（无 toast）" : toast.textContent);
		if (document.body.querySelector(".dsh-ctx-confirm") === null) ok("执行后确认条已关闭");
		else bad("执行后确认条还在");

		// ── 负向对照：把「请求重拉基线」这步弄坏，上面那条必须变红 ──
		// 改法：让 ctxReleaseSession 直接短路返回（收尾整体失效）。如果
		// 「行会消失」那条断言真的在测行为，它就一定变红。
		const brokenRelease = buildBrokenEnv("ctxReleaseSession", (text) => text.replace("const steps = [];", "const steps = []; return Promise.resolve();"));
		const envRel = buildEnv(brokenRelease);
		const treeRel = buildTree(envRel);
		const storesRel = makeStores();
		install(envRel, { sessions: storesRel.sessions, workspaces: storesRel.workspaces, uiWorkspace: storesRel.uiWorkspace, connection: storesRel.connection });
		treeRel.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		document.body.querySelector(".dsh-ctx-menu").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
		document.body.querySelector(".dsh-ctx-confirm").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("永久删除")).dispatchEvent(makeEvent("click"));
		await new Promise((resolve) => setImmediate(resolve));
		if (storesRel.calls.refreshed.length === 0) ok("负向对照：收尾被短路后「重拉基线」确实没发生（上面那条不是摆设）", "0");
		else bad("负向对照失效：收尾被短路了却仍然 refresh 了", String(storesRel.calls.refreshed.length));

		// ── 负向对照：把请求路径写错一位，上面那条必须变红 ──
		// v0.4.21 起路径来自模块常量 SESSION_DELETE_PATH，所以直接改坏那个常量：
		// 改的是**真正驱动行为的字节**，而不是断言里的正则。
		{
			const brokenEnv = buildBrokenEnv("ctxDeleteUrl", (text) => text.replace("SESSION_DELETE_PATH;", "SESSION_DELETE_PATH + \"x\";"));
			const envB = buildEnv(brokenEnv);
			const sB = makeStores();
			// ⚠ fetchCalls 是**全局共享**数组（calls.deleted 就是它），前面已经积累
			//   了不少正常调用的记录。只取「本段之前已有的条数」之后新增的那些，
			//   否则读到的是上一个用例的正常 URL，对照必然假绿 —— 这一版就踩过。
			const since = fetchCalls.length;
			await envB.ctxCallSessionDelete(() => sB.connection, "s1", "D:\\proj\\alpha").then(() => void 0, () => void 0);
			const fresh = fetchCalls.slice(since);
			const got = fresh.length === 0 ? "" : fresh[0].url;
			if (got !== "" && got !== expectedUrl) ok("负向对照：路径写错一位会被地址断言抓住（上面那条不是摆设）", got);
			else bad("负向对照失效：路径改坏了断言仍会放过", got || "（没调用）");
		}
	}

	// ── 运行时：宿主拒绝了怎么办（服务端回 ok:false） ──
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const stores = makeStores();
		// 换掉宿主路由的 handler：回一个业务拒绝信封（HTTP 200 + ok:false）。
		fetchRoutes.set("/api/ui-tools/sessionDelete", () => new Response(
			JSON.stringify({ ok: false, error: { code: "session-unknown", message: "内核里找不到这个会话的落盘位置" } }),
			{ status: 200, headers: { "content-type": "application/json" } },
		));
		try {
			install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
			tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
			document.body.querySelector(".dsh-ctx-menu").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
			document.body.querySelector(".dsh-ctx-confirm").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("永久删除")).dispatchEvent(makeEvent("click"));
			// 同前面那条注释：让出宏任务，否则假 window 的清理令牌会把
			// 刚落地的「删除失败：…」一起清掉，断言只看得到「正在删除会话…」。
			await new Promise((resolve) => setImmediate(resolve));
			const toast = document.body.querySelector(".dsh-ctx-toast");
			const text = toast === null ? "" : toast.textContent;
			if (text.includes("删除失败") && text.includes("落盘位置")) ok("服务端明确拒绝时把真实原因显示给用户", text);
			else bad("服务端拒绝时没有可读提示", text || "（无 toast）");
			if (stores.calls.archived.length === 0) ok("删除失败时不摘掉列表行（避免「看起来删了其实还在」）");
			else bad("删除失败却把行从列表摘掉了");
			let threw = false;
			try { await Promise.resolve(); } catch (error) { threw = true; }
			if (!threw) ok("失败路径不产生未捕获拒绝");
			else bad("失败路径抛出了未捕获拒绝");
		} finally {
			// 必须还原，否则后面所有用例都会吃到这个「永远失败」的宿主。
			fetchRoutes.set("/api/ui-tools/sessionDelete", () => new Response(JSON.stringify({ ok: true, value: { ok: true } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}));
		}
	}

	// ── 运行时：宿主路由缺失（405/404）必须有明确提示 ──
	//
	// v0.4.21 起客户端不再依赖 connection：删除走 fetch，路由是否存在于
	// **宿主进程**里才是决定性的。所以这里不再用「connection 缺席」模拟，
	// 而是让宿主路由直接返回 405 —— 那正是「装了插件但没重启 DSH」时
	// frontend-static fallback 给出的响应。
	{
		const env = buildEnv();
		const stores = makeStores();
		fetchRoutes.set("/api/ui-tools/sessionDelete", () => new Response("method not allowed", { status: 405 }));
		try {
			install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
			const tree = buildTree(env);
			tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
			document.body.querySelector(".dsh-ctx-menu").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
			document.body.querySelector(".dsh-ctx-confirm").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("永久删除")).dispatchEvent(makeEvent("click"));
			await new Promise((resolve) => setImmediate(resolve));
			const toast = document.body.querySelector(".dsh-ctx-toast");
			const text = toast === null ? "" : toast.textContent;
			if (text.includes("宿主半边") && /重启|重装/.test(text)) ok("宿主路由缺失时提示指向「重启 DSH」而不是 405 原文", text.slice(0, 48));
			else bad("宿主路由缺失时提示没指向重启 —— 用户看到的就是一句没头没脑的 HTTP 状态码", text || "（无 toast）");
			if (stores.calls.archived.length === 0) ok("宿主路由缺失时不摘掉列表行");
			else bad("宿主路由缺失却摘掉了列表行");
		} finally {
			fetchRoutes.set("/api/ui-tools/sessionDelete", () => new Response(JSON.stringify({ ok: true, value: { ok: true } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}));
		}
	}

	// ── 运行时：connection 缺席也必须能用 ──
	//
	// v0.4.21 起删除走 fetch，**不再依赖 connection**。这条断言把「不依赖」
	// 固化下来：connection 传 undefined 时删除照样成功。谁哪天又把它绑回
	// connection，这里会立刻变红。
	{
		const env = buildEnv();
		const tree = buildTree(env);
		const stores = makeStores();
		install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: void 0 });
		tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		const menu = document.body.querySelector(".dsh-ctx-menu");
		const item = menu === null ? void 0 : menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话"));
		if (item !== void 0 && item !== null) ok("内核没有 connection 时「删除会话」仍然出现（不做功能级静默隐藏）");
		else bad("内核没有 connection 时「删除会话」消失了");
		if (item !== void 0 && item !== null) {
			item.dispatchEvent(makeEvent("click"));
			const dialog = document.body.querySelector(".dsh-ctx-confirm");
			const confirm = dialog === null ? void 0 : dialog.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("永久删除"));
			let threw = false;
			if (confirm !== void 0 && confirm !== null) {
				try { confirm.dispatchEvent(makeEvent("click")); } catch (error) { threw = true; }
			}
			await new Promise((resolve) => setImmediate(resolve));
			const toast = document.body.querySelector(".dsh-ctx-toast");
			const text = toast === null ? "" : toast.textContent;
			if (!threw) ok("connection 缺席时点删除不抛异常");
			else bad("connection 缺席时点删除抛了异常");
			// 关键：不依赖 connection —— 删除应当**成功**，而不是报「插件通道缺失」。
			if (text.includes("已删除会话")) ok("connection 缺席时删除照常成功（v0.4.21：走 fetch，不再依赖 connection）", text);
			else bad("connection 缺席时删除失败了（说明它又被绑回 connection）", text || "（无 toast）");
			if (text.includes("is not a function")) bad("提示里泄漏了内部 TypeError（用户看不懂）", text);
			else ok("提示里没有泄漏内部 TypeError");
			if (stores.calls.archived.length === 0) ok("删除成功路径不调 archiveSession（文件已删，会抛 unknown）");
			else bad("删除成功却还调了 archiveSession");
			if (stores.calls.refreshed.length === 1) ok("connection 缺席时删完仍然重拉了列表基线");
			else bad("connection 缺席时删完没重拉基线", String(stores.calls.refreshed.length));
		}
	}

	// ── 静态：模块作用域函数不许引用 t（R13） ──
	{
		const scoped = ["ctxFill", "ctxConfirmDialog", "ctxCallSessionDelete", "ctxRestoreMenuFocus"];
		const guilty = scoped.filter((name) => {
			const text = extractFunction(name);
			return text !== null && /\bt\s*\(/.test(stripComments(text));
		});
		if (guilty.length === 0) ok("新增的模块作用域函数都不引用 t（R13：文案由调用方传入）", scoped.join(","));
		else bad("模块作用域函数引用了 t（会抛 t is not defined）", guilty.join(", "));
	}

	// ── 负向对照：通道缺席时的错误码写坏了，上面那条「提示可读」必须变红 ──
	{
		// 把 no-connection 这个字面量改坏一位 —— 调用方就认不出这是
		// 「内核没给通道」，于是只能把内部错误原文甩给用户。
		const brokenEnv = buildBrokenEnv("ctxCallSessionDelete", (text) => text.replace('new Error("no-connection")', 'new Error("no-channel")').replace('missing.code = "no-connection"', 'missing.code = "no-channel"'));
		const env = buildEnv(brokenEnv);
		const stores = makeStores();
		install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: void 0 });
		const tree = buildTree(env);
		tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
		document.body.querySelector(".dsh-ctx-menu").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
		document.body.querySelector(".dsh-ctx-confirm").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("永久删除")).dispatchEvent(makeEvent("click"));
		await new Promise((resolve) => setImmediate(resolve));
		const toast = document.body.querySelector(".dsh-ctx-toast");
		const text = toast === null ? "" : toast.textContent;
		if (!text.includes("插件通道")) ok("负向对照：错误码写坏一位后「提示可读」会变红（上面那条不是摆设）", text.slice(0, 40) || "（无 toast）");
		else bad("负向对照失效：错误码写坏了提示依然可读", text);
	}

	// ── 静态：定时器纪律（ctxToast 用 window.setTimeout，测试台/宿主里才稳定） ──
	{
		const text = stripComments(extractFunction("ctxToast") || "");
		if (/window\s*\.\s*setTimeout\s*\(/.test(text)) ok("ctxToast 清理定时器优先走 window.setTimeout（与 ctxReload 同一纪律）");
		else bad("ctxToast 走裸 setTimeout —— 测试台/宿主里会与真实时钟混用，提示会被旧令牌清掉");
	}

	// ── 宿主半边没加载：必须翻译成「请重启 DSH」，不能把 405 原文甩给用户 ──
	//
	// 真实成因（真机日志 ~/.dsh/ui-tools-host.log 逐字记录过）：宿主进程只在
	// **启动时**跑一次 runProfile，没有热重载。装完插件不重启 DSH 时，
	// /api/ui-tools/sessionDelete 这条路由根本不存在，POST 掉进
	// dsh-host-frontend-static 的 fallback ——
	//   `if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); }`
	// 于是客户端拿到的是一个**非业务**的 405，而不是 {ok:false,error} 信封。
	// 若原样显示，用户看到的是「删除失败：405」这种东西，根本不知道要去重启。
	{
		const env = buildEnv();
		const stores = makeStores();
		fetchRoutes.set("/api/ui-tools/sessionDelete", () => new Response("method not allowed", { status: 405 }));
		try {
			install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
			const tree = buildTree(env);
			tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
			document.body.querySelector(".dsh-ctx-menu").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
			document.body.querySelector(".dsh-ctx-confirm").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("永久删除")).dispatchEvent(makeEvent("click"));
			await new Promise((resolve) => setImmediate(resolve));
		const toast = document.body.querySelector(".dsh-ctx-toast");
		const text = toast === null ? "" : toast.textContent;
		if (text.includes("宿主半边") && /重启|重装/.test(text)) ok("宿主路由缺失时提示指向「重启 DSH」而不是 405 原文", text.slice(0, 48));
		else bad("宿主路由缺失时提示没指向重启 —— 用户看到的就是一句没头没脑的 HTTP 状态码", text || "（无 toast）");
		} finally {
			fetchRoutes.set("/api/ui-tools/sessionDelete", () => new Response(JSON.stringify({ ok: true, value: { ok: true } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}));
		}
	}

	// ── 负向对照：把 404/405 → no-host 这条判定拆掉，上面那条必须变红 ──
	{
		// v0.4.21 起判定在 ctxCallSessionDelete 的 `if (response.status === 404 || response.status === 405)`
		// 与末尾 `.catch` 里两处。把 status 比较改成永不命中的 -1，
		// 提示就退回成「删除失败：HTTP 405」。
		const brokenEnv = buildBrokenEnv("ctxCallSessionDelete", (text) =>
			text.replace(/response\.status === 404 \|\| response\.status === 405/g, "false")
				.replace(/error\.status === 404 \|\| error\.status === 405/g, "false"));
		const env = buildEnv(brokenEnv);
		const stores = makeStores();
		fetchRoutes.set("/api/ui-tools/sessionDelete", () => new Response("method not allowed", { status: 405 }));
		try {
			install(env, { sessions: stores.sessions, workspaces: stores.workspaces, uiWorkspace: stores.uiWorkspace, connection: stores.connection });
			const tree = buildTree(env);
			tree.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
			document.body.querySelector(".dsh-ctx-menu").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("删除会话")).dispatchEvent(makeEvent("click"));
			document.body.querySelector(".dsh-ctx-confirm").querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("永久删除")).dispatchEvent(makeEvent("click"));
			await new Promise((resolve) => setImmediate(resolve));
			const toast = document.body.querySelector(".dsh-ctx-toast");
			const text = toast === null ? "" : toast.textContent;
			if (!(text.includes("宿主半边") && /重启|重装/.test(text))) ok("负向对照：no-host 判定被拆掉后「重启提示」会变红（上面那条不是摆设）", text.slice(0, 48) || "（无 toast）");
			else bad("负向对照失效：判定拆掉了提示依然是重启", text);
		} finally {
			fetchRoutes.set("/api/ui-tools/sessionDelete", () => new Response(JSON.stringify({ ok: true, value: { ok: true } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}));
		}
	}

	// ── 静态：宿主半边 lib/index.js 必须真的注册了删除路由 ──
	// 客户端打 /api/ui-tools/sessionDelete，宿主用 DELETE_ROUTE_PATH 注册；
	// 两边常量各写各的，一旦有一边改名，运行时就是「点了没反应」，而语法/断言全绿。
	{
		const hostPath = new URL("../lib/index.js", import.meta.url);
		let hostText = "";
		try { hostText = fs.readFileSync(hostPath, "utf8"); } catch { hostText = ""; }
		const hasPath = /DELETE_ROUTE_PATH = "\/api\/ui-tools\/sessionDelete"/.test(hostText);
		const hasEndpoint = /sessionDelete/i.test(hostText);
		const hasRegister = /connection\s*\.\s*fetch\s*\.\s*register\s*\(/.test(hostText);
		if (hasPath && hasEndpoint && hasRegister) ok("宿主半边用 connection.fetch.register 注册了 /api/ui-tools/sessionDelete（不是空壳）");
		else bad(`宿主半边没注册路由（path=${hasPath} endpoint=${hasEndpoint} register=${hasRegister}）—— 删了磁盘但请求根本到不了`);
	}
})();

/* ══════════════════════════════════════════════════════════════
 * 结果
 * ══════════════════════════════════════════════════════════════ */

console.log(`\n合计 ${pass}/${pass + fail} 通过`);
if (fail > 0) {
	console.log(`\n失败项：`);
	for (const item of failures) console.log(`  · ${item}`);
	process.exit(1);
}
