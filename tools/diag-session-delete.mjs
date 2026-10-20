/**
 * 删除会话链路的真机诊断脚本。
 *
 * 用法：node diag-delete.mjs [port]
 * 不传端口时自动从监听端口里找 DSH Web GUI。
 *
 * 它按顺序回答四个问题：
 *   1. 宿主半边 lib/index.js 到底执行了没有？（探针路由）
 *   2. 如果执行了，connection 通道注册成功没有？（探针回报的 channelState）
 *   3. 删除通道本身通不通？（发一个不存在的 sessionId，看是不是业务拒答）
 *   4. 安全闸门还在不在？（不带 cookie / 跨站 Origin 必须被拒）
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import http from "node:http";

/* ── 找端口 ── */
function guessPort() {
  if (process.argv[2]) return process.argv[2];
  if (process.env.PROBE_PORT) return process.env.PROBE_PORT;
  return null;
}

/* ── 自签 cookie ── */
const credText = fs.readFileSync(path.join(os.homedir(), ".dsh", ".credentials.yaml"), "utf8");
const secretBlock = credText.split("client-connection/browser-session:")[1] || "";
const secretMatch = secretBlock.match(/secret:\s*(\S+)/);
const secret = Buffer.from(secretMatch[1].trim().replace(/^["']|["']$/g, ""), "base64url");

function makeCookie(authority) {
  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const cookieName = "dsh-auth-" + crypto.createHash("sha256").update(authority).digest("base64url");
  const now = Date.now();
  const body = b64u(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 3600_000 }));
  const sig = b64u(crypto.createHmac("sha256", secret).update(body).digest());
  return `${cookieName}=v1.${body}.${sig}`;
}

function rawRequest(method, port, urlPath, headers = {}, body = null) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", (e) => resolve({ status: 0, headers: {}, text: `NETERR ${e.code || e.message}` }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, headers: {}, text: "TIMEOUT" }); });
    if (body !== null) req.write(body);
    req.end();
  });
}

const port = guessPort();
if (!port) {
  console.log("用法：node diag-delete.mjs <port>");
  process.exit(1);
}
const authority = `127.0.0.1:${port}`;
const cookie = makeCookie(authority);

console.log(`=== 诊断目标 http://${authority} ===\n`);

/* ── 0. cookie 是否有效 ── */
const home = await rawRequest("GET", port, "/", { cookie });
console.log(`[0] GET / 带自签 cookie -> ${home.status} ${home.status === 200 ? "(cookie 有效)" : "(cookie 无效，后面的结论都不可信)"}\n`);

/* ── 1. 探针：宿主半边执行了没有 ── */
const probe = await rawRequest("GET", port, "/__dsh_ui_tools_probe", { cookie });
console.log(`[1] GET /__dsh_ui_tools_probe -> ${probe.status}`);
console.log(`    body: ${probe.text.slice(0, 300)}`);
if (probe.status === 200) {
  console.log("    ✅ 宿主半边**执行了** apply()");
  console.log(`    → 删除通道状态：${probe.text.includes("registered") ? "registered（已注册，问题在别处）" : "未注册（看探针里的原因）"}`);
} else {
  console.log("    ❌ 宿主半边**没有执行** —— 整个 lib/index.js 没被 loader 装上");
  console.log("    → 这不是「重启没生效」，而是 insert 条目根本没进 loader，或加载失败");
}
console.log();

/* ── 2. 删除通道：发一个绝不存在的 sessionId（只读探针，不删任何真实数据） ── */
//
// v0.4.21：通道从 connection.rpc 的 "/ui-tools" 改成了 connection.fetch 的
// 精确路由 /api/ui-tools/sessionDelete。payload 也不再是 RPC 信封，而是裸
// { sessionId, cwd }（与 lib/client.js 的 ctxCallSessionDelete 完全一致）。
const bogus = "session-DIAGNOSTIC-NOT-EXIST-0000";
const DELETE_PATH = "/api/ui-tools/sessionDelete";
const envelope = JSON.stringify({ sessionId: bogus, cwd: "" });
const del = await rawRequest("POST", port, DELETE_PATH, {
  "content-type": "application/json",
  cookie,
  origin: `http://${authority}`
}, envelope);
console.log(`[2] POST ${DELETE_PATH}（不存在的会话）-> ${del.status}`);
console.log(`    body: ${del.text.slice(0, 400)}`);
if (del.status === 200) {
  // 200 且 ok:false = 通道全通，只是这个 sessionId 不存在（正是期望结果）。
  let parsed = null;
  try { parsed = JSON.parse(del.text); } catch { parsed = null; }
  if (parsed !== null && parsed.ok === false) console.log("    ✅ 通道通了（路由存在、鉴权通过；ok:false 是「会话不存在」的预期业务拒绝）");
  else if (parsed !== null && parsed.ok === true) console.log("    ✅ 通道通了（ok:true）");
  else console.log("    ⚠ 200 但响应不是预期的 {ok:...} 信封");
} else if (del.status === 405) console.log("    ❌ 405 = 掉进 frontend-static 兜底，路由不存在（宿主半边没加载 / 没重启）");
else console.log(`    ⚠ 状态 ${del.status}`);
console.log();

/* ── 3. 安全闸门 ── */
const noCookie = await rawRequest("POST", port, DELETE_PATH, { "content-type": "application/json" }, envelope);
console.log(`[3] 不带 cookie -> ${noCookie.status}（期望 401；若是 405 说明路由都没挂）`);
const evil = await rawRequest("POST", port, DELETE_PATH, {
  "content-type": "application/json", cookie, origin: "http://evil.example.com"
}, envelope);
console.log(`[4] 带 evil Origin -> ${evil.status}（期望 403）`);

/* ── 4. 对照组 ── */
const ctrl = await rawRequest("POST", port, "/no-such-channel-xyz/x", { "content-type": "application/json", cookie }, "{}");
console.log(`\n[5] 对照：POST /no-such-channel-xyz/x -> ${ctrl.status}（应当与 [2] 区分开，否则说明一切都是兜底的 405）`);
