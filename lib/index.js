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

/** 插件名，与 cordis.patch.yml 里的 id 无关，仅用于诊断。 */
export const name = "ui-tools";
/** 入口 inject 只声明本半边必需的 connection 服务。 */
export const inject = ["connection"];
/** 自建 RPC 通道名；客户端用同一常量拼出 `ctx.connection.rpc.call("/ui-tools", ...)`。 */
export const RPC_CHANNEL = "/ui-tools";
/** 删除会话的端点名（通道内的 method）。 */
export const SESSION_DELETE_ENDPOINT = "sessionDelete";

/**
 * 内核会话 id 的合法形态。当前内核发的是 `session-<uuid>`，但历史格式与
 * 迁移格式可能更长，这里只做「安全字符 + 长度」的白名单，防止把怪异值
 * 拼进文件路径。
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

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
 * 插件入口。只在 connection 到场后注册通道，卸载时由 ctx.effect 自动摘掉路由。
 * @param ctx 宿主上下文。
 */
export function apply(ctx) {
  ctx.inject(["connection"], (scope) => {
    const connection = scope.connection;
    if (typeof connection?.rpc?.handle !== "function") return;
    scope.effect(
      () =>
        connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload, signal, peer) => {
          // 通道本身已经拦掉非 owner，这里再判一次做纵深防御。
          if (peer?.principal?.kind !== "owner") {
            return { ok: false, error: { code: "forbidden", message: "只有本机会话可以删除会话" } };
          }
          if (endpoint !== SESSION_DELETE_ENDPOINT) {
            return { ok: false, error: { code: "unknown-endpoint", message: `未知端点 ${String(endpoint)}` } };
          }
          const request = readDeletePayload(payload);
          if (request.error !== undefined) {
            return { ok: false, error: { code: "bad-request", message: request.error } };
          }
          try {
            const result = await deleteSession(scope, request.sessionId, request.cwd, signal);
            if (result.ok === true) return { ok: true, value: result };
            return {
              ok: false,
              error: { code: result.code ?? "delete-failed", message: result.message ?? "删除失败", details: result }
            };
          } catch (error) {
            return { ok: false, error: { code: "delete-failed", message: String(error?.message ?? error) } };
          }
        }),
      "ui-tools: session delete channel"
    );
  });
}
