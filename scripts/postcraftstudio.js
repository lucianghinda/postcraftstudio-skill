#!/usr/bin/env node

/**
 * Postcraftstudio CLI — drives the Postcraftstudio API for article generation,
 * asset retrieval, and discovery from a Claude skill or any shell.
 *
 * Zero runtime dependencies. Built-ins only: fetch, fs, path, os, readline,
 * crypto, https, url. Runs on Node 18+ and Bun.
 *
 * API docs: https://postcraftstudio.com/api/v1/docs
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const crypto = require("crypto");

const VERSION = "1.0.0";
const DEFAULT_BASE_URL = "https://postcraftstudio.com";
const SETTINGS_URL = "https://postcraftstudio.com/settings/api_keys";
const API_KEY_PATTERN = /^pcs_live_[A-Za-z0-9]{32}$/;
const TOKEN_PROBE_PATH = "/api/v1/themes";
const TERMINAL_STATUSES = new Set(["completed", "failed"]);
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_SECONDS = 300;
const LOCAL_FETCH_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const LOCAL_FETCH_TIMEOUT_MS = 30_000;
const LOCAL_FETCH_MAX_REDIRECTS = 5;

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".config", "postcraftstudio");
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "config.json");
const LOCAL_CONFIG_DIR = ".postcraftstudio";
const LOCAL_CONFIG_FILE = path.join(LOCAL_CONFIG_DIR, "config.json");

// ----------------------------------------------------------------------------
// Output helpers (TTY-aware coloring)

const useColor = process.stderr.isTTY && process.env.NO_COLOR === undefined;
const ansi = (code) => (useColor ? `\x1b[${code}m` : "");
const fmt = {
  bold: (s) => `${ansi("1")}${s}${ansi("0")}`,
  dim: (s) => `${ansi("2")}${s}${ansi("0")}`,
  red: (s) => `${ansi("31")}${s}${ansi("0")}`,
  green: (s) => `${ansi("32")}${s}${ansi("0")}`,
  yellow: (s) => `${ansi("33")}${s}${ansi("0")}`,
  cyan: (s) => `${ansi("36")}${s}${ansi("0")}`,
};

function writeOut(line) {
  process.stdout.write(line + "\n");
}

function writeErr(line) {
  process.stderr.write(line + "\n");
}

function fail(message, exitCode = 1) {
  writeErr(fmt.red("error: ") + message);
  process.exit(exitCode);
}

// ----------------------------------------------------------------------------
// Config (env > project > global)

function readConfigFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    writeErr(fmt.yellow(`warning: failed to read ${file}: ${err.message}`));
    return null;
  }
}

function writeConfigFile(file, config) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

function loadConfig() {
  const merged = {};
  const global = readConfigFile(GLOBAL_CONFIG_FILE);
  const local = readConfigFile(LOCAL_CONFIG_FILE);
  if (global) Object.assign(merged, global, { _source: "global" });
  if (local) Object.assign(merged, local, { _source: "project" });
  return merged;
}

function resolveApiKey() {
  if (process.env.POSTCRAFTSTUDIO_API_KEY) {
    return { key: process.env.POSTCRAFTSTUDIO_API_KEY, source: "POSTCRAFTSTUDIO_API_KEY" };
  }
  const config = loadConfig();
  if (config.api_key) return { key: config.api_key, source: config._source + " config" };
  return null;
}

function resolveBaseUrl() {
  if (process.env.POSTCRAFTSTUDIO_BASE_URL) return process.env.POSTCRAFTSTUDIO_BASE_URL.replace(/\/$/, "");
  const config = loadConfig();
  if (config.base_url) return config.base_url.replace(/\/$/, "");
  return DEFAULT_BASE_URL;
}

function requireApiKey() {
  const found = resolveApiKey();
  if (!found) {
    fail(
      `API key not found. Run '${fmt.bold("postcraftstudio setup")}' to configure your API key. ` +
        `Get your key at ${SETTINGS_URL}`,
    );
  }
  return found.key;
}

// ----------------------------------------------------------------------------
// HTTP

class ApiError extends Error {
  constructor(message, { status = null, type = null, details = null, requestId = null, retryAfter = null, network = false } = {}) {
    super(message);
    this.status = status;
    this.type = type;
    this.details = details;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    this.network = network;
  }
}

async function rawRequest(method, endpoint, { body = null, apiKey = null, headers = {} } = {}) {
  const base = resolveBaseUrl();
  const url = base + endpoint;
  const key = apiKey || requireApiKey();
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...headers,
    },
  };
  if (body !== null) {
    init.headers["Content-Type"] = init.headers["Content-Type"] || "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new ApiError(`Network error contacting ${url}: ${err.message}`, { network: true });
  }
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * High-level call: returns parsed JSON on 2xx, throws ApiError on non-2xx
 * with the server's error envelope unmarshaled.
 */
async function apiCall(method, endpoint, opts = {}) {
  const response = await rawRequest(method, endpoint, opts);
  const data = await parseJsonSafe(response);
  if (response.ok) return { data, response };
  const env = data && data.error ? data.error : {};
  throw new ApiError(env.message || `HTTP ${response.status}`, {
    status: response.status,
    type: env.type || null,
    details: env.details || null,
    requestId: env.request_id || null,
    retryAfter: response.headers.get("retry-after"),
  });
}

// ----------------------------------------------------------------------------
// Local-fetch (for P1-E-3 source_unreachable fallback)

async function localFetch(targetUrl) {
  let current = targetUrl;
  let redirectsLeft = LOCAL_FETCH_MAX_REDIRECTS;
  while (true) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:") {
      throw new Error(`local fetch refused: only https:// is allowed, got ${parsed.protocol}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOCAL_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, { redirect: "manual", signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") throw new Error(`local fetch timed out after ${LOCAL_FETCH_TIMEOUT_MS}ms`);
      throw new Error(`local fetch network error: ${err.message}`);
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`local fetch ${response.status} redirect without Location header`);
      if (redirectsLeft === 0) throw new Error(`local fetch exceeded ${LOCAL_FETCH_MAX_REDIRECTS} redirects`);
      redirectsLeft--;
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) throw new Error(`local fetch HTTP ${response.status}`);

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > LOCAL_FETCH_MAX_BYTES) {
      throw new Error(`local fetch refused: Content-Length ${contentLength} exceeds 10 MB limit`);
    }

    // Stream-read with a hard byte cap so a missing/lying Content-Length can't OOM us.
    const chunks = [];
    let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > LOCAL_FETCH_MAX_BYTES) {
        try { await reader.cancel(); } catch (_e) { /* noop */ }
        throw new Error(`local fetch refused: response exceeded 10 MB limit mid-stream`);
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return buf.toString("utf-8");
  }
}

// ----------------------------------------------------------------------------
// Argument parsing (minimal, hand-rolled)

function parseArgs(argv) {
  const result = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      result._.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        result.flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("-")) {
          result.flags[token.slice(2)] = true;
        } else {
          result.flags[token.slice(2)] = next;
          i++;
        }
      }
    } else if (token.startsWith("-") && token.length > 1) {
      result.flags[token.slice(1)] = true;
    } else {
      result._.push(token);
    }
  }
  return result;
}

function flagString(args, name) {
  const v = args.flags[name];
  return typeof v === "string" ? v : null;
}

function flagBool(args, name) {
  return args.flags[name] === true || args.flags[name] === "true";
}

function flagInt(args, name) {
  const v = args.flags[name];
  if (v === undefined || v === true) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ----------------------------------------------------------------------------
// Misc helpers

function uuidv4() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC4122 v4 fallback (Node <19 should still have randomUUID; this is paranoia).
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(s, n) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function printTable(rows, columns) {
  if (rows.length === 0) {
    writeOut(fmt.dim("(no rows)"));
    return;
  }
  const widths = columns.map((col) => {
    const cells = rows.map((r) => String(r[col.key] ?? ""));
    return Math.max(col.title.length, ...cells.map((c) => c.length));
  });
  const header = columns.map((col, i) => fmt.bold(col.title.padEnd(widths[i]))).join("  ");
  const separator = columns.map((_, i) => "─".repeat(widths[i])).join("  ");
  writeOut(header);
  writeOut(fmt.dim(separator));
  for (const row of rows) {
    writeOut(columns.map((col, i) => String(row[col.key] ?? "").padEnd(widths[i])).join("  "));
  }
}

function statusBadge(status) {
  if (status === "completed") return fmt.green(status);
  if (status === "failed") return fmt.red(status);
  if (status === "processing" || status === "pending") return fmt.yellow(status);
  return status;
}

// ----------------------------------------------------------------------------
// Readline prompts

function prompt(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (silent) {
      rl.question(question, (answer) => {
        rl.close();
        process.stderr.write("\n");
        resolve(answer.trim());
      });
      // eslint-disable-next-line no-underscore-dangle
      const originalWrite = rl._writeToOutput.bind(rl);
      // eslint-disable-next-line no-underscore-dangle
      rl._writeToOutput = (str) => {
        if (str.startsWith(question)) originalWrite(str);
        // else: silence echo of pasted/typed key
      };
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function confirm(question, defaultYes = false) {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const answer = (await prompt(question + suffix)).toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

// ----------------------------------------------------------------------------
// Error rendering

function describeApiError(err) {
  const lines = [];
  if (err.status === 401) {
    lines.push(`Unauthorized (HTTP 401). Run '${fmt.bold("postcraftstudio setup")}' to refresh your API key.`);
  } else if (err.status === 402) {
    const remaining = err.details && err.details.remaining;
    lines.push(`Plan limit reached (HTTP 402). ${err.message}`);
    if (remaining != null) lines.push(fmt.dim(`Remaining: ${remaining}.`));
  } else if (err.status === 422) {
    lines.push(`Validation failed (HTTP 422). ${err.message}`);
    if (err.details && typeof err.details === "object") {
      for (const [field, errs] of Object.entries(err.details)) {
        const list = Array.isArray(errs) ? errs.join(", ") : String(errs);
        lines.push(`  ${fmt.bold(field)}: ${list}`);
      }
    }
  } else if (err.status === 429) {
    lines.push(`Rate limited (HTTP 429). ${err.message}`);
    if (err.retryAfter) lines.push(fmt.dim(`Retry-After: ${err.retryAfter} seconds.`));
  } else if (err.status === 502 && err.type === "source_unreachable") {
    const reason = err.details && err.details.reason ? err.details.reason : "unknown";
    lines.push(`Source URL could not be reached (reason: ${reason}). ${err.message}`);
  } else if (err.status) {
    lines.push(`API error ${err.status}${err.type ? " " + fmt.dim("(" + err.type + ")") : ""}: ${err.message}`);
  } else {
    lines.push(err.message);
  }
  if (err.requestId) lines.push(fmt.dim(`request_id: ${err.requestId}`));
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// setup command (U15)

async function cmdSetup(args) {
  writeErr(fmt.bold("Postcraftstudio setup"));
  writeErr("");
  writeErr(`Generate or copy a key at ${fmt.cyan(SETTINGS_URL)}`);
  writeErr(`Token format: ${fmt.dim("pcs_live_<32 alphanumeric characters>")}`);
  writeErr("");

  const baseFromFlag = flagString(args, "base-url");
  const baseUrl = baseFromFlag || (await prompt(`Base URL [${DEFAULT_BASE_URL}]: `)) || DEFAULT_BASE_URL;
  const normalizedBase = baseUrl.replace(/\/$/, "");

  const keyFromFlag = flagString(args, "api-key");
  let apiKey = keyFromFlag ? keyFromFlag.trim() : "";
  if (!apiKey) apiKey = (await prompt("Paste API key: ", { silent: true })).trim();

  if (!API_KEY_PATTERN.test(apiKey)) {
    fail(
      `That doesn't look like a Postcraftstudio key. Expected format: ${fmt.dim("pcs_live_")}` +
        `<32 alphanumeric>. Get a fresh key at ${SETTINGS_URL}`,
    );
  }

  writeErr(fmt.dim(`Probing ${normalizedBase}${TOKEN_PROBE_PATH} to validate the token...`));

  const previousBase = process.env.POSTCRAFTSTUDIO_BASE_URL;
  process.env.POSTCRAFTSTUDIO_BASE_URL = normalizedBase;
  try {
    await apiCall("GET", TOKEN_PROBE_PATH, { apiKey });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      fail(`The API rejected this key (HTTP 401). Get a fresh key at ${SETTINGS_URL} and try again.`);
    }
    fail(err instanceof ApiError ? describeApiError(err) : err.message);
  } finally {
    if (previousBase === undefined) delete process.env.POSTCRAFTSTUDIO_BASE_URL;
    else process.env.POSTCRAFTSTUDIO_BASE_URL = previousBase;
  }

  const useProject = flagBool(args, "project");
  const useGlobal = flagBool(args, "global");
  if (useProject && useGlobal) fail("Pass either --project or --global, not both.");
  let scope;
  if (useProject) scope = "project";
  else if (useGlobal) scope = "global";
  else scope = (await confirm("Save to project (./.postcraftstudio/config.json)?", false)) ? "project" : "global";

  const file = scope === "project" ? path.resolve(LOCAL_CONFIG_FILE) : GLOBAL_CONFIG_FILE;
  const existing = readConfigFile(file) || {};
  const next = { ...existing, api_key: apiKey };
  if (normalizedBase !== DEFAULT_BASE_URL) next.base_url = normalizedBase;
  writeConfigFile(file, next);

  writeErr("");
  writeErr(fmt.green("✔ ") + `API key saved to ${fmt.dim(file)}`);
  writeErr(fmt.dim(`Run 'postcraftstudio --help' to see available commands.`));
}

// ----------------------------------------------------------------------------
// articles commands (U16)

function buildCreatePayload(args) {
  const payload = {};
  const body = flagString(args, "body");
  const file = flagString(args, "file");
  const sourceUrl = flagString(args, "source-url");
  const bodyHtml = flagString(args, "body-html");

  const sources = [body, file, sourceUrl, bodyHtml].filter((v) => v != null);
  if (sources.length === 0) {
    fail("articles:create requires one of --body, --source-url, --body-html, or --file <path>.");
  }
  if (sources.length > 1) {
    fail("articles:create accepts only one source: pick one of --body, --source-url, --body-html, --file.");
  }

  if (body) payload.body = body;
  if (file) {
    if (!fs.existsSync(file)) fail(`--file not found: ${file}`);
    payload.body = fs.readFileSync(file, "utf-8");
  }
  if (sourceUrl) payload.source_url = sourceUrl;
  if (bodyHtml) payload.body_html = bodyHtml;

  for (const flag of ["theme-slug", "writing-style-id", "article-purpose", "main-idea", "title", "generate"]) {
    const v = flagString(args, flag);
    if (v != null) {
      const key = flag.replace(/-/g, "_");
      payload[key] = flag === "writing-style-id" ? Number(v) : v;
    }
  }
  return payload;
}

function summarizeArticleFromCreate(article) {
  const { id, status, title, theme_slug: themeSlug, article_purpose: purpose } = article;
  const lines = [
    `${fmt.bold("Article")} #${id} ${fmt.dim("[" + statusBadge(status) + "]")}`,
  ];
  if (title) lines.push(`  title: ${title}`);
  if (themeSlug) lines.push(`  theme: ${themeSlug}`);
  if (purpose) lines.push(`  purpose: ${purpose}`);
  return lines.join("\n");
}

async function pollUntilDone(articleId, { intervalMs, timeoutMs, json }) {
  const started = Date.now();
  let lastStatus = null;
  while (true) {
    const { data, response } = await apiCall("GET", `/api/v1/articles/${articleId}`);
    if (data.status !== lastStatus && !json) {
      writeErr(fmt.dim(`status: ${statusBadge(data.status)}`));
      lastStatus = data.status;
    }
    if (TERMINAL_STATUSES.has(data.status)) return data;
    if (Date.now() - started >= timeoutMs) {
      const err = new Error(`Timed out after ${(timeoutMs / 1000).toFixed(0)}s while polling. Article ${articleId} is still ${data.status}; run 'postcraftstudio articles:status ${articleId}' to keep checking.`);
      err.timeout = true;
      err.lastSnapshot = data;
      throw err;
    }
    const retryHeader = response.headers.get("retry-after");
    const wait = retryHeader ? Math.max(1000, Number(retryHeader) * 1000) : intervalMs;
    await sleep(wait);
  }
}

async function postArticle(payload, idempotencyKey) {
  return apiCall("POST", "/api/v1/articles", {
    body: payload,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

async function cmdArticlesCreate(args) {
  let payload = buildCreatePayload(args);
  const json = flagBool(args, "json");
  const noWait = flagBool(args, "no-wait");
  const timeoutSec = flagInt(args, "timeout") ?? DEFAULT_TIMEOUT_SECONDS;
  const idempotencyKey = flagString(args, "idempotency-key") || uuidv4();
  const autoLocalFetch = flagBool(args, "auto-local-fetch");

  let created;
  try {
    created = await postArticle(payload, idempotencyKey);
  } catch (err) {
    if (err instanceof ApiError && err.status === 502 && err.type === "source_unreachable" && payload.source_url) {
      const reason = err.details && err.details.reason ? err.details.reason : "unknown";
      const useFallback = await shouldUseLocalFetch({ autoLocalFetch, reason, message: err.message });
      if (!useFallback) {
        fail(describeApiError(err));
      }
      writeErr(fmt.dim(`Fetching ${payload.source_url} locally...`));
      let html;
      try {
        html = await localFetch(payload.source_url);
      } catch (localErr) {
        fail(`source_unreachable + local fallback failed.\n  server: ${err.message} (reason: ${reason})\n  local:  ${localErr.message}`);
      }
      const retryPayload = { ...payload, body_html: html };
      delete retryPayload.source_url;
      payload = retryPayload;
      created = await postArticle(payload, uuidv4()); // fresh key for the retry
    } else {
      fail(describeApiError(err));
    }
  }

  const article = created.data;

  if (json && noWait) return writeOut(JSON.stringify(article, null, 2));
  if (noWait) {
    writeErr(summarizeArticleFromCreate(article));
    writeOut(String(article.id));
    return;
  }

  let final;
  try {
    final = await pollUntilDone(article.id, { intervalMs: DEFAULT_POLL_INTERVAL_MS, timeoutMs: timeoutSec * 1000, json });
  } catch (err) {
    if (err.timeout && json) {
      writeOut(JSON.stringify(err.lastSnapshot, null, 2));
      process.exit(3);
    }
    fail(err.message, 3);
  }

  if (json) return writeOut(JSON.stringify(final, null, 2));

  writeOut(summarizeArticleFromCreate(final));
  if (final.status === "completed") {
    const textCount = Array.isArray(final.text_assets) ? final.text_assets.length : 0;
    const imageCount = Array.isArray(final.image_assets) ? final.image_assets.length : 0;
    writeOut(fmt.dim(`  assets: ${textCount} text, ${imageCount} image`));
    writeOut(fmt.dim(`  inspect: postcraftstudio assets:list ${final.id}`));
  } else if (final.status === "failed") {
    process.exit(4);
  }
}

async function shouldUseLocalFetch({ autoLocalFetch, reason, message }) {
  if (autoLocalFetch) return true;
  if (process.stdin.isTTY) {
    writeErr("");
    writeErr(fmt.yellow(`The server couldn't reach the source URL (${reason}): ${message}`));
    return await confirm("Fetch it locally and upload the HTML?", false);
  }
  writeErr(fmt.yellow(`Source unreachable (${reason}): ${message}`));
  writeErr(fmt.dim(`Rerun with ${fmt.bold("--auto-local-fetch")} to retry from this machine.`));
  return false;
}

async function cmdArticlesStatus(args) {
  const id = args._[1];
  if (!id) fail("articles:status requires an article id: postcraftstudio articles:status <id>");
  const { data } = await apiCall("GET", `/api/v1/articles/${id}`);
  if (flagBool(args, "json")) return writeOut(JSON.stringify(data, null, 2));
  writeOut(summarizeArticleFromCreate(data));
  writeOut(fmt.dim(`  updated: ${data.updated_at}`));
}

async function cmdArticlesGet(args) {
  const id = args._[1];
  if (!id) fail("articles:get requires an article id: postcraftstudio articles:get <id>");
  const { data } = await apiCall("GET", `/api/v1/articles/${id}`);
  writeOut(JSON.stringify(data, null, 2));
}

async function cmdArticlesList(args) {
  const limit = flagInt(args, "limit");
  const cursor = flagString(args, "cursor");
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const path = `/api/v1/articles${params.toString() ? "?" + params : ""}`;
  const { data } = await apiCall("GET", path);
  if (flagBool(args, "json")) return writeOut(JSON.stringify(data, null, 2));

  const articles = Array.isArray(data.articles) ? data.articles : [];
  const rows = (limit ? articles.slice(0, limit) : articles).map((a) => ({
    id: a.id,
    status: statusBadge(a.status || ""),
    title: truncate(a.title || "", 50),
    theme: a.theme_slug || "",
    created: a.created_at ? a.created_at.slice(0, 10) : "",
  }));
  printTable(rows, [
    { key: "id", title: "ID" },
    { key: "status", title: "Status" },
    { key: "title", title: "Title" },
    { key: "theme", title: "Theme" },
    { key: "created", title: "Created" },
  ]);
  if (data.next_cursor) writeErr(fmt.dim(`next page: postcraftstudio articles:list --cursor ${data.next_cursor}`));
}

// ----------------------------------------------------------------------------
// discovery + asset commands (U17)

async function cmdThemesList(args) {
  const { data } = await apiCall("GET", "/api/v1/themes");
  if (flagBool(args, "json")) return writeOut(JSON.stringify(data, null, 2));
  const rows = (data.themes || []).map((t) => ({ slug: t.slug, name: t.name }));
  printTable(rows, [
    { key: "slug", title: "Slug" },
    { key: "name", title: "Name" },
  ]);
}

async function cmdWritingStylesList(args) {
  const { data } = await apiCall("GET", "/api/v1/writing_styles");
  if (flagBool(args, "json")) return writeOut(JSON.stringify(data, null, 2));
  const rows = (data.writing_styles || []).map((s) => ({
    id: s.id,
    version: s.version_number,
    status: statusBadge(s.status || ""),
    active: s.active ? fmt.green("yes") : fmt.dim("no"),
    summary: truncate(s.summary || "", 60),
  }));
  printTable(rows, [
    { key: "id", title: "ID" },
    { key: "version", title: "Ver" },
    { key: "status", title: "Status" },
    { key: "active", title: "Active" },
    { key: "summary", title: "Summary" },
  ]);
}

async function cmdAssetsList(args) {
  const articleId = args._[1];
  if (!articleId) fail("assets:list requires an article id: postcraftstudio assets:list <article_id>");
  const { data } = await apiCall("GET", `/api/v1/articles/${articleId}/assets`);
  if (flagBool(args, "json")) return writeOut(JSON.stringify(data, null, 2));

  const textRows = (data.text_assets || []).map((a) => ({
    type: "text",
    id: a.id,
    asset_type: a.asset_type,
    status: statusBadge(a.status || ""),
    attached: "—",
    updated: a.updated_at ? a.updated_at.slice(0, 19).replace("T", " ") : "",
  }));
  const imageRows = (data.image_assets || []).map((a) => ({
    type: "image",
    id: a.id,
    asset_type: a.asset_type,
    status: statusBadge(a.status || ""),
    attached: a.attached ? fmt.green("yes") : fmt.dim("no"),
    updated: a.updated_at ? a.updated_at.slice(0, 19).replace("T", " ") : "",
  }));
  const rows = [...textRows, ...imageRows];
  printTable(rows, [
    { key: "type", title: "Kind" },
    { key: "id", title: "ID" },
    { key: "asset_type", title: "Asset type" },
    { key: "status", title: "Status" },
    { key: "attached", title: "Attached" },
    { key: "updated", title: "Updated" },
  ]);
  if (rows.length) {
    writeErr(fmt.dim(`download: postcraftstudio assets:download <text|image> <id> [--out path]`));
  }
}

const CONTENT_TYPE_EXTENSIONS = {
  "text/markdown": "md",
  "text/plain": "txt",
  "text/html": "html",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

function extensionForContentType(contentType) {
  if (!contentType) return "bin";
  const base = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS[base] || "bin";
}

function filenameFromContentDisposition(header) {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}

async function streamResponseToFile(response, filePath) {
  const writeStream = fs.createWriteStream(filePath);
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!writeStream.write(Buffer.from(value))) {
        await new Promise((resolve) => writeStream.once("drain", resolve));
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      writeStream.end((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function cmdAssetsDownload(args) {
  const assetType = args._[1];
  const assetId = args._[2];
  if (!assetType || !assetId) {
    fail("assets:download requires an asset type and id: postcraftstudio assets:download <text|image> <id> [--out path]");
  }
  if (assetType !== "text" && assetType !== "image") {
    fail(`asset type must be 'text' or 'image', got '${assetType}'.`);
  }

  const response = await rawRequest("GET", `/api/v1/assets/${assetType}/${assetId}/content`);
  if (!response.ok) {
    const data = await parseJsonSafe(response);
    const env = data && data.error ? data.error : {};
    throw new ApiError(env.message || `HTTP ${response.status}`, {
      status: response.status,
      type: env.type || null,
      details: env.details || null,
      requestId: env.request_id || null,
      retryAfter: response.headers.get("retry-after"),
    });
  }

  const contentType = response.headers.get("content-type") || "";
  const dispositionName = filenameFromContentDisposition(response.headers.get("content-disposition"));
  const ext = extensionForContentType(contentType);

  const outFlag = flagString(args, "out");
  const outPath = outFlag || dispositionName || `${assetType}-${assetId}.${ext}`;

  const dir = path.dirname(path.resolve(outPath));
  if (!fs.existsSync(dir)) fail(`output directory does not exist: ${dir}`);

  await streamResponseToFile(response, outPath);

  if (flagBool(args, "json")) {
    writeOut(JSON.stringify({ path: outPath, content_type: contentType.split(";")[0].trim() }, null, 2));
  } else {
    const size = fs.statSync(outPath).size;
    writeErr(fmt.green("✔ ") + `wrote ${size} bytes to ${fmt.bold(outPath)} ${fmt.dim("(" + contentType + ")")}`);
    writeOut(outPath);
  }
}

// ----------------------------------------------------------------------------
// config commands

async function cmdConfigShow() {
  const found = resolveApiKey();
  const baseUrl = resolveBaseUrl();
  const masked = found ? maskKey(found.key) : null;
  writeOut(JSON.stringify({ base_url: baseUrl, api_key: masked, source: found ? found.source : "none" }, null, 2));
}

function maskKey(key) {
  if (!key || key.length < 12) return "***";
  return key.slice(0, 9) + "…" + key.slice(-4);
}

// ----------------------------------------------------------------------------
// help / version

function printVersion() {
  writeOut(`postcraftstudio ${VERSION}`);
}

function printHelp() {
  const lines = [
    `${fmt.bold("postcraftstudio")} ${VERSION} — CLI for the Postcraftstudio API`,
    ``,
    `${fmt.bold("Usage:")} postcraftstudio <command> [options]`,
    ``,
    `${fmt.bold("Commands:")}`,
    `  setup                          Configure an API key (interactive)`,
    `  config:show                    Print current config (key is masked)`,
    `  articles:create                Create an article and (by default) wait for completion`,
    `    --body <md>                    Article body in Markdown`,
    `    --file <path>                  Read body from a file`,
    `    --source-url <url>             Server fetches the URL via Cloudflare`,
    `    --body-html <html>             Inline HTML to convert to Markdown`,
    `    --theme-slug <slug>            Theme override`,
    `    --writing-style-id <id>        Writing style override`,
    `    --article-purpose <text>       Purpose hint for the pipeline`,
    `    --main-idea <text>             Main-idea hint`,
    `    --title <text>                 Title override`,
    `    --generate <all|text|images>   What to generate (default all)`,
    `    --no-wait                      Return article id immediately, skip polling`,
    `    --timeout <seconds>            Polling timeout (default ${DEFAULT_TIMEOUT_SECONDS})`,
    `    --idempotency-key <uuid>       Reuse to dedup retries (default: fresh UUID)`,
    `    --auto-local-fetch             On 502 source_unreachable, retry from this machine`,
    `  articles:status <id>           Print article status + summary`,
    `  articles:get <id>              Print full article JSON`,
    `  articles:list [--cursor <id>]  Cursor-paginated article list`,
    `  themes:list                    List themes`,
    `  writing-styles:list            List writing styles`,
    `  assets:list <article_id>       List text and image assets for an article`,
    `  assets:download <type> <id>    Download an asset to disk (type: text|image)`,
    `    --out <path>                   Output path (default: server filename or <type>-<id>.<ext>)`,
    ``,
    `${fmt.bold("Global flags:")}`,
    `  --version, -v                  Print version`,
    `  --help, -h                     Print this help`,
    `  --json                         Emit JSON instead of formatted output`,
    ``,
    `${fmt.bold("Environment:")}`,
    `  POSTCRAFTSTUDIO_API_KEY        API key (overrides config files)`,
    `  POSTCRAFTSTUDIO_BASE_URL       Override API host (default ${DEFAULT_BASE_URL})`,
    ``,
    `${fmt.bold("Exit codes:")} 0 success · 1 runtime/network · 2 invalid input · 3 timeout · 4 article failed`,
    ``,
    `${fmt.bold("Docs:")} https://postcraftstudio.com/api/v1/docs`,
  ];
  writeOut(lines.join("\n"));
}

// ----------------------------------------------------------------------------
// Dispatch

async function main(argv) {
  const args = parseArgs(argv);

  if (args.flags.version || args.flags.v || args._[0] === "version") return printVersion();
  if (args.flags.help || args.flags.h || args._.length === 0 || args._[0] === "help") return printHelp();

  const command = args._[0];

  switch (command) {
    case "setup":
      return cmdSetup(args);
    case "config:show":
      return cmdConfigShow();

    case "articles:create":
      return cmdArticlesCreate(args);
    case "articles:status":
      return cmdArticlesStatus(args);
    case "articles:get":
      return cmdArticlesGet(args);
    case "articles:list":
      return cmdArticlesList(args);

    case "themes:list":
      return cmdThemesList(args);
    case "writing-styles:list":
      return cmdWritingStylesList(args);
    case "assets:list":
      return cmdAssetsList(args);
    case "assets:download":
      return cmdAssetsDownload(args);

    default:
      writeErr(fmt.red(`unknown command: ${command}`));
      writeErr(fmt.dim(`Run 'postcraftstudio --help' for the command list.`));
      process.exit(2);
  }
}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof ApiError) {
    fail(describeApiError(err));
  } else {
    writeErr(fmt.red("error: ") + (err && err.stack ? err.stack : String(err)));
    process.exit(1);
  }
});
