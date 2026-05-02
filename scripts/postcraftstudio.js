#!/usr/bin/env node

/**
 * Postcraftstudio CLI — drives the Postcraftstudio API for article generation,
 * asset retrieval, and discovery from a Claude skill or any shell.
 *
 * Zero runtime dependencies. Built-ins only: fetch, fs, path, os, readline.
 * Runs on Node 18+ and Bun.
 *
 * API docs: https://postcraftstudio.com/api/v1/docs
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

const VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://postcraftstudio.com";
const SETTINGS_URL = "https://postcraftstudio.com/settings/api_keys";
const API_KEY_PATTERN = /^pcs_live_[A-Za-z0-9]{32}$/;
const TOKEN_PROBE_PATH = "/api/v1/themes";

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

async function apiRequest(method, endpoint, { body = null, apiKey = null, headers = {} } = {}) {
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
  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new ApiError(`Network error contacting ${url}: ${err.message}`, { network: true });
  }
  return response;
}

class ApiError extends Error {
  constructor(message, { status = null, body = null, network = false } = {}) {
    super(message);
    this.status = status;
    this.body = body;
    this.network = network;
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

// ----------------------------------------------------------------------------
// Readline prompts

function prompt(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (silent) {
      // Mute echo for paste-the-token UX.
      const onData = () => {};
      process.stdin.on("data", onData);
      rl.question(question, (answer) => {
        process.stdin.off("data", onData);
        rl.close();
        process.stderr.write("\n");
        resolve(answer.trim());
      });
      // eslint-disable-next-line no-underscore-dangle
      rl._writeToOutput = (str) => {
        if (str.includes(question)) process.stderr.write(str);
        else process.stderr.write("");
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
// setup command

async function cmdSetup(args) {
  writeErr(fmt.bold("Postcraftstudio setup"));
  writeErr("");
  writeErr(`Generate or copy a key at ${fmt.cyan(SETTINGS_URL)}`);
  writeErr(`Token format: ${fmt.dim("pcs_live_<32 alphanumeric characters>")}`);
  writeErr("");

  const baseFromFlag = args.flags["base-url"];
  const baseUrl = (typeof baseFromFlag === "string" && baseFromFlag) || (await prompt(`Base URL [${DEFAULT_BASE_URL}]: `)) || DEFAULT_BASE_URL;
  const normalizedBase = baseUrl.replace(/\/$/, "");

  const keyFromFlag = args.flags["api-key"];
  let apiKey = typeof keyFromFlag === "string" ? keyFromFlag.trim() : "";
  if (!apiKey) {
    apiKey = (await prompt("Paste API key: ", { silent: true })).trim();
  }

  if (!API_KEY_PATTERN.test(apiKey)) {
    fail(
      `That doesn't look like a Postcraftstudio key. Expected format: ${fmt.dim("pcs_live_")}` +
        `<32 alphanumeric>. Get a fresh key at ${SETTINGS_URL}`,
    );
  }

  writeErr(fmt.dim(`Probing ${normalizedBase}${TOKEN_PROBE_PATH} to validate the token...`));

  const previousBase = process.env.POSTCRAFTSTUDIO_BASE_URL;
  process.env.POSTCRAFTSTUDIO_BASE_URL = normalizedBase;
  let response;
  try {
    response = await apiRequest("GET", TOKEN_PROBE_PATH, { apiKey });
  } catch (err) {
    if (previousBase === undefined) delete process.env.POSTCRAFTSTUDIO_BASE_URL;
    else process.env.POSTCRAFTSTUDIO_BASE_URL = previousBase;
    fail(err.message);
  }
  if (previousBase === undefined) delete process.env.POSTCRAFTSTUDIO_BASE_URL;
  else process.env.POSTCRAFTSTUDIO_BASE_URL = previousBase;

  if (response.status === 401) {
    fail(`The API rejected this key (HTTP 401). Get a fresh key at ${SETTINGS_URL} and try again.`);
  }
  if (!response.ok) {
    const body = await parseJsonSafe(response);
    const detail = body && body.error && body.error.message ? body.error.message : `HTTP ${response.status}`;
    fail(`Probe failed: ${detail}`);
  }

  const useProject = args.flags.project === true || args.flags.project === "true";
  const useGlobal = args.flags.global === true || args.flags.global === "true";
  let scope;
  if (useProject && useGlobal) fail("Pass either --project or --global, not both.");
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
    `  articles:create                Create an article ${fmt.dim("(U16 — pending)")}`,
    `  articles:status <id>           Print article status ${fmt.dim("(U16 — pending)")}`,
    `  articles:get <id>              Print full article JSON ${fmt.dim("(U16 — pending)")}`,
    `  articles:list                  List articles ${fmt.dim("(U16 — pending)")}`,
    `  themes:list                    List themes ${fmt.dim("(U17 — pending)")}`,
    `  writing-styles:list            List writing styles ${fmt.dim("(U17 — pending)")}`,
    `  assets:list <article_id>       List assets for an article ${fmt.dim("(U17 — pending)")}`,
    `  assets:download <type> <id>    Download an asset to disk ${fmt.dim("(U17 — pending)")}`,
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
    `${fmt.bold("Docs:")} https://postcraftstudio.com/api/v1/docs`,
  ];
  writeOut(lines.join("\n"));
}

function notImplementedYet(unit, command) {
  writeErr(fmt.yellow(`'${command}' is planned for ${unit} and not implemented yet.`));
  writeErr(fmt.dim(`Track progress in docs/plans/agent-skills-and-api-plan.md.`));
  process.exit(2);
}

// ----------------------------------------------------------------------------
// Dispatch

async function main(argv) {
  const args = parseArgs(argv);

  if (args.flags.version || args.flags.v || args._[0] === "version") {
    return printVersion();
  }
  if (args.flags.help || args.flags.h || args._.length === 0 || args._[0] === "help") {
    return printHelp();
  }

  const command = args._[0];

  switch (command) {
    case "setup":
      return cmdSetup(args);
    case "config:show":
      return cmdConfigShow();

    case "articles:create":
    case "articles:status":
    case "articles:get":
    case "articles:list":
      return notImplementedYet("U16", command);

    case "themes:list":
    case "writing-styles:list":
    case "assets:list":
    case "assets:download":
      return notImplementedYet("U17", command);

    default:
      writeErr(fmt.red(`unknown command: ${command}`));
      writeErr(fmt.dim(`Run 'postcraftstudio --help' for the command list.`));
      process.exit(2);
  }
}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof ApiError) {
    fail(err.message);
  } else {
    writeErr(fmt.red("error: ") + (err && err.stack ? err.stack : String(err)));
    process.exit(1);
  }
});
