#!/usr/bin/env node
// Render shared sources into the three target plugin formats.
// Run: node scripts/build-plugins.mjs (or `npm run build:plugins`)
//
// Sources of truth:
//   shared/INSTRUCTIONS.md     — agent guidance body
//   shared/commands/*.md       — slash commands with Claude-style frontmatter
//
// Targets:
//   Root SKILL.md, skills/postcraftstudio/SKILL.md   — Anthropic skill format
//   codex/AGENTS.md, codex/prompts/*.md              — Codex CLI
//   opencode/agent/postcraftstudio.md, opencode/command/*.md — OpenCode
//   commands/*.md                                    — Claude Code plugin commands

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(readFileSync(join(root, "shared/meta.json"), "utf8"));
const today = meta.lastUpdated;

// ----- Instructions -----

const body = readFileSync(join(root, "shared/INSTRUCTIONS.md"), "utf8");

const skillFrontmatter = `---
name: postcraftstudio
description: >
  Create articles and retrieve their generated text/image assets via the
  Postcraftstudio API. ALWAYS use this skill when asked to generate, fetch,
  list, or download Postcraftstudio articles, themes, writing styles, or
  associated text/image assets.
last-updated: ${today}
allowed-tools: Bash(./scripts/postcraftstudio.js:*)
---

# Postcraftstudio Skill

`;

const plainHeader = `# Postcraftstudio

`;

const instructionTargets = [
  { path: "SKILL.md", header: skillFrontmatter },
  { path: "skills/postcraftstudio/SKILL.md", header: skillFrontmatter },
  { path: "codex/AGENTS.md", header: plainHeader },
  { path: "opencode/agent/postcraftstudio.md", header: plainHeader },
];

for (const { path, header } of instructionTargets) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), header + body);
  console.log(`wrote ${path}`);
}

// ----- Commands -----

const cmdSrcDir = join(root, "shared/commands");
const cmdFiles = readdirSync(cmdSrcDir).filter((f) => f.endsWith(".md"));

const frontmatterRe = /^---\n([\s\S]*?)\n---\n+/;

function parse(source) {
  const m = source.match(frontmatterRe);
  if (!m) return { fm: {}, body: source };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const eq = line.indexOf(":");
    if (eq === -1) continue;
    fm[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return { fm, body: source.slice(m[0].length) };
}

const targets = {
  // Claude Code plugin: keep Claude frontmatter + $ARGUMENTS as-is.
  "commands": (src) => src,

  // Codex prompts: plain Markdown, no frontmatter. $ARGUMENTS works natively.
  "codex/prompts": (src) => {
    const { fm, body } = parse(src);
    const prelude = fm.description ? `> ${fm.description}\n\n` : "";
    return prelude + body;
  },

  // OpenCode commands: frontmatter supported; keep description, drop argument-hint.
  "opencode/command": (src) => {
    const { fm, body } = parse(src);
    const lines = ["---"];
    if (fm.description) lines.push(`description: ${fm.description}`);
    lines.push("---", "", body);
    return lines.join("\n");
  },
};

for (const [dir, transform] of Object.entries(targets)) {
  mkdirSync(join(root, dir), { recursive: true });
  for (const f of cmdFiles) {
    const src = readFileSync(join(cmdSrcDir, f), "utf8");
    writeFileSync(join(root, dir, f), transform(src));
    console.log(`wrote ${dir}/${f}`);
  }
}
