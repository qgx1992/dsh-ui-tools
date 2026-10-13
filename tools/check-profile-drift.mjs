#!/usr/bin/env node
/**
 * 断言：本机各 DSH profile 里 dsh-ui-tools 的「声明 / lock / 实际安装」三者一致。
 *
 * 为什么需要这个（v0.4.12 真实事故）：
 *   profile 的 package.json 写 `github:qgx1992/dsh-ui-tools#v0.4.11`，
 *   而 pnpm-lock.yaml 里 specifier 仍是 `#v0.4.10`、解析到旧 commit —— 于是
 *   任何一次 `pnpm install` 都会把插件**回退**到旧版本。更隐蔽的是：真实 GUI 跑的是
 *   profile 里的安装副本，而仓库自检（compat-check）读的永远是仓库 lib/client.js，
 *   于是出现「改了代码、刷新页面、毫无变化」的假象，排查成本极高。
 *
 * 本脚本只读不写：分别读 package.json 声明、pnpm-lock.yaml 的 specifier 与 resolved
 * commit、node_modules 里实际安装的 version。三者不一致 → FAIL。
 *
 * 找不到 ~/.dsh/profiles 时优雅 SKIP（exit 0），便于在别的机器/CI 上跑。
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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

const PKG = "dsh-ui-tools";
const profilesDir = join(homedir(), ".dsh", "profiles");

console.log("profile 安装漂移断言：声明 / lock / 实装 三者须一致\n");

if (!existsSync(profilesDir)) {
	console.log(`SKIP 未找到 ${profilesDir}（本机无 profile 或非 DSH 环境）`);
	process.exit(0);
}

const profiles = readdirSync(profilesDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

if (profiles.length === 0) {
	console.log(`SKIP ${profilesDir} 下没有 profile 目录`);
	process.exit(0);
}

console.log(`扫描 ${profilesDir}（${profiles.length} 个 profile）\n`);

/** 从 github:owner/repo#ref 里取出 ref（tag / commit / branch）。 */
const refOf = (specifier) => {
	if (typeof specifier !== "string") return null;
	const match = specifier.match(/#(.+)$/);
	return match === null ? null : match[1];
};

/** 读 pnpm-lock.yaml（缩进式 YAML，这里用逐行扫描以避免引入 yaml 依赖）。 */
function lockEntries(lockPath) {
	const text = readFileSync(lockPath, "utf8");
	const lines = text.split(/\r?\n/);
	const specifiers = [];
	const versions = new Map();
	let inPkgBlock = false;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		// importers 段的 `dsh-ui-tools:` 键（缩进 6 空格）后跟 specifier / version
		const keyMatch = line.match(/^ {6}["']?dsh-ui-tools["']?:\s*$/);
		if (keyMatch !== null) {
			const specLine = lines[i + 1] ?? "";
			const specMatch = specLine.match(/^\s+specifier:\s*(.+?)\s*$/);
			if (specMatch !== null) specifiers.push(specMatch[1]);
			continue;
		}
		// packages 段的块头 `  dsh-ui-tools@<url>:`（缩进 2 空格）
		if (/^ {2}dsh-ui-tools@/.test(line)) {
			inPkgBlock = true;
			continue;
		}
		if (inPkgBlock) {
			const verMatch = line.match(/^ {4}version:\s*(.+?)\s*$/);
			if (verMatch !== null) {
				// 同一个 resolved url 只记一次
				const urlMatch = lines.slice(0, i).reverse().find((l) => /^ {2}dsh-ui-tools@/.test(l)) ?? "";
				versions.set(urlMatch.trim(), verMatch[1]);
				inPkgBlock = false;
			} else if (/^ {2}\S/.test(line)) {
				inPkgBlock = false;
			}
		}
	}
	return { specifiers, versions };
}

let checkedProfiles = 0;

for (const profile of profiles) {
	const dir = join(profilesDir, profile);
	const pkgPath = join(dir, "package.json");
	const lockPath = join(dir, "pnpm-lock.yaml");
	const instPath = join(dir, "node_modules", PKG, "package.json");

	if (!existsSync(pkgPath)) continue;

	let declared = null;
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		declared = pkg.dependencies?.[PKG] ?? pkg.devDependencies?.[PKG] ?? null;
	} catch (error) {
		bad(`[${profile}] package.json 可解析`, String(error.message));
		continue;
	}

	if (declared === null) {
		// 该 profile 未装本插件：不算失败，也不计入检查
		console.log(`  ----  [${profile}] 未声明 ${PKG}（跳过）`);
		continue;
	}

	checkedProfiles += 1;
	const declaredRef = refOf(declared);

	// ① 实装版本
	let installedVersion = null;
	if (existsSync(instPath)) {
		try {
			installedVersion = JSON.parse(readFileSync(instPath, "utf8")).version ?? null;
		} catch (error) {
			bad(`[${profile}] 安装副本 package.json 可解析`, String(error.message));
		}
	} else {
		bad(`[${profile}] 已声明 ${PKG} 但 node_modules 里没有安装副本`, declared);
	}

	// ② lock 的 specifier 必须与 package.json 声明一致
	if (!existsSync(lockPath)) {
		console.log(`  ----  [${profile}] 无 pnpm-lock.yaml（无法校验 lock 一致性）`);
	} else {
		const { specifiers, versions } = lockEntries(lockPath);
		if (specifiers.length === 0) {
			console.log(`  ----  [${profile}] lock 里没有 ${PKG} 条目（无法校验）`);
		} else {
			const mismatched = specifiers.filter((spec) => spec !== declared);
			if (mismatched.length === 0) {
				ok(`[${profile}] lock specifier 与 package.json 声明一致`, declared);
			} else {
				bad(
					`[${profile}] lock specifier 与 package.json 声明不一致（install 会回退插件）`,
					`package.json = ${declared}；lock = ${[...new Set(mismatched)].join(" | ")}`
				);
			}
		}

		// ③ lock 里 resolved 出的 version 字段若与已装版本不符，说明 lock 被手工改过一半
		const lockVersions = [...new Set([...versions.values()])];
		if (lockVersions.length > 0 && installedVersion !== null) {
			const stale = lockVersions.filter((v) => v !== installedVersion);
			if (stale.length === 0) {
				ok(`[${profile}] lock 记录的版本与实装一致`, `v${installedVersion}`);
			} else {
				bad(
					`[${profile}] lock 记录的版本与实装不一致`,
					`实装 v${installedVersion}；lock 记录 ${stale.map((v) => `v${v}`).join(" | ")}`
				);
			}
		}
	}

	// ④ tag 形式的 ref 不应与实装版本主次号冲突（如 #v0.4.10 却装着 0.4.11）
	if (declaredRef !== null && installedVersion !== null && /^v?\d+\.\d+\.\d+/.test(declaredRef)) {
		const refVersion = declaredRef.replace(/^v/, "");
		if (refVersion !== installedVersion) {
			bad(
				`[${profile}] 声明 ref 指向 v${refVersion}，但实装是 v${installedVersion}`,
				`声明 ${declared}`
			);
		} else {
			ok(`[${profile}] 声明 ref 与实装版本吻合`, `${declaredRef} → v${installedVersion}`);
		}
	}
}

console.log("");
if (checkedProfiles === 0) {
	console.log(`SKIP 没有任何 profile 声明了 ${PKG}`);
	process.exit(0);
}

console.log(`合计 ${pass}/${pass + fail} 通过（检查了 ${checkedProfiles} 个已安装 profile）`);
if (fail > 0) {
	console.log(`\n有 ${fail} 条失败——profile 与仓库代码不一致时，改完代码刷新页面不会生效。`);
	process.exit(1);
}
