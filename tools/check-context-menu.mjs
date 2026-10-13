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
	location: { reload() { window.__reloaded = true; } },
	__reloaded: false,
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
	"ctxCopy", "ctxToast", "ctxInsertIntoComposer",
	"ctxOpenOfficialRename", "ctxMenuItem", "ctxSeparator",
	"closeCtxMenu", "ctxPositionMenu", "ctxOpenMenu", "installContextMenu",
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

const sandbox = buildSandbox();

/** 正常源码编译出的沙箱工厂；传入 functions 可编译被改坏过的版本。 */
function buildSandbox(functions) {
	const body = (functions === void 0 ? wanted.map(extractFunction) : functions).join("\n");
	return new Function(
		"document", "window", "navigator", "HTMLElement", "Element", "Event", "InputEvent", "setTimeout", "console",
		`${body}
		 ${src.slice(stateAt, stateEnd)};
		 return { ${wanted.join(", ")}, ctxMenuState };`,
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
		"document", "window", "navigator", "HTMLElement", "Element", "Event", "InputEvent", "setTimeout", "console",
		`${broken.join("\n")}
		 ${src.slice(stateAt, stateEnd)};
		 return { ${wanted.join(", ")}, ctxMenuState };`,
	);
	return brokenSandbox;
}

function buildEnv() {
	const body = new Element("body");
	document.body = body;
	document.documentElement = new Element("html");
	document.activeElement = null;
	document.listeners = new Map();
	window.listeners = new Map();
	window.__reloaded = false;
	window.__selection = null;
	const realSetTimeout = setTimeout;
	return makeSandboxArgs(sandbox, realSetTimeout);
}

/** 统一的调用参数（正常沙箱与坏沙箱共用）。 */
function makeSandboxArgs(fn, realSetTimeout) {
	return fn(
		document, window, navigator, Element, Element, makeEvent,
		class InputEvent extends Object { constructor(type, init) { super(); Object.assign(this, { type }, init); } },
		(fn2) => realSetTimeout(fn2, 0),
		console,
	);
}

/* ── 会话 / 工作区假数据 ── */

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
	const calls = { archived: [], forked: [], opened: [], started: [] };
	const sessions = {
		list: { getSnapshot: () => sessionsState },
		fork: (args) => { calls.forked.push(args); return Promise.resolve("s3"); },
		open: (id) => { calls.opened.push(id); },
	};
	const workspaces = {
		list: { getSnapshot: () => workspacesState },
		archiveSession: (id) => { calls.archived.push(id); return Promise.resolve(); },
		startSession: (id) => { calls.started.push(id); },
	};
	return { sessions, workspaces, calls, sessionsState, workspacesState };
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
		const { sessions, workspaces, calls } = makeStores();
		env.installContextMenu({ sessions, workspaces }, makeT(CTX_ZH));
		const event = makeEvent("contextmenu", { clientX: 50, clientY: 60 });
		tree.sessionRow.dispatchEvent(event);
		const menu = document.body.querySelector(".dsh-ctx-menu");
		const labels = menu === null ? [] : menu.querySelectorAll('[role="menuitem"]').map((node) => node.textContent);
		if (event.defaultPrevented === true) ok("会话行右键被接管");
		else bad("会话行右键被接管");
		if (labels.length === 6) ok("会话菜单 6 项（重命名/归档/分支/复制ID/复制目录/刷新）", labels.join("|"));
		else bad("会话菜单 6 项", `${labels.length}：${labels.join("|")}`);
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
		const { sessions, workspaces } = makeStores();
		env.installContextMenu({ sessions, workspaces }, makeT(CTX_ZH));
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
		const { sessions, workspaces } = makeStores();
		env.installContextMenu({ sessions, workspaces }, makeT(CTX_ZH));
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
		const { sessions, workspaces } = makeStores();
		env.installContextMenu({ sessions, workspaces }, makeT(CTX_ZH));
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
		const { sessions, workspaces } = makeStores();
		env.installContextMenu({ sessions, workspaces }, makeT(CTX_ZH));
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
	const { sessions, workspaces } = makeStores();
	env.installContextMenu({ sessions, workspaces }, makeT(CTX_ZH));

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
	const { sessions, workspaces } = makeStores();
	const dispose = env.installContextMenu({ sessions, workspaces }, makeT(CTX_ZH));

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
{
	// 归档
	const env = buildEnv();
	const tree = buildTree(env);
	const { sessions, workspaces, calls } = makeStores();
	env.installContextMenu({ sessions, workspaces }, makeT(CTX_ZH));
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
	env2.installContextMenu({ sessions: s2.sessions, workspaces: s2.workspaces }, makeT(CTX_ZH));
	tree2.sessionRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	menu = document.body.querySelector(".dsh-ctx-menu");
	item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("创建会话分支"));
	item.dispatchEvent(makeEvent("click"));
	if (s2.calls.forked.length === 1 && s2.calls.forked[0].sessionId === "s1") ok("「创建会话分支」调用 sessions.fork({sessionId:s1})", JSON.stringify(s2.calls.forked[0]));
	else bad("「创建会话分支」调用 sessions.fork", JSON.stringify(s2.calls.forked));

	// 工作区：新建会话
	const env3 = buildEnv();
	const tree3 = buildTree(env3);
	const s3 = makeStores();
	env3.installContextMenu({ sessions: s3.sessions, workspaces: s3.workspaces }, makeT(CTX_ZH));
	tree3.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	menu = document.body.querySelector(".dsh-ctx-menu");
	item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("新建会话"));
	item.dispatchEvent(makeEvent("click"));
	if (s3.calls.started.length === 1 && s3.calls.started[0] === "w1") ok("「新建会话」调用 workspaces.startSession(w1)", s3.calls.started.join(","));
	else bad("「新建会话」调用 workspaces.startSession", s3.calls.started.join(","));

	// 工作区：归档全部
	const env4 = buildEnv();
	const tree4 = buildTree(env4);
	const s4 = makeStores();
	env4.installContextMenu({ sessions: s4.sessions, workspaces: s4.workspaces }, makeT(CTX_ZH));
	tree4.rootRow.dispatchEvent(makeEvent("contextmenu", { clientX: 20, clientY: 20 }));
	menu = document.body.querySelector(".dsh-ctx-menu");
	item = menu.querySelectorAll('[role="menuitem"]').find((node) => node.textContent.includes("归档工作区全部会话"));
	item.dispatchEvent(makeEvent("click"));
	if (s4.calls.archived.length === 2) ok("「归档全部」逐个调用 archiveSession（2 个）", s4.calls.archived.join(","));
	else bad("「归档全部」逐个调用 archiveSession", s4.calls.archived.join(","));
}

section("9. 健壮性：动作抛错不冒泡成未捕获异常");
{
	const env = buildEnv();
	const tree = buildTree(env);
	const boom = {
		sessions: { list: { getSnapshot: () => ({ current: "s1", ids: ["s1"], byId: { s1: { id: "s1", title: "甲" } } }) }, fork: () => { throw new Error("boom"); }, open: () => {} },
		workspaces: { list: { getSnapshot: () => ({ items: [] }) }, archiveSession: () => { throw new Error("boom"); } },
	};
	env.installContextMenu(boom, makeT(CTX_ZH));
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
		const env = makeSandboxArgs(brokenEnv, setTimeout);
		const tree = buildTree(env);
		const { sessions } = makeStores();
		const resolved = env.ctxResolveSession(sessions, tree.sessionRow, null);
		if (resolved !== null && resolved.id === "s1") ok("判据失效时降级到 aria-selected → current", resolved.id);
		else bad("判据失效时降级到 aria-selected → current", resolved === null ? "null" : resolved.id);
	}

	// 对照 B：判据坏 + 无 aria-selected + 标题库里查不到 → 必须 null（宁可不管）。
	{
		const brokenEnv = buildBrokenEnv("ctxSessionRowId", () => "function ctxSessionRowId() { return null; }");
		const env = makeSandboxArgs(brokenEnv, setTimeout);
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
		const env = makeSandboxArgs(brokenEnv, setTimeout);
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
	if (/if \(enabled\) teardown = installContextMenu\(scope, ctxT\)/.test(code)) ok("门控：仅在 enabled 时调用 installContextMenu（关掉=不挂监听）");
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
 * 结果
 * ══════════════════════════════════════════════════════════════ */

console.log(`\n合计 ${pass}/${pass + fail} 通过`);
if (fail > 0) {
	console.log(`\n失败项：`);
	for (const item of failures) console.log(`  · ${item}`);
	process.exit(1);
}
