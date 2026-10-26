#!/usr/bin/env node
/**
 * ui-copy — heuristic checker for user-facing string catalogs.
 *
 * No dependencies, no code execution. Catalogs are read statically:
 * exported object literals are parsed from .ts/.js/.mjs/.cjs, and .json
 * catalogs are read directly. Function-valued entries are counted but
 * their bodies are not evaluated.
 *
 * Usage
 *   node scripts/check-copy.mjs src/copy/en.ts --profile consumer-plain
 *   node scripts/check-copy.mjs locales/en.json --profile professional-b2b
 *   node scripts/check-copy.mjs src/copy/en.ts --scan src --fail-on-scan
 *   node scripts/check-copy.mjs --help
 *
 * Exit codes
 *   0  no errors (warnings allowed unless --strict)
 *   1  errors found (or warnings with --strict, or scan hits with --fail-on-scan)
 *   2  usage or read failure
 *
 * This is a smoke alarm, not a proofreader. It cannot judge meaning, tone or
 * whether an error message is actually helpful. Use references/review-checklist.md
 * for that, and treat every finding as a prompt to look, not a verdict.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve, relative, sep } from "node:path";

/* -------------------------------------------------------------------------- */
/* profiles                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Keep in sync with references/profiles/*.md.
 * `banned` is the profile's own vocabulary blacklist, not the universal one.
 */
const PROFILES = {
  "consumer-plain": {
    label: "consumer / plain language",
    banned: [
      "metadata",
      "enrichment",
      "enriched",
      "enrich",
      "taxonomy",
      "cache",
      "cached",
      "endpoint",
      "payload",
      "schema",
      "idempotent",
      "normalise",
      "normalize",
      "sync",
      "user library",
      "home server",
      "instance",
      "api",
      "backend",
      "frontend",
      "repository",
      "repo",
      "config",
      "configure",
      "null",
      "undefined",
      "boolean",
      "json",
      "ssh",
      "localhost",
      "port forwarding",
    ],
    allowExclamation: false,
  },
  "professional-b2b": {
    label: "professional / B2B",
    banned: ["oops", "uh oh", "awesome", "gonna", "wanna", "stuff", "things", "magic", "simply", "easy"],
    allowExclamation: false,
  },
  "developer-tool": {
    label: "developer tool",
    banned: ["oops", "uh oh", "awesome", "simply", "easy", "magic", "stuff"],
    allowExclamation: false,
  },
  "regulated-sensitive": {
    label: "regulated / sensitive",
    banned: [
      "guarantee",
      "guaranteed",
      "risk-free",
      "risk free",
      "instantly",
      "instant",
      "cure",
      "revolutionary",
      "best-in-class",
      "world-class",
      "100%",
      "no risk",
      "completely safe",
      "peace of mind",
      "worry-free",
      "best",
    ],
    allowExclamation: false,
  },
  "safety-critical": {
    label: "safety critical",
    banned: ["oops", "uh oh", "just", "simply", "easy", "quick", "etc", "stuff", "things", "maybe", "probably"],
    allowExclamation: false,
  },
  "education-kids": {
    label: "education / children",
    banned: [
      "utilise",
      "utilize",
      "commence",
      "terminate",
      "approximately",
      "furthermore",
      "nevertheless",
      "regarding",
      "individuals",
      "personnel",
      "prior to",
      "in order to",
    ],
    allowExclamation: false,
  },
  "easy-read-accessibility": {
    label: "easy read / accessibility",
    banned: [
      "utilise",
      "utilize",
      "commence",
      "terminate",
      "approximately",
      "furthermore",
      "nevertheless",
      "however",
      "regarding",
      "individuals",
      "prior to",
      "in order to",
      "etc",
    ],
    allowExclamation: false,
  },
};

/** Rough budgets in characters. Warnings only: layout context decides. */
const DEFAULT_BUDGETS = {
  tab: 14,
  button: 22,
  label: 28,
  heading: 60,
  hint: 140,
  error: 180,
  empty: 200,
  body: 240,
  default: 160,
};

const VAGUE_COMMANDS = new Set(["ok", "okay", "yes", "no", "submit", "go"]);
const VAGUE_ERRORS = [
  /^something went wrong\b/i,
  /^an error occurred\b/i,
  /^error\.?$/i,
  /^failed\.?$/i,
  /^oops\b/i,
  /^unknown error\b/i,
];
const ACRONYMS = new Set([
  "API", "URL", "URI", "HTTP", "HTTPS", "PDF", "CSV", "JSON", "ID", "UI", "UX",
  "SMS", "ISBN", "EPUB", "MP3", "MP4", "AI", "TV", "OK", "CLI", "SDK", "CSV",
]);
const ALLOWED_CAPS = new Set([
  "API", "URL", "URI", "HTTP", "HTTPS", "PDF", "CSV", "JSON", "ID", "UI", "UX",
  "SMS", "ISBN", "EPUB", "MP3", "MP4", "AI", "TV", "CLI", "SDK",
]);

/* -------------------------------------------------------------------------- */
/* arguments                                                                   */
/* -------------------------------------------------------------------------- */

const HELP = `ui-copy check

Usage:
  node scripts/check-copy.mjs <catalog...> [options]

Catalogs:
  .json                    { "messages": {...} } or a flat key/value object
  .ts .js .mjs .cjs        exported object literals (read statically)

Options:
  --profile <id>           profile for the primary tier (default: consumer-plain)
  --operator-profile <id>  profile for operator/admin/internal tiers
  --scan <dir>             scan UI source for hardcoded string candidates
  --fail-on-scan           exit 1 when --scan finds candidates
  --config <file>          JSON overrides (budgets, banned words, ignores)
  --json                   machine-readable output
  --strict                 treat warnings as errors
  --max-issues <n>         cap printed issues (default: 200)
  --help                   this text

Profiles:
  ${Object.keys(PROFILES).join("\n  ")}

Config file shape:
  {
    "profiles": {
      "consumer-plain": {
        "bannedAdd": ["workspace"],
        "bannedRemove": ["api"],
        "allowExclamation": false
      }
    },
    "budgets": { "hint": 160 },
    "allowedDuplicates": ["Try again"],
    "ignoreKeys": ["copy.brand.*"],
    "scanIgnore": "^[a-z-]+$"
  }
`;

function parseArgs(argv) {
  const opts = {
    files: [],
    profile: "consumer-plain",
    operatorProfile: null,
    scan: null,
    failOnScan: false,
    config: null,
    json: false,
    strict: false,
    maxIssues: 200,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`Missing value for ${arg}`);
      return v;
    };
    const eq = arg.indexOf("=");
    const name = eq > -1 ? arg.slice(0, eq) : arg;
    const inline = eq > -1 ? arg.slice(eq + 1) : null;
    const take = () => (inline !== null ? inline : next());

    switch (name) {
      case "--profile":
        opts.profile = take();
        break;
      case "--operator-profile":
        opts.operatorProfile = take();
        break;
      case "--scan":
        opts.scan = take();
        break;
      case "--fail-on-scan":
        opts.failOnScan = true;
        break;
      case "--config":
        opts.config = take();
        break;
      case "--json":
        opts.json = true;
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--max-issues":
        opts.maxIssues = Number(take()) || 200;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        if (arg.startsWith("--")) fail(`Unknown option: ${arg}`);
        opts.files.push(arg);
    }
  }

  return opts;
}

function fail(message) {
  console.error(`ui-copy: ${message}`);
  process.exit(2);
}

/* -------------------------------------------------------------------------- */
/* tokenizer + object parser (static, no execution)                            */
/* -------------------------------------------------------------------------- */

function readQuoted(src, start) {
  const quote = src[start];
  let out = "";
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const e = src[i + 1];
      out += e === "n" ? "\n" : e === "t" ? "\t" : e ?? "";
      i += 2;
      continue;
    }
    if (c === quote) return [out, i + 1];
    if (c === "\n") return [out, i]; // unterminated: stop at the line
    out += c;
    i++;
  }
  return [out, i];
}

function readTemplate(src, start) {
  let out = "";
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      out += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === "`") return [out, i + 1];
    if (c === "$" && src[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < src.length && depth > 0) {
        const d = src[i];
        if (d === '"' || d === "'") {
          const [, next] = readQuoted(src, i);
          i = next;
          continue;
        }
        if (d === "`") {
          const [, next] = readTemplate(src, i);
          i = next;
          continue;
        }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        i++;
      }
      out += "X";
      continue;
    }
    out += c;
    i++;
  }
  return [out, i];
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const [value, next] = readQuoted(src, i);
      tokens.push({ type: "string", value });
      i = next;
      continue;
    }
    if (c === "`") {
      const [value, next] = readTemplate(src, i);
      tokens.push({ type: "template", value });
      i = next;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      tokens.push({ type: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: "number", value: src.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ type: "punct", value: c });
    i++;
  }
  return tokens;
}

function parseValue(tokens, i) {
  const t = tokens[i];
  if (!t) return { value: undefined, next: i };

  if (t.value === "{") return parseObject(tokens, i);
  if (t.value === "[") return parseArray(tokens, i);
  if (t.type === "string") return { value: t.value, next: i + 1 };
  if (t.type === "template") return { value: t.value, dynamic: true, next: i + 1 };

  // Function or expression: consume to the next depth-0 comma/bracket, then
  // take the last string/template it returns, if any.
  let depth = 0;
  let j = i;
  while (j < tokens.length) {
    const v = tokens[j].value;
    if (v === "(" || v === "{" || v === "[") depth++;
    else if (v === ")" || v === "}" || v === "]") {
      if (depth === 0) break;
      depth--;
    }
    if (v === "," && depth === 0) break;
    j++;
  }

  let value;
  for (let k = j - 1; k >= i; k--) {
    if (tokens[k].type === "template" || tokens[k].type === "string") {
      value = tokens[k].value;
      break;
    }
  }
  return { value, dynamic: true, next: j };
}

function parseArray(tokens, start) {
  const arr = [];
  let i = start + 1;
  while (i < tokens.length && tokens[i].value !== "]") {
    const { value, next } = parseValue(tokens, i);
    arr.push(value);
    i = next;
    if (tokens[i]?.value === ",") i++;
    else if (tokens[i]?.value !== "]") i++;
  }
  return { value: arr, next: i + 1 };
}

function parseObject(tokens, start) {
  const obj = {};
  let i = start + 1;
  while (i < tokens.length && tokens[i].value !== "}") {
    const keyToken = tokens[i];

    if (keyToken.value === "[") {
      // Computed key: skip the expression and its value.
      let depth = 1;
      i++;
      while (i < tokens.length && depth > 0) {
        if (tokens[i].value === "[") depth++;
        else if (tokens[i].value === "]") depth--;
        i++;
      }
      if (tokens[i]?.value === ":") {
        const { next } = parseValue(tokens, i + 1);
        i = next;
      }
      if (tokens[i]?.value === ",") i++;
      continue;
    }

    if (keyToken.type !== "ident" && keyToken.type !== "string" && keyToken.type !== "number") {
      i++;
      continue;
    }

    const key = keyToken.value;
    i++;

    if (tokens[i]?.value !== ":") {
      // Shorthand or method: skip to the next property.
      let depth = 0;
      while (i < tokens.length) {
        const v = tokens[i].value;
        if (v === "(" || v === "{" || v === "[") depth++;
        else if (v === ")" || v === "}" || v === "]") {
          if (depth === 0) break;
          depth--;
        }
        if (v === "," && depth === 0) break;
        i++;
      }
      if (tokens[i]?.value === ",") i++;
      continue;
    }

    i++; // skip ':'
    const { value, dynamic, next } = parseValue(tokens, i);
    if (value !== undefined) obj[key] = value;
    else if (dynamic) obj[key] = undefined;
    i = next;
    if (tokens[i]?.value === ",") i++;
  }
  return { value: obj, next: i + 1 };
}

/**
 * Find object-literal exports. Supports:
 *   export const copy = {...}
 *   export default {...}
 *   module.exports = {...}
 */
function parseExports(source) {
  const tokens = tokenize(source);
  const out = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.value === "export" && tokens[i + 1]?.value === "const") {
      const name = tokens[i + 2]?.value;
      if (typeof name !== "string") continue;

      // Support both `export const copy = {...}` and
      // `export const es: Copy = {...}` (type annotation before the equals).
      let eq = i + 3;
      while (eq < tokens.length && eq < i + 24 && tokens[eq].value !== "=") eq++;
      if (tokens[eq]?.value === "=" && tokens[eq + 1]?.value === "{") {
        const { value, next } = parseObject(tokens, eq + 1);
        out.push({ name, value });
        i = next - 1;
      }
      continue;
    }

    if (t.value === "export" && tokens[i + 1]?.value === "default" && tokens[i + 2]?.value === "{") {
      const { value, next } = parseObject(tokens, i + 2);
      out.push({ name: "default", value });
      i = next - 1;
      continue;
    }

    if (
      t.value === "module" &&
      tokens[i + 1]?.value === "." &&
      tokens[i + 2]?.value === "exports" &&
      tokens[i + 3]?.value === "=" &&
      tokens[i + 4]?.value === "{"
    ) {
      const { value, next } = parseObject(tokens, i + 4);
      out.push({ name: "default", value });
      i = next - 1;
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* catalog loading                                                             */
/* -------------------------------------------------------------------------- */

const CATALOG_NAME = /(copy|string|message|catalog|locale|i18n|l10n)/i;
const GLOSSARY_NAME = /glossary|terminology/i;

function loadFile(file) {
  const ext = extname(file).toLowerCase();
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    fail(`Cannot read ${file}: ${err.message}`);
  }

  if (ext === ".json") {
    let data;
    try {
      data = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch (err) {
      fail(`${file} is not valid JSON: ${err.message}`);
    }
    const glossary = data.glossary ?? null;
    const messages = data.messages ?? data;
    return { file, catalogs: [{ name: "messages", value: messages }], glossary };
  }

  if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    fail(`Unsupported catalog type: ${file} (use .json, .ts, .js, .mjs or .cjs)`);
  }

  const exports = parseExports(raw);
  const catalogs = [];
  let glossary = null;

  for (const entry of exports) {
    if (GLOSSARY_NAME.test(entry.name)) {
      glossary = entry.value;
      continue;
    }
    if (CATALOG_NAME.test(entry.name) || entry.name === "default") {
      catalogs.push(entry);
    }
  }

  if (catalogs.length === 0 && exports.length === 1) {
    // A locale file often exports a single object named after the language
    // (`export const es: Copy = {...}`). If the file was passed explicitly as
    // a catalog and there is exactly one object export, that is the catalog.
    catalogs.push(exports[0]);
  }

  if (catalogs.length === 0) {
    const names = exports.map((e) => e.name).join(", ") || "(none)";
    fail(
      `${file}: no catalog export found. Export a const whose name contains copy/strings/messages/locale, or use a .json catalog. Found: ${names}`,
    );
  }

  return { file, catalogs, glossary };
}

function isTierKey(key) {
  return /^(operator|admin|internal)$/i.test(key);
}

function flatten(value, path, tier, out) {
  if (typeof value === "string") {
    out.push({ path, value, tier, dynamic: false });
    return;
  }
  if (typeof value === "function") {
    out.push({ path, value: null, tier, dynamic: true, skipped: true });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, tier, out));
    return;
  }
  if (!value || typeof value !== "object") {
    out.push({ path, value: null, tier, dynamic: true, skipped: true });
    return;
  }

  // Translation catalog entry: { message, description }
  if (typeof value.message === "string") {
    out.push({
      path,
      value: value.message,
      tier,
      dynamic: value.message.includes("{"),
      description: value.description,
      fromJson: true,
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("$") || key.startsWith("_")) continue;
    const childTier = isTierKey(key) ? "operator" : tier;
    flatten(child, path ? `${path}.${key}` : key, childTier, out);
  }
}

function collectEntries(loaded, opts) {
  const entries = [];
  const skipped = [];

  for (const catalog of loaded.catalogs) {
    const tier = /operator|admin|internal/i.test(catalog.name) ? "operator" : "primary";
    const before = entries.length;
    flatten(catalog.value, catalog.name, tier, entries);
    for (let i = before; i < entries.length; i++) {
      if (entries[i].skipped) skipped.push(entries[i]);
    }
  }

  const glossary = normalizeGlossary(loaded.glossary);

  // Resolve profiles after tier assignment.
  for (const entry of entries) {
    entry.profile =
      entry.tier === "operator" && opts.operatorProfile ? opts.operatorProfile : opts.profile;
  }
  return { entries: entries.filter((e) => !e.skipped), skipped, glossary };
}

function normalizeGlossary(glossary) {
  const avoid = [];
  if (!glossary || typeof glossary !== "object") return avoid;

  for (const [concept, value] of Object.entries(glossary)) {
    if (!value || typeof value !== "object") continue;
    const term = value.term || value.use || concept;
    const list = value.avoid || value.never || [];
    for (const word of Array.isArray(list) ? list : [list]) {
      if (typeof word === "string" && word.trim()) avoid.push({ concept, term, word });
    }
  }
  return avoid;
}

/* -------------------------------------------------------------------------- */
/* checks                                                                      */
/* -------------------------------------------------------------------------- */

function plainText(message) {
  return renderIcu(message).replace(/\s+/g, " ").trim();
}

/** Split on commas that are not inside braces. */
function splitTopLevel(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "{") depth++;
    else if (inner[i] === "}") depth--;
    else if (inner[i] === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

/** Return [contents, index after the matching close brace]. */
function balanced(inner, open) {
  let depth = 0;
  for (let i = open; i < inner.length; i++) {
    if (inner[i] === "{") depth++;
    else if (inner[i] === "}") {
      depth--;
      if (depth === 0) return [inner.slice(open + 1, i), i + 1];
    }
  }
  return [inner.slice(open + 1), inner.length];
}

/** Render a best-effort plain-text sample of an ICU message. */
function renderIcu(message) {
  let out = "";
  let i = 0;

  while (i < message.length) {
    if (message[i] === "{") {
      const [inner, next] = balanced(message, i);
      const parts = splitTopLevel(inner);
      const kind = parts[1]?.trim();
      if (parts.length >= 3 && /^(plural|select|selectordinal)$/.test(kind ?? "")) {
        const branches = parts.slice(2).join(",");
        const bodies = [];
        let j = 0;
        while (j < branches.length) {
          if (branches[j] === "{") {
            const [body, after] = balanced(branches, j);
            bodies.push(renderIcu(body));
            j = after;
          } else {
            j++;
          }
        }
        out += bodies.join(" ");
      } else {
        out += "X";
      }
      i = next;
      continue;
    }
    out += message[i] === "#" ? "1" : message[i];
    i++;
  }

  return out;
}

function keyClass(path) {
  const k = path.toLowerCase();
  if (/(^|\.)(tab|tabs|nav|navigation)(\.|$)/.test(k)) return "tab";
  if (/(^|\.)(button|action|cta|submit)(\.|$)/.test(k)) return "button";
  if (/(^|\.)(label|placeholder)(\.|$)/.test(k)) return "label";
  if (/(^|\.)(heading|title|header)(\.|$)/.test(k)) return "heading";
  if (/(^|\.)(hint|help|helper|tip|description|intro)(\.|$)/.test(k)) return "hint";
  if (/(^|\.)(empty|none|noresults?|no_matches|nomatch)(\.|$)/.test(k)) return "empty";
  if (/(^|\.)(error|errors|failed|failure|invalid|warning|warn)(\.|$)/.test(k)) return "error";
  if (/(^|\.)(body|message|notification|summary)(\.|$)/.test(k)) return "body";
  return "default";
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function wordMatches(haystack, needle) {
  // Allow the regular plural on the final word: "item" also catches "items".
  // Custom boundaries so terms ending in a symbol ("100%") still match.
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?:s|es)?(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(haystack);
}

function checkEntry(entry, opts, config, seen) {
  const issues = [];
  const profile = PROFILES[entry.profile] || PROFILES[opts.profile];
  if (!profile) fail(`Unknown profile: ${entry.profile}`);

  const raw = entry.value;
  if (typeof raw !== "string") return issues;

  const text = plainText(raw);
  const isIcu = raw.includes("{");
  const cls = keyClass(entry.path);
  const add = (severity, code, message) =>
    issues.push({ severity, code, message, path: entry.path, file: entry.file });

  if (raw.trim() === "") add("error", "EMPTY", "empty string renders as an invisible gap");
  if (raw !== raw.trim()) add("error", "WHITESPACE", "leading or trailing whitespace");
  if (/\s{2,}/.test(raw)) add("warning", "WHITESPACE", "double space");
  if (/\.\.\./.test(raw)) add("error", "ELLIPSIS", 'use "…", not three dots');
  if (raw.includes("!") && !profile.allowExclamation && !config.allowExclamation) {
    add("error", "EXCLAMATION", "no exclamation marks in this profile");
  }
  if (wordMatches(text, "please")) add("error", "PLEASE", '"please" adds words, not politeness, in UI');
  if (/\b(click|tap|press)\s+here\b/i.test(text)) {
    add("error", "CLICK_HERE", "describe the destination, not the gesture");
  }
  if (/\(\s*s\s*\)/i.test(text) || /\b\w+\(s\)/i.test(text)) {
    add("error", "PLURAL_SHORTCUT", "use an ICU plural, not (s)");
  }
  if (VAGUE_COMMANDS.has(text.trim().toLowerCase())) {
    add("error", "VAGUE_COMMAND", `"${text.trim()}" is ambiguous; name the action`);
  }
  if (/<[a-z][^>]*>/i.test(text)) {
    add("error", "HTML", "no HTML in messages; use named placeholders or rich-text tags");
  }
  if (/\p{Extended_Pictographic}/u.test(raw)) {
    add("warning", "EMOJI", "emoji rarely survive translation or screen readers well");
  }

  for (const word of profile.banned) {
    if (wordMatches(text, word)) {
      add("error", "BANNED_WORD", `"${word}" is system vocabulary for ${entry.profile}`);
    }
  }

  if (cls === "error" && VAGUE_ERRORS.some((re) => re.test(text))) {
    add("warning", "VAGUE_ERROR", "says something failed but not what or how to recover");
  }

  const budget = config.budgets[cls] ?? DEFAULT_BUDGETS[cls];
  if (text.length > budget) {
    add("warning", "LENGTH", `${text.length} chars (${cls} budget ${budget})`);
  }

  if (["tab", "button", "label", "heading"].includes(cls) && /\.$/.test(text.trim())) {
    add("warning", "TRAILING_PERIOD", "labels, buttons and headings do not take a full stop");
  }

  if (["tab", "button", "label", "heading"].includes(cls) && /^[a-z]/.test(text.trim())) {
    add("warning", "SENTENCE_CASE", "starts lowercase; use sentence case");
  }

  if (["tab", "button", "heading"].includes(cls)) {
    const words = text.trim().split(/\s+/);
    const titleish = words.slice(1).filter((w) => /^[A-Z][a-z]/.test(w) && !ACRONYMS.has(w.replace(/[^\w]/g, "")));
    if (titleish.length >= 2) {
      add("warning", "TITLE_CASE", `looks like Title Case ("${titleish.join(" ")}"); use sentence case`);
    }
  }

  for (const match of text.matchAll(/\b[A-Z]{4,}\b/g)) {
    if (!ALLOWED_CAPS.has(match[0])) {
      add("warning", "ALL_CAPS", `"${match[0]}" is shouting; confirm it is an acronym`);
    }
  }

  if (isIcu && entry.fromJson && !entry.description) {
    add("warning", "TRANSLATOR_CONTEXT", "dynamic message has no translator description");
  }

  const normalized = text.trim();
  if (normalized.length > 24) {
    if (seen.has(normalized)) seen.get(normalized).push({ path: entry.path, file: entry.file });
    else seen.set(normalized, [{ path: entry.path, file: entry.file }]);
  }

  return issues;
}

function applyDuplicateCheck(seen, config) {
  const issues = [];
  for (const [value, refs] of seen) {
    if (refs.length < 2) continue;
    if (config.allowedDuplicates.has(value)) continue;
    issues.push({
      severity: "warning",
      code: "DUPLICATE",
      file: refs[0].file,
      path: refs.map((r) => r.path).join(", "),
      message: `same ${value.length}-char phrase in ${refs.length} places; one phrase, one entry`,
    });
  }
  return issues;
}

function applyGlossaryCheck(entries, glossary, config) {
  const issues = [];
  for (const { concept, term, word } of glossary) {
    for (const entry of entries) {
      if (config.ignoreKeys.some((re) => re.test(entry.path))) continue;
      if (wordMatches(plainText(entry.value), word)) {
        issues.push({
          severity: "warning",
          code: "GLOSSARY",
          path: entry.path,
          file: entry.file,
          message: `"${word}" for ${concept}; use "${term}"`,
        });
      }
    }
  }
  return issues;
}

function ignored(path, config) {
  return config.ignoreKeys.some((re) => re.test(path));
}

/* -------------------------------------------------------------------------- */
/* source scan                                                                 */
/* -------------------------------------------------------------------------- */

const ATTR_RE =
  /\b(aria-label|aria-description|aria-placeholder|alt|placeholder|title|contentDescription|accessibilityLabel|label|text|message)\s*=\s*(["'])((?:(?!\2).){1,200})\2/g;
const CALL_RE =
  /\b(?:Text|Label|Button|Alert|Notification|Toast|Snackbar|NSLocalizedString)\s*\(\s*(["'])((?:(?!\1).){1,200})\1/g;
const JSX_TEXT_RE = /(?<!=)>\s*([A-Za-z][^<>{}]{2,120})\s*(?=<\/?[A-Za-z])/g;

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".nuxt",
  ".svelte-kit", ".expo", ".turbo", "Pods", "__snapshots__", "vendor", "venv",
  ".venv", "target", "bin", "obj",
]);
const SKIP_FILE = /(\.test\.|\.spec\.|\.stories\.|\.d\.ts$|copy\.|strings\.|locales?\/|\.min\.|\.config\.)/i;
const SCAN_EXT = new Set([".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".html", ".dart", ".swift", ".kt"]);

function walk(dir, files) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile() && SCAN_EXT.has(extname(entry.name).toLowerCase())) {
      if (SKIP_FILE.test(full.split(sep).join("/"))) continue;
      files.push(full);
    }
  }
}

function looksLikeCopy(value) {
  const v = value.trim();
  if (v.length < 2 || v.length > 160) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  if (/[{}<>$`]/.test(v)) return false;
  if (/^(https?:\/\/|mailto:|#|\/)/.test(v)) return false;
  if (/^[a-z0-9._/-]+$/.test(v)) return false; // identifiers, classes, paths
  if (/^(true|false|null|undefined|NaN)$/i.test(v)) return false;
  if (/^(className|data-|aria-|style|key|id|type|name|role|href|src)/.test(v)) return false;
  if (/^-?\d+(\.\d+)?(px|rem|em|vh|vw|%|ms|s)?$/.test(v)) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return false;
  return true;
}

function scanSource(dir, config) {
  const absolute = resolve(dir);
  try {
    if (!statSync(absolute).isDirectory()) fail(`--scan path is not a directory: ${dir}`);
  } catch {
    fail(`--scan path not found: ${dir}`);
  }

  const files = [];
  walk(absolute, files);

  const issues = [];
  let scanned = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (source.length > 2_000_000) continue;
    const lines = source.split(/\r?\n/);
    scanned++;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (/\b(console\.|logger\.|log\.(debug|info|warn|error))/.test(line)) return;

      const check = (value, where) => {
        if (!looksLikeCopy(value)) return;
        if (config.scanIgnore && config.scanIgnore.test(value.trim())) return;
        issues.push({
          severity: "warning",
          code: "SCAN_CANDIDATE",
          file: relative(process.cwd(), file),
          path: `${relative(process.cwd(), file)}:${index + 1}`,
          message: `hardcoded ${where}: "${value.trim()}"`,
        });
      };

      for (const match of line.matchAll(ATTR_RE)) check(match[3], `attribute ${match[1]}`);
      for (const match of line.matchAll(CALL_RE)) check(match[2], "text argument");

      for (const match of line.matchAll(JSX_TEXT_RE)) {
        const value = match[1];
        if (/[=?:&|]/.test(value)) continue;
        check(value, "JSX text");
      }
    });
  }

  return { issues, scanned };
}

/* -------------------------------------------------------------------------- */
/* main                                                                        */
/* -------------------------------------------------------------------------- */

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (!PROFILES[opts.profile]) fail(`Unknown profile: ${opts.profile}`);
  if (opts.operatorProfile && !PROFILES[opts.operatorProfile]) {
    fail(`Unknown operator profile: ${opts.operatorProfile}`);
  }

  const config = {
    budgets: { ...DEFAULT_BUDGETS },
    allowedDuplicates: new Set(),
    ignoreKeys: [],
    scanIgnore: null,
    allowExclamation: false,
  };

  if (opts.config) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(opts.config, "utf8").replace(/^\uFEFF/, ""));
    } catch (err) {
      fail(`Cannot read config ${opts.config}: ${err.message}`);
    }
    for (const [name, override] of Object.entries(raw.profiles || {})) {
      if (!PROFILES[name]) fail(`Config names an unknown profile: ${name}`);
      const { bannedAdd = [], bannedRemove = [], ...rest } = override;
      const base = Array.isArray(rest.banned) ? [...rest.banned] : [...PROFILES[name].banned];
      for (const word of bannedAdd) if (!base.includes(word)) base.push(word);
      const banned = base.filter((word) => !bannedRemove.includes(word));
      PROFILES[name] = { ...PROFILES[name], ...rest, banned };
    }
    Object.assign(config.budgets, raw.budgets || {});
    for (const value of raw.allowedDuplicates || []) config.allowedDuplicates.add(value);
    for (const pattern of raw.ignoreKeys || []) {
      config.ignoreKeys.push(new RegExp(`^${String(pattern).replace(/\./g, "\\.").replace(/\*/g, ".*")}$`));
    }
    if (raw.scanIgnore) config.scanIgnore = new RegExp(raw.scanIgnore);
    if (raw.allowExclamation === true) config.allowExclamation = true;
  }

  if (opts.files.length === 0 && !opts.scan) fail("No catalog given. See --help.");

  const allIssues = [];
  const seen = new Map();
  let skippedDynamic = 0;
  let checked = 0;
  const files = [];

  for (const file of opts.files) {
    const loaded = loadFile(file);
    files.push(file);
    const { entries, skipped, glossary } = collectEntries(loaded, opts);
    skippedDynamic += skipped.length;

    const filtered = entries.filter((e) => !ignored(e.path, config));
    checked += filtered.length;
    for (const entry of filtered) {
      entry.file = file;
      allIssues.push(...checkEntry(entry, opts, config, seen));
    }
    allIssues.push(...applyGlossaryCheck(filtered, glossary, config));
  }

  // Duplicates are checked once, across every catalog, so a split catalog is
  // still one catalog.
  allIssues.push(...applyDuplicateCheck(seen, config));

  let scan = null;
  if (opts.scan) {
    scan = scanSource(opts.scan, config);
    allIssues.push(...scan.issues);
  }

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warning");

  if (opts.json) {
    const strictFailure = opts.strict && warnings.length > 0;
    const scanFailure = opts.failOnScan && scan !== null && scan.issues.length > 0;
    console.log(
      JSON.stringify(
        {
          ok: errors.length === 0 && !strictFailure && !scanFailure,
          profile: opts.profile,
          operatorProfile: opts.operatorProfile,
          files,
          checked,
          scannedFiles: scan ? scan.scanned : 0,
          unresolvedDynamic: skippedDynamic,
          errors: errors.length,
          warnings: warnings.length,
          issues: allIssues,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `ui-copy: profile ${opts.profile}` +
        (opts.operatorProfile ? ` · operator ${opts.operatorProfile}` : ""),
    );

    const printed = allIssues.slice(0, opts.maxIssues);
    let currentFile = null;
    for (const issue of printed) {
      if (issue.file !== currentFile) {
        currentFile = issue.file;
        console.log(`\n${currentFile || "(catalog)"}`);
      }
      const tag = issue.severity === "error" ? "ERROR" : "WARN ";
      console.log(`  ${tag} ${issue.path}  [${issue.code}] ${issue.message}`);
    }

    if (allIssues.length > printed.length) {
      console.log(`\n  … ${allIssues.length - printed.length} more issue(s), use --max-issues`);
    }

    console.log(
      `\n${checked} string${checked === 1 ? "" : "s"} checked · ` +
        `${errors.length} error(s), ${warnings.length} warning(s), ` +
        `${skippedDynamic} unresolved dynamic entr${skippedDynamic === 1 ? "y" : "ies"}` +
        (scan ? ` · ${scan.scanned} source file(s) scanned` : ""),
    );
  }

  if (errors.length > 0) process.exit(1);
  if (opts.strict && warnings.length > 0) process.exit(1);
  if (opts.failOnScan && scan && scan.issues.length > 0) process.exit(1);
}

main();
