/**
 * dsh-ui-tools 的宿主（host）半边。
 *
 * 浏览器那半边（lib/client.js）负责右键菜单与交互；这里只做一件浏览器做不到的事：
 * 真正把会话从磁盘上删掉。内核没有 `session/delete` 这类 RPC（`UNARY_ROUTES`
 * 是 dsh-host-apiproxy 里的静态表，插件无法往里加路由），所以本插件借用
 * `connection` 服务自建一条带鉴权的插件通道：
 *
 *   scope.connection.rpc.handle("/ui-tools", handler)
 *   → 路由挂到 POST /ui-tools/<endpoint>
 *
 * 之所以走 connection 而不是 `webServer.register()`，是因为 connection 的通道注册
 * 自带三道闸门（见 @deepseek-ai/dsh-client-connection/lib/index.js）：
 *   1. Host / Origin 浏览器信任栅栏（拒绝 DNS rebinding 与跨站请求）；
 *   2. 浏览器 Cookie 鉴权（未认证 → 401）；
 *   3. 只把 owner 身份的 Peer 交给 handler（非 owner → 403）。
 * 直接用 webServer 注册裸路由的话，这些全要自己写，写漏一个就是「任意网页
 * 发个 POST 就能删掉用户全部会话」。
 *
 * 各内核服务的获取方式：
 *   - connection        → 进 inject（它一定在，且缺了这条通道就无从谈起）；
 *   - sessionPersistence / sessionQuery / agents / workspaceRegistry
 *                       → 一律 ctx.get() 可选获取，缺席时端点返回 501 由浏览器
 *                         半边降级成「本内核不支持删除」，绝不加进入口 inject
 *                         （AGENT.md R3：加进去会让整条 fiber 卡在 pending）。
 */

import fsMod from "node:fs";

/** 插件名，与 cordis.patch.yml 里的 id 无关，仅用于诊断。 */
export const name = "ui-tools";
/**
 * 诊断探针路径。挂上说明宿主确实执行了本文件；拿不到说明整个 host 半边
 * 没被装配（而不是 connection 依赖没满足）。生产中它只回一行纯文本。
 */
const PROBE_PATH = "/__dsh_ui_tools_probe";
/**
 * **入口不声明任何 inject。**
 *
 * 这是踩过的坑：Cordis 的 fiber 只要有一个 inject 服务缺席就一直停在
 * INACTIVE，`apply` 的函数体根本不执行，**不报错也不提示**。桌面端的
 * `connection` 由 `dsh-client-connection` 提供，理论上有；但真正要命的是
 * 这种「静默不加载」的表现和「插件没装上」完全一样，无从区分。
 *
 * 所以入口 inject 保持空数组，所有服务（含 connection）一律在 apply 内部
 * 用 `ctx.inject([...])` / `ctx.get()` 现场取——拿不到就降级或报错，
 * 至少 apply 一定跑得到，探针一定能挂上。
 */
export const inject = [];
/**
 * 删除会话的精确路由路径。
 *
 * 挂在 `/api` 之下，因为 `connection.fetch` 的路由只在 `/api` 这条 prefix
 * 路由上被 `createSharedFetchHandler` 按 pathname 精确命中
 * （dsh-client-connection:820-839，`API_PATH = "/api"` 见 :14）。
 * `assertFetchRoute` 要求 `endpointFromPath("/api", path)` 有效，即必须以 `/api/` 开头。
 */
export const DELETE_ROUTE_PATH = "/api/ui-tools/sessionDelete";
/** 自建通道名，保留给将来（客户端目前用 DELETE_ROUTE_PATH 直接 POST）。 */
export const RPC_CHANNEL = "/ui-tools";
/** 删除会话的端点名。 */
export const SESSION_DELETE_ENDPOINT = "sessionDelete";

/**
 * 造一个 JSON 响应。内核的 fetch 路由要求返回标准 `Response`。
 * @param status HTTP 状态码。
 * @param body 会被 JSON 序列化的对象。
 * @returns 标准 Response。
 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/**
 * 内核会话 id 的合法形态。当前内核发的是 `session-<uuid>`，但历史格式与
 * 迁移格式可能更长，这里只做「安全字符 + 长度」的白名单，防止把怪异值
 * 拼进文件路径。
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

/**
 * 诊断日志：把 apply 的执行轨迹写进 ~/.dsh/ui-tools-host.log。
 *
 * 为什么需要它：宿主进程的 stdout/stderr 是管道，插件加载失败的诊断只出现在
 * 那里，用户和开发者都看不到。写文件是唯一能在真机上拿到证据的办法。
 * 任何写日志失败都必须被吞掉 —— 诊断绝不能反过来弄坏插件。
 * @param line 一行诊断文本。
 */
function diagLog(line) {
  try {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    if (home === "") return;
    fsMod.appendFileSync(`${home}\\.dsh\\ui-tools-host.log`, `[${new Date().toISOString()}] pid=${process.pid} ${line}\n`, "utf8");
  } catch {
    /* 诊断失败不能影响插件 */
  }
}

// 模块被 import 的那一刻就留下痕迹：能区分「模块根本没被 import」与
// 「import 了但 apply 没跑」——这两者的修法完全不同。
diagLog("module evaluated");

/**
 * 读取一个可选的宿主服务，任何异常都吃掉返回 undefined。
 * @param ctx 当前 fiber 的上下文。
 * @param service 服务名。
 * @returns 服务实例或 undefined。
 */
function optionalService(ctx, service) {
  try {
    return ctx.get(service);
  } catch {
    return undefined;
  }
}

/**
 * 释放 sessionQuery 给出的观察租约。内核的观察对象实现了 `Symbol.dispose`，
 * 不释放会让冷会话的快照一直钉在缓存里。
 * @param observation 任意可能带 `Symbol.dispose` 的对象。
 */
function disposeObservation(observation) {
  if (observation === null || typeof observation !== "object") return;
  const symbol = Symbol.dispose;
  const disposer = observation[symbol];
  if (typeof disposer !== "function") return;
  try {
    disposer.call(observation);
  } catch {
    /* 释放失败不影响删除结果 */
  }
}

/**
 * 问内核要一个会话的落盘目录。三级降级：
 *   1. `sessionQuery.observeSession(id, { projectionMode: "none" })` 拿 header.cwd
 *      （不激活 Agent，也不跑投影器，最便宜）；
 *   2. `sessionPersistence.list()` 里按 id 找 header（老内核没有 sessionQuery 时）；
 *   3. 都拿不到时用会话摘要里带的 cwd 兜底（客户端会把它一起传上来）。
 * @param ctx 宿主上下文。
 * @param sessionId 会话 id。
 * @param fallbackCwd 客户端提供的 cwd（可能是空串）。
 * @param signal 请求级取消信号。
 * @returns `{ cwd, source }`，cwd 为 undefined 表示无从定位。
 */
async function resolveSessionCwd(ctx, sessionId, fallbackCwd, signal) {
  const query = optionalService(ctx, "sessionQuery");
  if (query !== undefined && typeof query.observeSession === "function") {
    let observation;
    try {
      observation = await query.observeSession(sessionId, {
        ...(signal === undefined ? {} : { signal }),
        projectionMode: "none"
      });
      const cwd = observation?.header?.cwd;
      if (typeof cwd === "string" && cwd !== "") return { cwd, source: "sessionQuery" };
    } catch {
      /* 落到下一级 */
    } finally {
      disposeObservation(observation);
    }
  }
  const persistence = optionalService(ctx, "sessionPersistence");
  if (persistence !== undefined && typeof persistence.list === "function") {
    try {
      const stored = await persistence.list({ ...(signal === undefined ? {} : { signal }) });
      for (const entry of stored ?? []) {
        const header = entry?.header;
        if (header?.id !== sessionId) continue;
        if (typeof header.cwd === "string" && header.cwd !== "") return { cwd: header.cwd, source: "persistenceList" };
      }
    } catch {
      /* 落到下一级 */
    }
  }
  if (typeof fallbackCwd === "string" && fallbackCwd !== "") return { cwd: fallbackCwd, source: "client" };
  return { cwd: undefined, source: "none" };
}

/**
 * 停掉这个会话上还在跑的活。先问 Agent 自己注销（CancelEvent 的 kind 用内核的
 * `{ kind: "user" }`），再让工作区记账知道这个会话已经停摆（内核官方归档路径
 * 也是发 `workspace/session-stop`）。两件事都是尽力而为：删磁盘才是目的。
 * @param ctx 宿主上下文。
 * @param sessionId 会话 id。
 */
async function stopSessionActivity(ctx, sessionId) {
  const agents = optionalService(ctx, "agents");
  if (agents !== undefined && typeof agents.get === "function") {
    try {
      const agent = agents.get(sessionId);
      if (agent !== undefined && agent !== null && typeof agent.cancel === "function") {
        agent.cancel({ kind: "user" }, { keepInbox: true });
      }
    } catch {
      /* 停不下来也要继续删 */
    }
  }
  const registry = optionalService(ctx, "workspaceRegistry");
  if (registry !== undefined && typeof registry.stopSessionActivity === "function") {
    try {
      await registry.stopSessionActivity(sessionId);
    } catch {
      /* 同上 */
    }
  }
}

/**
 * 把会话 id 从所有工作区的记账数组里摘掉。归档（archiveSession）只动
 * `archivedSessionIds`，`sessionIds` 里的槽位仍会留着——而文件已经删了，
 * 那个槽位就永远解析不出摘要，成了死账。这里在删完文件后顺手清掉。
 * @param ctx 宿主上下文。
 * @param sessionId 会话 id。
 * @returns 被清掉记账的工作区数量。
 */
async function detachFromWorkspaces(ctx, sessionId) {
  const registry = optionalService(ctx, "workspaceRegistry");
  if (registry === undefined || typeof registry.list !== "function") return 0;
  let detached = 0;
  let entities;
  try {
    entities = await registry.list();
  } catch {
    return 0;
  }
  for (const entity of entities ?? []) {
    try {
      const ids = entity?.sessionIds;
      if (!Array.isArray(ids) || !ids.includes(sessionId)) continue;
      if (typeof entity.detachSession !== "function") continue;
      await entity.detachSession(sessionId);
      detached += 1;
    } catch {
      /* 单个工作区失败不影响其他 */
    }
  }
  return detached;
}

/**
 * 删除一个会话：停活 → 定位落盘目录 → 递归删目录 → 清工作区记账。
 *
 * 为什么删整个会话目录而不是单独删日志文件：会话目录（
 * `<sessionRoot>/<projectKey>/<sessionId>/`）是这个会话独占的位置，
 * 除当前代日志（session.v4.jsonl.zstd）外还可能躺着旧代日志与附件，
 * 只删日志会留下孤儿文件，而删目录一次性清干净。
 * @param ctx 宿主上下文。
 * @param sessionId 会话 id。
 * @param fallbackCwd 客户端提供的 cwd。
 * @param signal 请求级取消信号。
 * @returns 结果对象（可直接 JSON 序列化）。
 */
async function deleteSession(ctx, sessionId, fallbackCwd, signal) {
  const persistence = optionalService(ctx, "sessionPersistence");
  if (persistence === undefined || typeof persistence.locate !== "function") {
    return { ok: false, code: "no-persistence", sessionId, message: "本内核没有 sessionPersistence，无法定位会话文件" };
  }
  await stopSessionActivity(ctx, sessionId);
  const located = await resolveSessionCwd(ctx, sessionId, fallbackCwd, signal);
  if (located.cwd === undefined) {
    return { ok: false, code: "session-unknown", sessionId, message: "内核里找不到这个会话的落盘位置" };
  }
  let target;
  try {
    const artifact = persistence.locate({ id: sessionId, cwd: located.cwd });
    const path = typeof artifact?.path === "string" ? artifact.path : "";
    if (path === "") {
      return { ok: false, code: "session-unknown", sessionId, message: "persistence.locate 没有给出路径" };
    }
    target = path;
  } catch (error) {
    return { ok: false, code: "locate-failed", sessionId, message: String(error?.message ?? error) };
  }
  // 删父目录（会话自己的独占目录）。日志缺失时也照删，force 让 ENOENT 不抛。
  const { dirname } = await import("node:path");
  const { rm } = await import("node:fs/promises");
  const directory = dirname(target);
  let removed = false;
  let removeError;
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    removed = true;
  } catch (error) {
    removeError = String(error?.message ?? error);
  }
  if (!removed) {
    return { ok: false, code: "remove-failed", sessionId, directory, message: removeError ?? "删除失败" };
  }
  const detachedWorkspaces = await detachFromWorkspaces(ctx, sessionId);
  return {
    ok: true,
    sessionId,
    directory,
    cwdSource: located.source,
    detachedWorkspaces
  };
}

/**
 * 判断一个已解析的 payload 是不是合法的删除请求。
 * @param payload 客户端传来的对象。
 * @returns 规范化后的 `{ sessionId, cwd }` 或错误说明。
 */
function readDeletePayload(payload) {
  if (payload === null || typeof payload !== "object") return { error: "payload 不是对象" };
  const sessionId = payload.sessionId;
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return { error: "sessionId 非法" };
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  return { sessionId, cwd };
}

/**
 * 插件入口。
 *
 * 执行顺序刻意分成三段，**每段都不依赖前一段成功**：
 *   1. 无条件挂诊断探针（只用 webServer，内核必备服务）；
 *   2. 再尝试用 connection 注册删除通道；
 *   3. 通道挂不上也不抛错，探针里会把原因写出来。
 *
 * 这样「插件没装上」和「装上了但服务拿不到」在真机上就能一眼区分，
 * 而不用再靠猜。
 * @param ctx 宿主上下文。
 */
export function apply(ctx) {
  diagLog("apply() entered");
  try {
    applyImpl(ctx);
    diagLog("apply() finished");
  } catch (error) {
    // apply 抛错会让 Cordis 销毁整条 fiber，连带回收已注册的路由 —— 那时
    // 探针会短暂存在再消失，表现为「什么都没挂上」，极难排查。这里兜住，
    // 把异常写进诊断日志，让插件至少活着、探针至少能回答。
    diagLog(`apply() threw: ${String(error?.stack ?? error?.message ?? error)}`);
  }
}

/**
 * apply 的实际内容。拆出来只是为了在外面套一层兜底 try/catch。
 * @param ctx 宿主上下文。
 */
function applyImpl(ctx) {
  /** 记录连接层是否成功注册，供探针回报。 */
  let channelState = "pending";

  /* ── 1. 诊断探针：用 inject 而不是 get ── */
  // 关键教训：Cordis 的 Service（webServer/connection 都是）**不能靠 ctx.get() 拿**。
  // ctx.get(name) 只返回「当前 fiber 已声明依赖」的服务，没声明就返回 undefined，
  // 不报错也不提示。内核自己的写法清一色是 ctx.inject(["webServer"], …)
  // （dsh-host-frontend-static:21、dsh-client-modules:570、dsh-api-remote-access:157）。
  try {
    ctx.inject(["webServer"], (webCtx) => {
      const webServer = webCtx.webServer;
      diagLog(`probe: webServer = ${webServer === undefined ? "undefined" : typeof webServer}`);
      if (webServer === undefined || typeof webServer.register !== "function") {
        channelState = "no-webserver";
        diagLog("probe: webServer has no register()");
        return;
      }
      webCtx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path: PROBE_PATH,
            handler(req, res) {
              const body = `dsh-ui-tools host half loaded; delete channel = ${channelState}`;
              res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
              res.end(body);
            }
          }),
        "ui-tools: probe route"
      );
      diagLog("probe route registered");
    });
  } catch (error) {
    channelState = "probe-failed";
    diagLog(`probe failed: ${String(error?.message ?? error)}`);
  }

  /* ── 2. 删除通道：connection 到场后注册 ── */
  try {
    // 这条日志是排查的关键：Cordis 的 ctx.inject 回调在服务缺席时**永不执行、
    // 也不报错**。有了它才能区分「connection 没到场」和「到场了但注册失败」。
    diagLog("calling ctx.inject([connection])");
    ctx.inject(["connection"], (scope) => {
      diagLog("connection callback fired");
      const connection = scope.connection;
      const canFetch = typeof connection?.fetch?.register === "function";
      const canRpc = typeof connection?.rpc?.handle === "function";
      diagLog(`connection.fetch.register = ${canFetch}, rpc.handle = ${canRpc}`);
      try {
        // 走 connection.fetch 而不是 connection.rpc。
        //
        // 为什么：rpc.handle 最终执行的是
        //   owner.effect(() => owner.webServer.register(route), …)   （dsh-client-connection:871）
        // 而 owner 是 Connection 服务自己的 ctx，它的入口 inject 只有 ["credentials"]，
        // 没有 webServer —— 于是必然抛
        //   cannot get property "webServer" without inject
        // 这条路径实际上要求宿主预先在 connection 的 ctx 里声明 webServer，插件做不到。
        //
        // connection.fetch.register 走的是 registerFetchRoute(owner, route)，只往内部的
        // fetchRoutes Map 里塞一条精确路由（dsh-client-connection:840-854），不碰 webServer，
        // 因此插件可用。它挂在 /api 这条已有 prefix 路由下，由 createSharedFetchHandler
        // 按 pathname 精确命中。
        //
        // 附带好处：鉴权完全由内核通道负责 —— Host/Origin 栅栏 + cookie 鉴权都在
        // admit(req) 里（dsh-client-connection:862-867），并且
        // createSharedFetchHandler 对非 owner 的 Peer 直接回 403（:830），
        // 我们不需要自己实现任何一道。
        const dispose = connection.fetch.register({
          path: DELETE_ROUTE_PATH,
          methods: ["POST"],
          requestBody: "buffered",
          async fetch(request, peer) {
            // 纵深防御：通道已经拦掉非 owner，这里再判一次。
            if (peer?.principal?.kind !== "owner") {
              return new Response(JSON.stringify({ ok: false, error: { code: "forbidden", message: "只有本机会话可以删除会话" } }), {
                status: 403,
                headers: { "content-type": "application/json; charset=utf-8" }
              });
            }
            let payload;
            try {
              payload = await request.json();
            } catch {
              return jsonResponse(400, { ok: false, error: { code: "bad-request", message: "请求体不是合法 JSON" } });
            }
            const parsed = readDeletePayload(payload);
            if (parsed.error !== undefined) {
              return jsonResponse(400, { ok: false, error: { code: "bad-request", message: parsed.error } });
            }
            try {
              // 传插件根的 ctx 而不是 scope：scope 只声明了 connection 一个依赖，
              // 通过它 get sessionPersistence / sessionQuery 会拿到 undefined。
              const result = await deleteSession(ctx, parsed.sessionId, parsed.cwd, request.signal);
              if (result.ok === true) return jsonResponse(200, { ok: true, value: result });
              return jsonResponse(200, {
                ok: false,
                error: { code: result.code ?? "delete-failed", message: result.message ?? "删除失败", details: result }
              });
            } catch (error) {
              return jsonResponse(200, { ok: false, error: { code: "delete-failed", message: String(error?.message ?? error) } });
            }
          }
        });
        channelState = "registered";
        diagLog(`delete channel registered (dispose = ${typeof dispose})`);
      } catch (error) {
        channelState = `register-failed: ${String(error?.message ?? error)}`;
        diagLog(`connection.fetch.register threw: ${String(error?.stack ?? error?.message ?? error)}`);
      }
    });
  } catch (error) {
    channelState = `inject-failed: ${String(error?.message ?? error)}`;
    diagLog(`ctx.inject threw: ${String(error?.message ?? error)}`);
  }
}
