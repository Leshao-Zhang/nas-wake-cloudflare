import { DurableObject } from "cloudflare:workers";
import { PAGE } from "./page";

export interface Env {
  WAKE: DurableObjectNamespace<WakeState>;
  WAKE_PASSWORD?: string;
  DEVICE_TOKEN?: string;
}

const PENDING_MS = 120_000;

type WakeStatus = "idle" | "pending" | "consumed" | "expired";

type WakeRow = {
  status: string;
  pending_at: number | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function configured(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

async function readPassword(request: Request): Promise<string> {
  try {
    const body = (await request.json()) as { password?: unknown };
    return typeof body.password === "string" ? body.password : "";
  } catch {
    return "";
  }
}

function readDeviceToken(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  return header.startsWith(prefix) ? header.slice(prefix.length) : "";
}

async function callState(env: Env, path: string): Promise<Response> {
  const stub = env.WAKE.get(env.WAKE.idFromName("nas"));
  const response = await stub.fetch(`https://wake.internal${path}`);
  return json(await response.json(), response.status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/wake" || url.pathname === "/api/status") {
      if (request.method !== "POST") return json({ error: "方法不对" }, 405);
      if (!configured(env.WAKE_PASSWORD)) return json({ error: "服务未配置" }, 503);
      const password = await readPassword(request);
      if (!password || !safeEqual(password, env.WAKE_PASSWORD)) {
        return json({ error: "密码错误" }, 401);
      }
      const path = url.pathname === "/api/wake" ? "/wake" : "/status";
      return callState(env, path);
    }

    if (url.pathname === "/api/poll" || url.pathname === "/api/ack") {
      const methodOk =
        (url.pathname === "/api/poll" && request.method === "GET") ||
        (url.pathname === "/api/ack" && request.method === "POST");
      if (!methodOk) return json({ error: "方法不对" }, 405);
      if (!configured(env.DEVICE_TOKEN)) return json({ error: "服务未配置" }, 503);
      const token = readDeviceToken(request);
      if (!token || !safeEqual(token, env.DEVICE_TOKEN)) {
        return json(url.pathname === "/api/poll" ? { wake: false } : { ok: false }, 401);
      }
      const path = url.pathname === "/api/poll" ? "/poll" : "/ack";
      return callState(env, path);
    }

    return json({ error: "没有这个地址" }, 404);
  },
};

export class WakeState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS wake (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          status TEXT NOT NULL,
          pending_at INTEGER
        )
      `);
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO wake (id, status, pending_at) VALUES (1, 'idle', NULL)",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/wake") return json(this.arm(Date.now()));
    if (path === "/status") return json({ status: this.current(Date.now()).status });
    if (path === "/poll") return json({ wake: this.current(Date.now()).status === "pending" });
    if (path === "/ack") return json(this.ack(Date.now()));
    return json({ error: "没有这个地址" }, 404);
  }

  private arm(now: number): { status: "pending" } {
    this.current(now);
    this.write("pending", now);
    return { status: "pending" };
  }

  private ack(now: number): { ok: boolean } {
    const status = this.current(now).status;
    if (status === "consumed") return { ok: true };
    if (status !== "pending") return { ok: false };
    this.write("consumed", null);
    return { ok: true };
  }

  private current(now: number): { status: WakeStatus } {
    const row = this.read();
    if (row.status === "pending" && (row.pendingAt == null || now - row.pendingAt > PENDING_MS)) {
      this.write("expired", null);
      return { status: "expired" };
    }
    return { status: row.status };
  }

  private read(): { status: WakeStatus; pendingAt: number | null } {
    const rows = this.ctx.storage.sql
      .exec<WakeRow>("SELECT status, pending_at FROM wake WHERE id = 1")
      .toArray();
    const row = rows[0];
    const status = row?.status;
    if (status === "pending" || status === "consumed" || status === "expired" || status === "idle") {
      return { status, pendingAt: row?.pending_at ?? null };
    }
    return { status: "idle", pendingAt: null };
  }

  private write(status: WakeStatus, pendingAt: number | null): void {
    this.ctx.storage.sql.exec(
      "UPDATE wake SET status = ?, pending_at = ? WHERE id = 1",
      status,
      pendingAt,
    );
  }
}
