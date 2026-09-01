#!/usr/bin/env node
/**
 * dsh-ui-tools 真机无头冒烟（v0.4.2 验证用，不属于发布产物）
 *
 * 用 puppeteer-core + 本机已装的 Playwright Chromium 打开正在运行的 DSH Web，
 * 断言 v0.4.2 在当前内核（0.1.2-alpha.3）下：
 *   ① 没有 `Failed to load plugins` / `entry did not activate` 横幅；
 *   ② 插件确实激活（共享 style 标签在位 + 各功能 DOM 标记出现）；
 *   ③ 打开设置中心「DSH UI 工具」页并截图（人工复核视觉）；
 *   ④ 顺带渲染 demo/settings.html 的新旧内核两种状态，核对灰显样式。
 *
 * 用法：node tools/live-smoke.mjs <baseURL+token> [outDir]
 *   baseURL+token 形如 http://127.0.0.1:40112/?token=xxxx（可从 DSH 启动日志或桌面端拿到）
 * 拿不到 URL/token 时脚本会直接跳过（exit 0），不阻塞 npm run check。
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const TARGET = process.argv[2];
const OUT = path.resolve(process.argv[3] || path.join(process.env.TEMP || "/tmp", "dsh-ui-tools-smoke"));
fs.mkdirSync(OUT, { recursive: true });

if (!TARGET) {
	console.log("SKIP 未提供 DSH Web URL+token（node tools/live-smoke.mjs http://127.0.0.1:PORT/?token=...）");
	process.exit(0);
}

const require = createRequire(path.join(homedir(), ".dsh", "profiles", "web", "noop.js"));
const puppeteer = require("puppeteer-core");

const CHROME_CANDIDATES = [
	path.join(homedir(), "AppData", "Local", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe"),
	path.join(homedir(), "AppData", "Local", "ms-playwright", "chromium", "chrome-win64", "chrome.exe")
].filter((row) => fs.existsSync(row));

if (!CHROME_CANDIDATES.length) {
	console.log("SKIP 未找到本机 Chromium（ms-playwright 缓存），无法跑真机冒烟");
	process.exit(0);
}

const MARKERS = {
	styleTag: 'style[data-plugin-css="dsh-ui-tools/styles"]',
	seat: "[data-mss-seat]",
	collapseBar: "[data-wc-collapse-bar]",
	chip: "[data-wsc-chip]",
	settingsRoot: "[data-set-root]",
	modifiedFiles: "[data-mfs-root]"
};

const results = [];
const check = (label, ok, detail = "") => {
	results.push({ label, ok: !!ok, detail });
	console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
	executablePath: CHROME_CANDIDATES[0],
	headless: true,
	args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--allow-file-access-from-files"]
});

try {
	const page = await browser.newPage();
	await page.setViewport({ width: 1440, height: 900 });
	const consoleErrors = [];
	const pageErrors = [];
	const pluginTexts = [];
	page.on("console", (msg) => {
		const text = msg.text();
		if (msg.type() === "error") consoleErrors.push(text);
		if (/dsh-ui-tools|plugin/i.test(text)) pluginTexts.push(`${msg.type()}: ${text.slice(0, 200)}`);
	});
	page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 300)));

	console.log("\n1. 打开运行中的 DSH Web");
	await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60000 });
	await page.waitForSelector("#root, [data-slot], main", { timeout: 45000 }).catch(() => {});
	await new Promise((r) => setTimeout(r, 9000));

	const bannerText = await page.evaluate(() => document.body.innerText.slice(0, 4000));
	check("无 Failed to load plugins 横幅", !/Failed to load plugins/i.test(bannerText));
	check("无 entry did not activate 文案", !/did not activate/i.test(bannerText));
	check("插件共享 style 标签在位（entry 已激活并注册）",
		await page.evaluate((sel) => !!document.querySelector(sel), MARKERS.styleTag));
	check("无 dsh-ui-tools 相关 pageerror", pageErrors.filter((row) => /ui-tools|mfs|alphaFeatures/.test(row)).length === 0,
		pageErrors.slice(0, 3).join(" | ") || "clean");

	await page.screenshot({ path: path.join(OUT, "01-web-home.png"), fullPage: false });

	console.log("\n2. 打开设置中心 → 「DSH UI 工具」页");
	const opened = await page.evaluate(() => {
		// 官方侧边栏设置入口：button 占据 sidebar.settings 槽（诊断实测选择器）
		const hit = document.querySelector('button[data-slot="sidebar.settings"], [data-slot="sidebar.settings"] button');
		if (!hit) return false;
		hit.click();
		return true;
	});
	check("点开设置入口（sidebar.settings）", opened);
	if (opened) {
		await new Promise((r) => setTimeout(r, 2500));
		const navClicked = await page.evaluate(() => {
			// 取「最深」的精确匹配节点：导航项是 button > span，祖先容器同样含该文案
			const rows = [...document.querySelectorAll("button, [role=tab], [role=menuitem], li, a, span, div")]
				.filter((el) => (el.textContent || "").trim() === "DSH UI 工具");
			if (!rows.length) return false;
			const deepest = rows.reduce((best, el) => (best.textContent.length <= el.textContent.length ? best : el), rows[0]);
			(deepest.closest("button, [role=tab], [role=menuitem], li") ?? deepest).click();
			return true;
		});
		check("导航里有并选中「DSH UI 工具」页", navClicked);
		await new Promise((r) => setTimeout(r, 1800));
		const set = await page.evaluate((sel) => {
			const root = document.querySelector(sel);
			if (!root) return null;
			const rows = [...root.querySelectorAll("[data-set-row]")].map((row) => ({
				label: row.querySelector(".set-row-label")?.textContent?.trim() ?? "",
				disabled: row.dataset.setDisabled === "true",
				hint: row.querySelector(".set-row-hint")?.textContent?.trim() ?? ""
			}));
			return { rows };
		}, MARKERS.settingsRoot);
		check("设置页渲染出 [data-set-root]", !!set);
		if (set) {
			check("三个偏好行都在", set.rows.length === 3, set.rows.map((row) => row.label).join(" / "));
			const mfsRow = set.rows.find((row) => row.label.includes("修改的文件"));
			check("当前内核（alpha.3）下功能三开关不灰显", mfsRow && mfsRow.disabled === false, JSON.stringify(mfsRow ?? null));
		}
		await page.screenshot({ path: path.join(OUT, "02-settings-page.png") });
	}
	check("无插件相关 console error", consoleErrors.filter((row) => /ui-tools/.test(row)).length === 0,
		consoleErrors.slice(0, 3).join(" | ") || "clean");

	console.log("\n2b. 功能三在真机上的取数（需要一个有改动记录的历史会话）");
	await page.keyboard.press("Escape");
	await new Promise((r) => setTimeout(r, 1200));

	const findTab = () => page.evaluate(() => {
		const rows = [...document.querySelectorAll("button, [role=tab], [role=button], span, div")]
			.filter((el) => (el.textContent || "").trim() === "修改的文件");
		if (!rows.length) return false;
		const deepest = rows.reduce((best, el) => (best.textContent.length <= el.textContent.length ? best : el), rows[0]);
		(deepest.closest("button, [role=tab], [role=button]") ?? deepest).click();
		return true;
	});

		let tabFound = await findTab();
	if (!tabFound) {
		// 冷启动落在空白新会话（没有 view tab 栏）：用功能二自己的「展开全部」
		// 打开工作区分组，再点进第一条历史会话。
		const expanded = await page.evaluate(() => {
			const bar = document.querySelector("[data-wc-collapse-bar]");
			if (!bar) return "no-bar";
			const btn = [...bar.querySelectorAll("button")].find((el) => (el.getAttribute("title") || el.textContent || "").includes("展开"));
			if (!btn) return "no-btn";
			btn.click();
			return "clicked";
		});
		await new Promise((r) => setTimeout(r, 1800));
		const clickedSession = await page.evaluate(() => {
			// 可靠路径：找到会话行的「操作」按钮（aria-label=会话"..."的操作），
			// 向上取该行容器并点击 → 打开该会话（diag 实测有效）。
			const slot = document.querySelector('[data-slot="sidebar.workspaces"]');
			const op = [...slot.querySelectorAll("[aria-label]")].find((el) => /会话.*操作/.test(el.getAttribute("aria-label") || ""));
			if (!op) return "no-op-btn";
			let row = op.parentElement;
			for (let i = 0; i < 3 && row; i += 1) {
				const t = (row.textContent || "").trim();
				if (t.length > 2 && t.length < 60 && /操作/.test(row.querySelector?.("button")?.getAttribute?.("aria-label") ?? "")) break;
				row = row.parentElement;
			}
			if (!row) return "no-row";
			row.click();
			return (row.textContent || "").trim().slice(0, 26);
		});
		await new Promise((r) => setTimeout(r, 3500));
		tabFound = await findTab();
		check("（前置）展开侧边栏分组并进入历史会话", true, `expand=${expanded} session=${clickedSession}`);
	}
	check("会话头部出现「修改的文件」选项卡（子 fiber 已激活）", tabFound);
	if (tabFound) {
		await new Promise((r) => setTimeout(r, 2500));
		const mfs = await page.evaluate((sel) => {
			const root = document.querySelector(sel);
			if (!root) return null;
			return {
				files: root.querySelectorAll(".mfs-item").length,
				title: root.querySelector(".mfs-title")?.textContent?.trim() ?? "",
				count: root.querySelector(".mfs-count")?.textContent?.trim() ?? "",
				first: root.querySelector(".mfs-file")?.textContent?.trim().slice(0, 60) ?? ""
			};
		}, MARKERS.modifiedFiles);
		check("视图渲染 [data-mfs-root] 并从 chat target 提取到文件", !!mfs, JSON.stringify(mfs ?? null));
		await page.screenshot({ path: path.join(OUT, "05-modified-files-tab.png") });
	}

	console.log("\n3. demo 静态预览（灰显两态）");
	const demo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "demo", "settings.html");
	for (const [name, alpha] of [["03-demo-alpha-kernel", true], ["04-demo-old-kernel", false]]) {
		const dp = await browser.newPage();
		await dp.setViewport({ width: 900, height: 700 });
		await dp.goto("file:///" + demo.replace(/\\/g, "/"), { waitUntil: "load" });
		await dp.evaluate((value) => {
			document.getElementById(value ? "k-new" : "k-old").click();
		}, alpha);
		await new Promise((r) => setTimeout(r, 300));
		const st = await dp.evaluate(() => {
			const row = document.getElementById("row-mfs");
			return {
				disabled: row.dataset.setDisabled,
				toggleDisabled: document.getElementById("mfs-toggle").disabled,
				hintVisible: !document.getElementById("mfs-hint").hidden,
				note: document.getElementById("k-note").textContent.trim()
			};
		});
		check(`${name}: ${alpha ? "新内核" : "旧内核"} 灰显状态正确`,
			alpha ? (st.disabled === "false" && !st.toggleDisabled && !st.hintVisible) : (st.disabled === "true" && st.toggleDisabled && st.hintVisible),
			JSON.stringify(st));
		await dp.screenshot({ path: path.join(OUT, `${name}.png`) });
		await dp.close();
	}

	console.log("\n插件相关 console 片段（参考）");
	for (const row of pluginTexts.slice(0, 8)) console.log("  · " + row);
} finally {
	await browser.close();
}

const failed = results.filter((row) => !row.ok).length;
console.log(`\n合计 ${results.length - failed}/${results.length} 通过 · 截图目录：${OUT}`);
if (failed) process.exitCode = 1;
