/**
 * 功能一「模型双按钮」紧贴听写按钮 —— 选择器回归钉。
 *
 * 为什么需要这个文件：v0.4.10 让座位紧贴官方 input.activity 槽里的听写按钮，
 * 但那个槽的内部结构由**另一个内核包**渲染，且 composer 用 CSS Module（类名带哈希，
 * 每次构建都变）。所以本断言不能靠类名，只能靠：
 *   1) 一个手写的 DOM 骨架，忠实复制 dsh-client-ui-conversation 的 InputBar 里
 *      trailing 那一行的**元素层次与稳定属性**（aria-label / data-*），
 *   2) 提取 lib/client.js 里 MSS_CSS 的真实规则，用 DOM 匹配器核对每条选择器。
 *
 * 它守住的三件事：
 *   · 座位被 margin-left:auto 推到该行最右（贴住听写按钮）
 *   · 座位与听写按钮之间那段来自父级 flex gap 的 12px 被收到 0
 *   · 整段 CSS 不出现哈希类名（内核升级不会让它失效）
 *
 * 骨架来源（内核源码，行号为 0.2.1-alpha.1）：
 *   @deepseek-ai/dsh-client-ui-conversation/lib/client.js:22351-22434
 *     div.trailing > [ div.standardControls > slot right, slot model ]
 *                  > [ div.activity   > slot activity ]
 *                  > [ button.primary ]
 *   @deepseek-ai/dsh-experimental-client-ui-voice-input/lib/client.js:5078-5094
 *     span.triggerAnchor > button[aria-label="开始录音" / "Start recording"]
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

/* ── 1. 提取 MSS_CSS（必须**求值**，不能只读源码文本） ──
 *
 * `src.slice(...)` 拿到的是模板串的**源码**，里面 `${OFFICIAL_TRIG}` 是字面量。
 * 用它做断言会以为选择器叫 `${OFFICIAL_TRIG}`，与浏览器里真正注入的 CSS 不符 ——
 * 官方隐藏规则那条断言就是这么一直红的：断言里造的元素不可能匹配一个
 * 名为 `${OFFICIAL_TRIG}` 的选择器。
 *
 * 正确做法是把这个模板串**当作表达式求值**：把定义在它外层的三个常量按同样的
 * 值注入，运行时才与内核里真实注入的样式一致。这也是本文件能发现
 * 「模板串里出现反引号导致提前闭合」这类事故的原因 —— 那种情况下求值本身会失败。
 */
const src = fs.readFileSync(path.join(root, "lib", "client.js"), "utf8");
const anchor = "const MSS_CSS = `";
const i = src.indexOf(anchor);
if (i < 0) {
	console.error("MSS_CSS 未找到 — 断言文件需要更新");
	process.exit(1);
}
const start = i + anchor.length;
const end = src.indexOf("`.trim();", start);
if (end < 0) {
	console.error("MSS_CSS 结束标记未找到 — 模板串可能被反引号提前闭合");
	process.exit(1);
}
const tplBody = src.slice(start, end);

/** 与 lib/client.js 里同名常量保持**相同的构造方式**（拼接两半、不含引号字符）。 */
const OFFICIAL_TRIG = 'button[aria-haspopup="menu"][aria-label^="选择模型"], button[aria-haspopup="menu"][aria-label^="Select model"]';
const OFFICIAL_TRIG_A = "button[aria-haspopup=" + '"menu"' + "][aria-label^=" + '"选择模型"' + "]";
const OFFICIAL_TRIG_B = "button[aria-haspopup=" + '"menu"' + "][aria-label^=" + '"Select model"' + "]";

let css;
try {
	css = new Function(
		"OFFICIAL_TRIG",
		"OFFICIAL_TRIG_A",
		"OFFICIAL_TRIG_B",
		`return \`${tplBody}\`.trim();`
	)(OFFICIAL_TRIG, OFFICIAL_TRIG_A, OFFICIAL_TRIG_B);
} catch (err) {
	bad("MSS_CSS 模板串可求值", String(err && err.message));
	css = tplBody;
}
if (typeof css === "string" && !css.includes("${")) ok("MSS_CSS 求值后无未展开的 ${...}");
else if (typeof css === "string") bad("MSS_CSS 求值后无未展开的 ${...}", "模板串里仍有未求值的插值点");


section("1. MSS_CSS 自检");
{
	const open = (css.match(/\{/g) || []).length;
	const close = (css.match(/\}/g) || []).length;
	if (open === close && open > 0) ok("花括号平衡", `${open}/${close}`);
	else bad("花括号平衡", `${open}/${close}`);

	// 只在**注释之外**的 CSS 里查哈希类名：注释里可以合法地提到内核类名
	// （本插件的注释就写明了 span.Gyyz9a_triggerAnchor 这类真实结构），
	// 真正要防的是把哈希类名写进**选择器**。
	const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const hashed = cssNoComments.match(/\.[A-Za-z0-9]{5,}_[A-Za-z]/g);
	if (hashed === null) ok("选择器里不出现内核 CSS Module 哈希类名");
	else bad("选择器里不出现内核 CSS Module 哈希类名", hashed.join(", "));
}

/* ── 2. 抽规则表 ── */
/** 极简 CSS 规则解析：把 `sel { decls }` 拆成 [{selectors, decls}]，忽略注释。 */
function parseRules(text) {
	const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
	const out = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m;
	while ((m = re.exec(clean)) !== null) {
		const selectors = m[1]
			.split(",")
			.map((s) => s.trim().replace(/\s+/g, " "))
			.filter(Boolean);
		const decls = {};
		for (const d of m[2].split(";")) {
			const k = d.indexOf(":");
			if (k < 0) continue;
			decls[d.slice(0, k).trim()] = d.slice(k + 1).trim();
		}
		out.push({ selectors, decls });
	}
	return out;
}

const rules = parseRules(css);

/* ── 3. 手写 DOM 骨架（忠实于内核结构） ── */
/**
 * 极简 DOM：只实现本断言需要的部分——元素树、attribute 查询、
 * 与 CSS 选择器里用到的 :has() / 子代 / 相邻兄弟 / 属性选择器匹配。
 * 刻意不引入 jsdom：本仓库零依赖（compat-check 也是手写桩）。
 */
class El {
	constructor(tag, attrs = {}) {
		this.tag = tag;
		this.attrs = { ...attrs };
		this.children = [];
		this.parent = null;
	}

	append(...kids) {
		for (const k of kids) {
			k.parent = this;
			this.children.push(k);
		}
		return this;
	}

	get cls() {
		return (this.attrs.class || "").split(/\s+/).filter(Boolean);
	}

	/** 该元素是否满足一个**复合选择器**（不含组合符）。 */
	matchesSimple(sel) {
		// 依次切出 标签 / #id / .class / [attr] / [attr="val"] / :has(...) / :not(...)
		let rest = sel.trim();
		const tagM = rest.match(/^[a-zA-Z][\w-]*/);
		if (tagM) {
			if (this.tag !== tagM[0].toLowerCase()) return false;
			rest = rest.slice(tagM[0].length);
		}
		while (rest.length > 0) {
			if (rest.startsWith(":has(")) {
				// `:has(` 占 5 个字符（`:` `h` `a` `s` `(`），实参从下标 5 起，
				// 因此跳过「前缀 4 + `(` 1 + 实参 + `)` 1」才是正确的落点。
				// 早期写成 `4 + inner.length + 1` 会少跳一位，留下一个 `)`，
				// 让 `:has(...)` 永远匹配失败（正面断言全红而对照全绿）。
				const inner = extractParen(rest, 4);
				rest = rest.slice(4 + 1 + inner.length + 1);
				if (!this.matchesHas(inner)) return false;
			} else if (rest.startsWith(":not(")) {
				const inner = extractParen(rest, 4);
				rest = rest.slice(4 + 1 + inner.length + 1);
				if (this.matchesSelector(inner)) return false;
			} else if (rest.startsWith("[")) {
				// 属性选择器支持三种写法：存在性 / 精确 / 前缀。
				// 前缀这一种是必需的：lib/client.js 里隐藏官方模型按钮用的正是
				// [aria-label^="选择模型"]，因为 aria-label 是 t() 出来的带后缀文案。
				const close = rest.indexOf("]");
				if (close < 0) return false;
				const body = rest.slice(1, close);
				rest = rest.slice(close + 1);
				const eq = body.indexOf("=");
				if (eq < 0) {
					if (!(body in this.attrs)) return false;
				} else {
					const op = body[eq - 1] === "^" ? "^" : "=";
					const name = body.slice(0, op === "^" ? eq - 1 : eq);
					const want = body.slice(eq + 1).replace(/^["']|["']$/g, "");
					const have = this.attrs[name];
					if (have === void 0) return false;
					if (op === "^" ? !have.startsWith(want) : have !== want) return false;
				}
			} else if (rest.startsWith(".")) {
				const cm = rest.match(/^\.([\w-]+)/);
				if (!cm) return false;
				if (!this.cls.includes(cm[1])) return false;
				rest = rest.slice(cm[0].length);
			} else {
				// 未支持的选择器结构：宁可报「不匹配」也不要静默通过
				return false;
			}
		}
		return true;
	}

	/**
	 * `:has(rel)` 求值——**以 `:has()` 的主体为起点**向后走相对选择器。
	 *
	 * 这是 CSS 的正确语义：`:has(rel)` 里的 rel 永远相对主体求值，
	 * 而不是「在主体子树里找某个满足 rel 的元素」。早期版本按后者写，
	 * 结果 `:has(> div > [data-mss-seat])` 会从子元素出发去匹配
	 * `div > [data-mss-seat]`（要求「本元素的父链」），必然失败。
	 *
	 * 支持的首级组合符：`>`（直接子）、`+`（紧邻后继兄弟）、`~`（任意后继兄弟）、
	 * 无前缀（后代）。后续各级复用 `matchesSelector` 的多级回溯。
	 */
	matchesHas(rel) {
		const t = rel.trim();
		const m = t.match(/^([>+~])\s*/);
		const comb = m === null ? " " : m[1];
		const rest = m === null ? t : t.slice(m[0].length);

		// 首级候选集合
		let candidates;
		if (comb === ">") {
			candidates = this.children;
		} else if (comb === "+" || comb === "~") {
			const p = this.parent;
			if (p === null) return false;
			const idx = p.children.indexOf(this);
			if (idx < 0) return false;
			candidates = comb === "+" ? p.children.slice(idx + 1, idx + 2) : p.children.slice(idx + 1);
		} else {
			// 后代：主体子树里的所有元素（不含自身）
			candidates = [];
			const collect = (n) => {
				for (const c of n.children) {
					candidates.push(c);
					collect(c);
				}
			};
			collect(this);
		}

		for (const cand of candidates) {
			// ① 整个 rest 就落在候选自身上（例如 rest = "div[data-x]"）。
			if (cand.matchesSelector(rest)) return true;

			// ② rest 含着后代/子代关系：把它拆成「候选自身要满足的头段」+
			//    「候选子树里要找的尾段」。例如 `+ div [aria-label="…"]`
			//    里 `+` 选出兄弟 div，而 `div [aria-label=…]` 表示
			//    「该 div 里有 aria-label=… 的元素」。
			const parts = splitTopLevel(rest);
			let splitAt = -1;
			for (let k = 1; k < parts.length; k++) {
				if (parts[k] === ">" || parts[k] === "+" || parts[k] === "~") {
					splitAt = k;
					break;
				}
			}
			if (splitAt > 0) {
				const head = parts.slice(0, splitAt).join(" ");
				const comb2 = parts[splitAt];
				const tail = parts.slice(splitAt + 1).join(" ");
				if (comb2 === ">" && cand.matchesSelector(head)) {
					// 直接子元素里找
					for (const c of cand.children) if (c.matchesSelector(tail)) return true;
				} else if (comb2 === " " && cand.matchesSelector(head) && cand.querySelectorMatches(tail)) {
					return true;
				}
			}

			// ③ rest 本身含空格后代关系，但头段没写死：在候选子树里直接找
			if (rest.includes(" ") && cand.querySelectorMatches(rest)) return true;
		}
		return false;
	}

	/** 在子树里找满足 sel 的任意后代（保留给 `:has` 的多级场景用）。 */
	querySelectorMatches(sel) {
		for (const c of this.children) {
			if (c.matchesSelector(sel)) return true;
			if (c.querySelectorMatches(sel)) return true;
		}
		return false;
	}

	/** 完整选择器（支持空格后代、> 子代、+ 相邻兄弟；按右到左求值）。 */
	matchesSelector(sel) {
		const parts = splitTopLevel(sel);
		// 把组合符并入前一个 token 的开头
		const steps = [];
		for (const p of parts) {
			if (p === ">" || p === "+" || p === "~") {
				steps.push({ comb: p, sel: null });
			} else if (steps.length > 0 && steps[steps.length - 1].sel === null) {
				steps[steps.length - 1].sel = p;
			} else {
				steps.push({ comb: " ", sel: p });
			}
		}
		const last = steps[steps.length - 1];
		if (last === void 0 || last.sel === null) return false;
		if (!this.matchesSimple(last.sel)) return false;

		let node = this;
		/**
		 * 右到左求值。
		 *
		 * 关键索引约定（早期版本在这里错了，导致所有多级选择器恒假）：
		 * `steps[k].comb` 描述的是 **`steps[k-1]` 与 `steps[k]` 之间的关系**，
		 * 因此当循环变量为 `k` 时，要匹配的元素是 `steps[k-1].sel`，
		 * 而不是 `steps[k].sel`（后者正是上一轮已经处理过的那个）。
		 * 所以这里读的是 `steps[k - 1].sel`。
		 */
		for (let k = steps.length - 1; k > 0; k--) {
			const comb = steps[k].comb;
			const s = steps[k - 1].sel;
			if (s === null) return false;
			if (comb === ">") {
				node = node.parent;
				if (node === null || !node.matchesSimple(s)) return false;
			} else if (comb === "+") {
				const p = node.parent;
				if (p === null) return false;
				const idx = p.children.indexOf(node);
				if (idx <= 0) return false;
				node = p.children[idx - 1];
				if (!node.matchesSimple(s)) return false;
			} else {
				// 后代：向上找最近一个满足者
				let cur = node.parent;
				let found = null;
				while (cur !== null) {
					if (cur.matchesSimple(s)) {
						found = cur;
						break;
					}
					cur = cur.parent;
				}
				if (found === null) return false;
				node = found;
			}
		}
		return true;
	}
}

/**
 * 按顶层空白切分选择器，**不拆开括号或方括号内部**。
 *
 * 必需的原因有两类，都真实发生过：
 * 1) `div:has(> [data-mss-seat])` 里的空格是 `:has()` 的实参，不是后代组合符；
 *    朴素的 `split(/\s+/)` 会切成 `["div:has(>", "[data-mss-seat])"]`。
 * 2) `[aria-label="Start recording"]` 的属性值**自身含空格**（英文文案！），
 *    必须让方括号内的空白也受保护，否则会被切成三段。
 */
function splitTopLevel(sel) {
	const out = [];
	let depth = 0;
	let bracket = 0;
	let quote = null;
	let cur = "";
	const flush = () => {
		if (cur.length > 0) out.push(cur);
		cur = "";
	};
	for (const ch of sel.trim()) {
		if (quote !== null) {
			cur += ch;
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") quote = ch;
		else if (ch === "(") depth++;
		else if (ch === ")") depth--;
		else if (ch === "[") bracket++;
		else if (ch === "]") bracket--;
		if (depth === 0 && bracket === 0 && /\s/.test(ch)) {
			flush();
			continue;
		}
		cur += ch;
	}
	flush();
	return out;
}

/** 取出 `name(` 之后到配对右括号的内容。 */
function extractParen(s, openIdx) {
	let depth = 0;
	for (let k = openIdx; k < s.length; k++) {
		if (s[k] === "(") depth++;
		else if (s[k] === ")") {
			depth--;
			if (depth === 0) return s.slice(openIdx + 1, k);
		}
	}
	return "";
}

/** 造出与内核一致的右侧动作区骨架。 */
function buildTrailing(voiceLabel) {
	const trailing = new El("div", { class: "uV2eYG_trailing" });

	const standardControls = new El("div", { class: "uV2eYG_standardControls" });
	const seat = new El("div", { "data-mss-seat": "" });
	const provBtn = new El("button", { "data-mss-btn": "" });
	const modelBtn = new El("button", { "data-mss-btn": "" });
	seat.append(provBtn, modelBtn);

	// 官方模型按钮槽：被本插件 CSS 隐藏，但元素仍在（隐藏不改变布局树位置）。
	// aria-label 给它一个**带后缀**的真实文案，顺带守住「前缀匹配语义没被
	// 写死成精确匹配」这一点。
	const modelSlot = new El("div", { class: "uV2eYG_standardControlsSlot" });
	modelSlot.append(new El("button", { "aria-haspopup": "menu", "aria-label": "选择模型 · DeepSeek" }));
	standardControls.append(seat, modelSlot);

	// 听写按钮：真实 DOM 里它不是 activity 槽 div 的直接子元素，而是包在 span 里
	// （voice-input 用 Tooltip 包 Button，Tooltip 渲染 span.triggerAnchor）。
	const activity = new El("div", { class: "uV2eYG_activity" });
	const anchor = new El("span", { class: "ddpbLW_triggerAnchor" });
	anchor.append(new El("button", { "aria-label": voiceLabel }));
	activity.append(anchor);

	const primary = new El("button", { class: "uV2eYG_primary", "aria-label": "发送" });

	trailing.append(standardControls, activity, primary);
	return { trailing, standardControls, seat, activity, primary };
}

/* ── 4. 断言：选择器命中真实结构（中英两种听写文案） ── */
for (const [lang, label] of [
	["中文", "开始录音"],
	["英文", "Start recording"]
]) {
	section(`2. 选择器命中（${lang} 听写文案 aria-label="${label}"）`);
	const { standardControls, activity } = buildTrailing(label);

	/** 收集所有命中该元素的规则声明（按源码顺序，后者覆盖前者）。 */
	function cascadeFor(el) {
		const out = {};
		for (const r of rules) {
			for (const s of r.selectors) {
				if (el.matchesSelector(s)) Object.assign(out, r.decls);
			}
		}
		return out;
	}

	// 断言口径说明：
	// 本插件的座位（[data-mss-seat]）是 .standardControls 的子元素，而听写按钮在
	// 兄弟容器 .activity 里。纯 CSS 没有「叔侄选择器」，所以真正要做的是：
	//   1) 让**座位的父容器** .standardControls 拿到 margin-left:auto —— 把它连同
	//      座位一起推到 .trailing 的右端，紧靠右侧的 activity / 发送键；
	//   2) 把 .standardControls 的横向 gap 收到 0 —— 消除它与 .activity 之间的
	//      那段 12px 缝（该缝来自 .trailing 的 gap）；
	//   3) 把 .activity 的 margin-left 清 0 —— 防止别的规则把缝又加回来。
	// 因此这里断言这三条**实际生效的元素**，而不是座位自身。
	const scDecl = cascadeFor(standardControls);
	if (scDecl["margin-left"] === "auto") ok("standardControls 获得 margin-left:auto（座位被整体推到最右）");
	else bad("standardControls 获得 margin-left:auto（座位被整体推到最右）", `实得 ${JSON.stringify(scDecl["margin-left"])}`);

	const scGap = scDecl["column-gap"];
	if (scGap === "0") ok("standardControls 的 column-gap 收到 0（横缝消除，座位贴住听写按钮）");
	else bad("standardControls 的 column-gap 收到 0（横缝消除，座位贴住听写按钮）", `实得 ${JSON.stringify(scGap)}`);

	const actDecl = cascadeFor(activity);
	if (actDecl["margin-left"] === "0") ok("activity 的 margin-left 被清 0");
	else bad("activity 的 margin-left 被清 0", `实得 ${JSON.stringify(actDecl["margin-left"])}`);

	// 反面对照：紧贴规则不得误伤「座位不在场」的情形
	const other = new El("div", { class: "uV2eYG_trailing" });
	const sc2 = new El("div", { class: "uV2eYG_standardControls" });
	sc2.append(new El("div", {}));
	const act2 = new El("div", { class: "uV2eYG_activity" });
	act2.append(new El("span", {}));
	other.append(sc2, act2);
	let leaked = false;
	for (const r of rules) {
		for (const s of r.selectors) {
			if (sc2.matchesSelector(s) && r.decls["column-gap"] === "0") leaked = true;
		}
	}
	if (!leaked) ok("无座位时不误伤（column-gap 规则不命中）");
	else bad("无座位时不误伤（column-gap 规则不命中）");

	// 反面对照：听写按钮缺席（用户关掉语音输入）时也不误伤
	const noVoice = buildTrailing(label);
	noVoice.activity.children = []; // activity 槽清空
	const sc3 = noVoice.standardControls;
	let leaked2 = false;
	for (const r of rules) {
		for (const s of r.selectors) {
			if (sc3.matchesSelector(s) && r.decls["column-gap"] === "0") leaked2 = true;
		}
	}
	if (!leaked2) ok("听写按钮缺席时不误伤");
	else bad("听写按钮缺席时不误伤");
}

/* ── 5. 官方隐藏规则仍在（回归钉） ── */
section("3. 原有回归钉未被动到");
{
	const official = new El("button", { "aria-haspopup": "menu", "aria-label": "选择模型 · DeepSeek" });
	let hidden = false;
	for (const r of rules) {
		for (const s of r.selectors) {
			if (official.matchesSelector(s) && r.decls["display"] === "none !important") hidden = true;
		}
	}
	if (hidden) ok("官方模型按钮仍被 CSS 隐藏（display:none !important）");
	else bad("官方模型按钮仍被 CSS 隐藏（display:none !important）");
}

console.log(`\n合计 ${pass}/${pass + fail} 通过`);
if (fail > 0) {
	console.log("失败项：");
	for (const f of failures) console.log(`  · ${f}`);
	process.exit(1);
}
