/**
 * prometheus-mcp-server.ts
 *
 * Prometheus MCP server for @perf-profile GitHub Copilot agent.
 * Supports two transports:
 *   stdio  — local Copilot extension (command-mode)
 *   sse    — Docker / remote deployments (HTTP + Server-Sent Events)
 *
 * ENV:
 *   PROMETHEUS_URL          default: http://localhost:9090
 *   PROMETHEUS_TIMEOUT_MS   default: 10000
 *   MCP_TRANSPORT           stdio | sse   default: stdio
 *   MCP_PORT                              default: 3000
 *   MCP_HOST                              default: 0.0.0.0
 *   MAX_CONCURRENT                        default: 4
 *   LOG_LEVEL               debug|info|warn|error  default: info
 */

import http from 'node:http';
import { URL } from 'node:url';
import { Semaphore, MAX_CONCURRENT } from './semaphore.js';

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  prometheusUrl: process.env.PROMETHEUS_URL          ?? 'http://localhost:9090',
  timeoutMs:     parseInt(process.env.PROMETHEUS_TIMEOUT_MS ?? '10000'),
  transport:    (process.env.MCP_TRANSPORT            ?? 'stdio') as 'stdio' | 'sse',
  port:          parseInt(process.env.MCP_PORT        ?? '3000'),
  host:          process.env.MCP_HOST                 ?? '0.0.0.0',
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT  ?? String(MAX_CONCURRENT)),
  logLevel:      process.env.LOG_LEVEL                ?? 'info',
};

// ── Structured logger ─────────────────────────────────────────────────────────

const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[CONFIG.logLevel] ?? 1;

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  if ((LEVELS[level] ?? 0) < minLevel) return;
  // Always stderr — keeps stdout clean for stdio MCP framing
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), level, msg, service: 'prometheus-mcp', ...meta }) + '\n'
  );
}

// ── Semaphore (max 4 concurrent Prometheus calls) ─────────────────────────────

const pool = new Semaphore(CONFIG.maxConcurrent);

// ── Prometheus HTTP client ────────────────────────────────────────────────────

async function promFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${CONFIG.prometheusUrl}/api/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const release = await pool.acquire();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
  const t0 = Date.now();

  log('debug', 'prom fetch start', { path, active: pool.activeCount, pending: pool.pendingCount });

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json() as { status: string; data: unknown; error?: string };
    if (json.status !== 'success') throw new Error(`Prometheus: ${json.error}`);
    log('info', 'prom fetch ok', { path, ms: Date.now() - t0 });
    return json.data;
  } catch (err: unknown) {
    log('error', 'prom fetch fail', { path, error: String(err), ms: Date.now() - t0 });
    throw err;
  } finally {
    clearTimeout(timer);
    release();
  }
}

function resolveTime(t: string): string {
  if (t === 'now') return String(Math.floor(Date.now() / 1000));
  if (/^\d+$/.test(t)) return t;
  const m = t.match(/^now-(\d+)([smhdw])$/);
  if (!m) return t;
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return String(Math.floor(Date.now() / 1000) - parseInt(m[1]) * (units[m[2]] ?? 1));
}

// ── Tool registry ─────────────────────────────────────────────────────────────

type Args = Record<string, string>;
interface ToolResult { content: Array<{ type: string; text: string }>; isError?: boolean }

const TOOLS: Record<string, {
  description: string;
  schema: object;
  handle: (a: Args) => Promise<ToolResult>;
}> = {

  query_range: {
    description: 'Prometheus range query — returns time-series matrix.',
    schema: {
      type: 'object', required: ['query', 'start', 'end', 'step'],
      properties: {
        query: { type: 'string', description: 'PromQL expression' },
        start: { type: 'string', description: 'Start time (unix ts or now-Nh)' },
        end:   { type: 'string', description: 'End time (unix ts or "now")' },
        step:  { type: 'string', description: 'Resolution step e.g. 288s' },
      },
    },
    async handle({ query, start, end, step }) {
      const data = await promFetch('query_range', {
        query, step, start: resolveTime(start), end: resolveTime(end),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  },

  instant_query: {
    description: 'Prometheus instant query — returns a vector.',
    schema: {
      type: 'object', required: ['query'],
      properties: {
        query: { type: 'string', description: 'PromQL expression' },
        time:  { type: 'string', description: 'Evaluation time (default: now)' },
      },
    },
    async handle({ query, time = 'now' }) {
      const data = await promFetch('query', { query, time: resolveTime(time) });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  },

  label_values: {
    description: 'Return all values for a Prometheus label.',
    schema: {
      type: 'object', required: ['label'],
      properties: {
        label: { type: 'string', description: 'Label name e.g. uri' },
        match: { type: 'string', description: 'Optional series selector' },
      },
    },
    async handle({ label, match }) {
      const p: Record<string, string> = {};
      if (match) p['match[]'] = match;
      const data = await promFetch(`label/${encodeURIComponent(label)}/values`, p);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  },

  series_metadata: {
    description: 'Return metric names and label sets matching a selector.',
    schema: {
      type: 'object', required: ['match'],
      properties: {
        match: { type: 'string', description: 'Series selector e.g. {app_name="payment-api"}' },
      },
    },
    async handle({ match }) {
      const data = await promFetch('series', { 'match[]': match });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  },
};

// ── MCP JSON-RPC dispatcher ───────────────────────────────────────────────────

async function dispatch(req: { method: string; params?: Record<string, unknown>; id?: unknown }) {
  const { method, params = {}, id } = req;
  const ok  = (r: unknown) => ({ jsonrpc: '2.0', id, result: r });
  const err = (c: number, m: string) => ({ jsonrpc: '2.0', id, error: { code: c, message: m } });

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'prometheus-mcp', version: '1.0.0' },
      });

    case 'tools/list':
      return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({
        name, description: t.description, inputSchema: t.schema,
      })) });

    case 'tools/call': {
      const name = params.name as string;
      const args = (params.arguments ?? {}) as Args;
      const tool = TOOLS[name];
      if (!tool) return err(-32601, `Unknown tool: ${name}`);
      try {
        return ok(await tool.handle(args));
      } catch (e: unknown) {
        return ok({ content: [{ type: 'text', text: `Error: ${String(e)}` }], isError: true });
      }
    }

    case 'ping':
      return ok({});

    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

// ── Transport: stdio ──────────────────────────────────────────────────────────

function startStdio() {
  log('info', 'transport=stdio ready');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const res = await dispatch(JSON.parse(t));
        process.stdout.write(JSON.stringify(res) + '\n');
      } catch {
        process.stdout.write(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'
        );
      }
    }
  });
  process.stdin.on('end', () => { log('info', 'stdin closed'); process.exit(0); });
}

// ── Transport: SSE + HTTP ────────────────────────────────────────────────────

function startSSE() {
  const server = http.createServer(async (req, res) => {
    const url  = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const cors = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors); res.end(); return;
    }

    // ── GET /health ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/health') {
      const body = JSON.stringify({
        status:   'ok',
        version:  '1.0.0',
        transport: 'sse',
        pool:      { active: pool.activeCount, pending: pool.pendingCount, max: CONFIG.maxConcurrent },
        prometheus: CONFIG.prometheusUrl,
        uptime_s:  Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    // ── GET /sse  (SSE stream — Copilot connects here) ───────────────────────
    if (req.method === 'GET' && url.pathname === '/sse') {
      res.writeHead(200, {
        ...cors,
        'Content-Type':      'text/event-stream',
        'Cache-Control':     'no-cache',
        'Connection':        'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (d: unknown) => res.write(`data: ${JSON.stringify(d)}\n\n`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      log('info', 'sse client connected', { ip: req.socket.remoteAddress });
      req.on('close', () =>
        log('info', 'sse client disconnected', { ip: req.socket.remoteAddress })
      );
      return;
    }

    // ── POST /rpc  (JSON-RPC calls from Copilot) ─────────────────────────────
    if (req.method === 'POST' && url.pathname === '/rpc') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const result = await dispatch(JSON.parse(body));
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON-RPC request' }));
        }
      });
      return;
    }

    // ── 404 ──────────────────────────────────────────────────────────────────
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', endpoints: ['/health', '/sse', '/rpc'] }));
  });

  server.listen(CONFIG.port, CONFIG.host, () => {
    log('info', 'transport=sse ready', {
      host: CONFIG.host, port: CONFIG.port,
      prometheus: CONFIG.prometheusUrl,
      maxConcurrent: CONFIG.maxConcurrent,
    });
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = (sig: string) => {
    log('info', `${sig} · shutting down`);
    server.close(() => { log('info', 'exit clean'); process.exit(0); });
    setTimeout(() => { log('warn', 'force exit'); process.exit(1); }, 10_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

// ── Boot ──────────────────────────────────────────────────────────────────────

log('info', 'prometheus-mcp starting', {
  transport: CONFIG.transport, prometheus: CONFIG.prometheusUrl,
  maxConcurrent: CONFIG.maxConcurrent, logLevel: CONFIG.logLevel,
});

CONFIG.transport === 'sse' ? startSSE() : startStdio();
