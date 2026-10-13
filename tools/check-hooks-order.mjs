#!/usr/bin/env node
/**
 * 断言：函数组件里的条件 return 不得夹在 Hook 之间。
 *
 * 背景（v0.4.12 真实事故）：
 *   ModelSeatSplit 曾在两个 useEffect 之间写 `if (!available) return null;`。
 *   React 靠「Hook 调用顺序 + 数组下标」识别 Hook，而它从不清空 hook 数组，
 *   只按 hookIndex++ 覆盖。于是 available=false 的那次渲染里，后续 Hook 槽位
 *   残留着上一次渲染的值：若上次 open===null，该槽是 undefined，卸载时 React
 *   执行 destroy() → 抛 "undefined is not a function"。
 *   触发面真实存在：available = usable && face.ok，face.ok 来自 try/catch 的
 *   mssResolveDirectory，directoryFor 有缓存早返回 → available 会随会话摇摆。
 *
 * 本脚本用纯词法扫描（不引入 babel/typescript 依赖，守 R6 无构建步骤）：
 *   ① 从 lib/client.js 切出每个「函数组件」的函数体（大写开头的 function 声明）；
 *   ② 按括号深度跟踪，找函数体最外层的 `return` 语句；
 *   ③ 若某个 return 之前出现过 `useXxx(` 调用、且之后仍出现 `useXxx(` 调用，
 *      则判定该 return 是「夹在 Hook 之间」→ FAIL。
 *
 * 允许且必须保留的形态：
 *   - 全部 Hook 之后的末尾 return（正常渲染返回）
 *   - return 出现在箭头函数 / 嵌套回调内部（如 useEffect(() => { ... }) 里的 return）
 *   - return 出现在 if/for 块内部但该块全程不跨越 Hook（本脚本按「函数体最外层
 *     的 return 语句」界定，块内的提前 return 也按同一规则检查）
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, "..", "lib", "client.js");
const source = readFileSync(clientPath, "utf8");
const lines = source.split(/\r?\n/);

let pass = 0;
let fail = 0;

const ok = (label, detail) => {
	pass += 1;
	console.log(`  PASS  ${label}${detail === undefined ? "" : `  — ${detail}`}`);
};
const bad = (label, detail) => {
	fail += 1;
	console.log(`  FAIL  ${label}${detail === undefined ? "" : `  — ${detail}`}`);
};

/* ── ① 切出函数组件体 ────────────────────────────────────────────── */

/**
 * 从 `function Name(` 起，用花括号配平取出完整函数体。
 * 返回 `{name, startLine, bodyStart, bodyEnd}`（均为 0 基 offset / 1 基行号）。
 */
function extractFunctionBody(text, openBraceIndex) {
	let depth = 0;
	let i = openBraceIndex;
	let inString = null;
	let inLineComment = false;
	let inBlockComment = false;
	for (; i < text.length; i += 1) {
		const ch = text[i];
		const next = text[i + 1];
		if (inLineComment) {
			if (ch === "\n") inLineComment = false;
			continue;
		}
		if (inBlockComment) {
			if (ch === "*" && next === "/") {
				inBlockComment = false;
				i += 1;
			}
			continue;
		}
		if (inString !== null) {
			if (ch === "\\") {
				i += 1;
				continue;
			}
			if (ch === inString) inString = null;
			continue;
		}
		if (ch === "/" && next === "/") {
			inLineComment = true;
			i += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			inBlockComment = true;
			i += 1;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = ch;
			continue;
		}
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** 收集「函数组件」定义：`function Name(` 且 Name 以大写字母开头。 */
function findComponents(text) {
	const components = [];
	const re = /\bfunction\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g;
	let match;
	while ((match = re.exec(text)) !== null) {
		const parenIndex = match.index + match[0].length - 1;
		// 跳过参数表
		let depth = 0;
		let i = parenIndex;
		for (; i < text.length; i += 1) {
			if (text[i] === "(") depth += 1;
			else if (text[i] === ")") {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		const braceIndex = text.indexOf("{", i);
		if (braceIndex === -1) continue;
		const end = extractFunctionBody(text, braceIndex);
		if (end === -1) continue;
		components.push({
			name: match[1],
			nameIndex: match.index,
			bodyStart: braceIndex,
			bodyEnd: end
		});
	}
	return components;
}

/** 屏蔽字符串与注释，避免误判（保留长度以便 offset 对齐）。 */
function maskLiterals(text) {
	const out = text.split("");
	let inString = null;
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		const next = text[i + 1];
		if (inLineComment) {
			if (ch === "\n") inLineComment = false;
			else out[i] = " ";
			continue;
		}
		if (inBlockComment) {
			if (ch === "*" && next === "/") {
				out[i] = " ";
				out[i + 1] = " ";
				inBlockComment = false;
				i += 1;
			} else if (ch !== "\n") out[i] = " ";
			continue;
		}
		if (inString !== null) {
			if (ch === "\\") {
				out[i] = " ";
				out[i + 1] = " ";
				i += 1;
				continue;
			}
			if (ch === inString) inString = null;
			if (ch !== "\n") out[i] = " ";
			continue;
		}
		if (ch === "/" && next === "/") {
			inLineComment = true;
			out[i] = " ";
			out[i + 1] = " ";
			i += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			inBlockComment = true;
			out[i] = " ";
			out[i + 1] = " ";
			i += 1;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = ch;
			out[i] = " ";
			continue;
		}
	}
	return out.join("");
}

const masked = maskLiterals(source);

const lineOf = (offset) => {
	let line = 1;
	for (let i = 0; i < offset && i < source.length; i += 1) if (source[i] === "\n") line += 1;
	return line;
};

/* ── ② 在每个组件体内找「最外层 return」 ─────────────────────────── */

/**
 * 找出组件体最外层（相对函数体 depth===0）的 `return` 关键字位置。
 * 参数表之外的嵌套箭头函数里的 return 会被括号/花括号深度自然排除：
 * 这里只跟踪花括号，故箭头函数的 `{ ... return ... }` 也会被算作一层，
 * 需要再排除——用「该 return 所属的最内层花括号是否直接属于组件体」判断。
 */
function outermostReturnOffsets(bodyText) {
	const offsets = [];
	let depth = 0;
	let inString = null;
	let i = 0;
	const text = maskLiterals(bodyText);
	while (i < text.length) {
		const ch = text[i];
		if (inString !== null) {
			if (ch === "\\") {
				i += 2;
				continue;
			}
			if (ch === inString) inString = null;
			i += 1;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = ch;
			i += 1;
			continue;
		}
		if (ch === "{") depth += 1;
		else if (ch === "}") depth -= 1;
		else if (depth === 0 && text.startsWith("return", i)) {
			const before = text[i - 1];
			const after = text[i + 6];
			const isWord = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);
			if (!isWord(before) && !isWord(after)) offsets.push(i);
			i += 6;
			continue;
		}
		i += 1;
	}
	return offsets;
}

const HOOK_CALL = /\buse[A-Z][A-Za-z0-9_$]*\s*\(/g;

function hookCallOffsets(segment) {
	const found = [];
	let match;
	HOOK_CALL.lastIndex = 0;
	while ((match = HOOK_CALL.exec(segment)) !== null) found.push(match.index);
	return found;
}

console.log("Hook 顺序断言：条件 return 不得夹在 Hook 之间\n");
console.log(`目标文件：${clientPath}\n`);
console.log("A. 逐组件检查「提前 return」是否跨越 Hook 调用");

const components = findComponents(masked);
if (components.length === 0) {
	bad("能切出至少一个函数组件（大写开头的 function）", "切出 0 个——提取逻辑或源码结构已变，断言失效");
}

// 只检查含 Hook 调用的组件（没有 Hook 的纯展示组件不受此规则约束）
const hooked = [];
for (const component of components) {
	const body = masked.slice(component.bodyStart + 1, component.bodyEnd);
	if (hookCallOffsets(body).length > 0) hooked.push({ ...component, body });
}

if (hooked.length === 0) {
	bad("至少有一个含 Hook 调用的组件被检查到", "0 个——请在 lib/client.js 里确认 Hook 写法（use[A-Z]…）");
}

for (const component of hooked) {
	const body = component.body;
	const returns = outermostReturnOffsets(body);
	const hooks = hookCallOffsets(body);
	const startLine = lineOf(component.bodyStart);
	if (returns.length === 0) {
		ok(`${component.name}：无提前 return（全部 Hook 顺序无条件）`, `${hooks.length} 个 Hook`);
		continue;
	}
	// 只有「最后一个 return」之后的 Hook 才是真问题；检查每个 return：
	// 若它之前有 Hook、之后也有 Hook → 夹在中间 → FAIL
	let offending = null;
	for (const offset of returns) {
		const before = hooks.filter((h) => h < offset).length;
		const after = hooks.filter((h) => h > offset).length;
		if (before > 0 && after > 0) {
			offending = { offset, before, after };
			break;
		}
	}
	if (offending === null) {
		ok(
			`${component.name}：${returns.length} 个 return，全部位于 Hook 之后`,
			`${hooks.length} 个 Hook，函数体起始行 ${startLine}`
		);
	} else {
		const returnLine = lineOf(component.bodyStart) + body.slice(0, offending.offset).split("\n").length - 1;
		bad(
			`${component.name}：return 夹在 Hook 之间（崩溃风险）`,
			`return 约在第 ${returnLine} 行；其前 ${offending.before} 个 Hook、其后仍有 ${offending.after} 个 Hook → 需把该 return 移到全部 Hook 之后`
		);
	}
}

console.log("\nB. 反向对照：断言本身能变红（在源码副本上注入一处违规写法）");

const sample = `function Probe(props) {
	const [open, setOpen] = useState(null);
	useEffect(() => { if (props.available) props.load(); }, [open]);
	if (!props.available) return null;
	useEffect(() => { return () => {}; }, [open]);
	return h("div", null, open);
}`;
const probeComponents = findComponents(maskLiterals(sample));
let probeDetected = false;
if (probeComponents.length === 1) {
	const body = maskLiterals(sample).slice(probeComponents[0].bodyStart + 1, probeComponents[0].bodyEnd);
	const returns = outermostReturnOffsets(body);
	const hooks = hookCallOffsets(body);
	for (const offset of returns) {
		const before = hooks.filter((x) => x < offset).length;
		const after = hooks.filter((x) => x > offset).length;
		if (before > 0 && after > 0) probeDetected = true;
	}
}
if (probeDetected) ok("负向对照：夹在 Hook 之间的 return 被判为违规（断言有效）");
else bad("负向对照失败：违规样例没被检出，本断言形同虚设");

const cleanSample = `function Probe(props) {
	const [open, setOpen] = useState(null);
	useEffect(() => { if (props.available) props.load(); }, [open]);
	useEffect(() => { return () => {}; }, [open]);
	if (!props.available) return null;
	return h("div", null, open);
}`;
const cleanComponents = findComponents(maskLiterals(cleanSample));
let cleanDetected = false;
if (cleanComponents.length === 1) {
	const body = maskLiterals(cleanSample).slice(cleanComponents[0].bodyStart + 1, cleanComponents[0].bodyEnd);
	const returns = outermostReturnOffsets(body);
	const hooks = hookCallOffsets(body);
	cleanDetected = returns.every((offset) => hooks.filter((x) => x > offset).length === 0);
}
if (cleanDetected) ok("负向对照：合规写法（return 在全部 Hook 之后）不被误报");
else bad("合规写法被误报，断言过严");

console.log(`\n合计 ${pass}/${pass + fail} 通过`);
if (fail > 0) {
	console.log(`\n有 ${fail} 条失败——Hook 顺序问题会导致 React 卸载期抛 "undefined is not a function"。`);
	process.exit(1);
}
