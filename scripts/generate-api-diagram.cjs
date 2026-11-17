/**
 * Generates docs/diagrams/api.svg — the complete API reference diagram.
 *
 * Hand-laid SVG for ~135 routes is not maintainable, so the layout is
 * computed here. Route data transcribed from the source on 2026-11-17
 * (family listener: server/src/app.ts + routes/*; admin listener:
 * server/src/admin/*.ts; see README_technical.md for the overview).
 * When routes change, update the data below and re-run:
 *
 *   node scripts/generate-api-diagram.cjs
 */
const fs = require('fs');

const MCOL = { GET: '#34d399', POST: '#60a5fa', PUT: '#fbbf24', PATCH: '#fbbf24', DELETE: '#f87171', ALL: '#c084fc' };
const ACOL = { public: '#94a3b8', session: '#7dd3fc', profile: '#5eead4', admin: '#fb923c', panel: '#c084fc', media: '#f472b6' };

const GROUPS = [
  {
    title: 'PUBLIC — STATIC & HEALTH',
    note: 'No session. Served identically on both listeners.',
    routes: [
      ['GET', '/api/health', 'Liveness probe -> {status:"ok"} (render.yaml healthCheckPath)', 'public'],
      ['GET', '/api/config', 'Account experience + which OAuth providers are enabled', 'public'],
      ['GET', '/privacy', 'GDPR privacy notice (unauthenticated HTML)', 'public'],
      ['GET', '/api/auth/providers', 'Enabled OAuth providers + email sign-up flags', 'public'],
      ['ALL', '/assets/*, /*', 'Built client from client/dist (immutable hashed assets, index.html revalidates); unknown non-/api paths fall back to the SPA; misses -> 404 JSON', 'public'],
    ],
  },
  {
    title: 'AUTH — SESSIONS & SIGN-IN',
    note: 'Household mode: shared password, per-profile sessions. Demo mode: email + OAuth.',
    routes: [
      ['POST', '/api/auth/login', 'Household / profile / email sign-in; sets house_session cookie', 'public'],
      ['POST', '/api/auth/logout', 'Revokes the token and clears the cookie', 'public'],
      ['GET', '/api/auth/session', 'Current session context (role, profile, expiry)', 'session'],
      ['POST', '/api/auth/password', 'Change your own password', 'session'],
      ['POST', '/api/auth/register-profile', 'Self-register a profile with the household password (404 in demo)', 'public'],
      ['POST', '/api/auth/claim', 'Claim an unclaimed profile with the household password (404 in demo)', 'public'],
      ['GET', '/api/auth/accounts', "List sign-in accounts for the account picker (404 in demo)", 'public'],
      ['POST', '/api/auth/signup', 'Email sign-up — demo / email-signup deployments only', 'public'],
      ['POST', '/api/auth/claim', '(see above)', 'skip'],
    ],
  },
  {
    title: 'AUTH — DEVICES (BIOMETRICS, ANDROID)',
    note: 'Device credentials are long-lived, biometric-gated secrets issued once at enrolment.',
    routes: [
      ['POST', '/api/auth/devices/link', 'Attach the caller’s session to a device credential', 'profile'],
      ['POST', '/api/auth/devices', 'Enrol a new device credential', 'profile'],
      ['GET', '/api/auth/devices', 'List your device credentials', 'profile'],
      ['DELETE', '/api/auth/devices/:id', 'Revoke a device credential', 'profile'],
      ['POST', '/api/auth/devices/session', 'Exchange a device secret for a session (biometric re-auth; 404 in demo)', 'public'],
    ],
  },
  {
    title: 'AUTH — PASSKEYS (WEBAUTHN)',
    note: 'Registration needs a profile session; login is public and rate-limited per IP/profile.',
    routes: [
      ['POST', '/api/auth/passkeys/login/options', 'Issue a login challenge (rate-limited)', 'public'],
      ['POST', '/api/auth/passkeys/login/verify', 'Verify assertion, mint a session', 'public'],
      ['POST', '/api/auth/passkeys/register/options', 'Issue a registration challenge', 'profile'],
      ['POST', '/api/auth/passkeys/register/verify', 'Verify attestation, store the credential', 'profile'],
      ['GET', '/api/auth/passkeys', 'List your passkeys', 'profile'],
      ['DELETE', '/api/auth/passkeys/:id', 'Delete your passkey', 'profile'],
    ],
  },
  {
    title: 'AUTH — SESSIONS & ADMIN RECOVERY',
    note: 'Device-scoped and individual session revocation; admin recovery actions.',
    routes: [
      ['GET', '/api/auth/sessions', 'List your signed-in sessions/devices', 'session'],
      ['DELETE', '/api/auth/sessions/:id', 'Revoke one session', 'session'],
      ['DELETE', '/api/auth/sessions/device/:key', 'Revoke every session on one device', 'session'],
      ['DELETE', '/api/auth/sessions/others', 'Revoke all your other sessions', 'session'],
      ['POST', '/api/auth/accounts/:id/reset', 'Admin reset of a profile’s password (404 in demo)', 'admin'],
      ['POST', '/api/auth/accounts/:id/unlock', 'Admin unlock of a locked profile', 'admin'],
    ],
  },
  {
    title: 'AUTH — OAUTH (DEMO / PRODUCTION)',
    note: 'PKCE + state cookies; native Android uses a one-time handoff code.',
    routes: [
      ['GET', '/api/auth/:provider/authorize', 'Start Google/GitHub OAuth (callback: /callback)', 'public'],
      ['GET', '/api/auth/:provider/callback', 'OAuth callback — mints a session or a one-time handoff', 'public'],
      ['POST', '/api/auth/oauth/handoff', 'Native-app exchange: one-time code -> session', 'public'],
    ],
  },
  {
    title: 'MEDIA — STREAMING & COVERS',
    note: 'Tokens or sessions; `<audio>` cannot send headers, so media URLs carry a 5-minute scoped bearer instead.',
    routes: [
      ['POST', '/api/auth/media-token', 'Issue a 5-min profile-scoped `?media=` bearer for one cover/book/track', 'profile'],
      ['GET', '/api/audiobooks/:id/cover', 'Cover image (conditional GET, MIME whitelist, ETag)', 'session | media'],
      ['GET', '/api/audiobooks/:id/stream', 'Whole-book audio stream with range support', 'session | media'],
      ['GET', '/api/tracks/:id/stream', 'Single track stream with range support (416 on bad ranges)', 'session | media'],
    ],
  },
  {
    title: 'LIBRARY — SHELF & SCAN',
    note: 'Per-profile, age-gated shelf; scanning is admin-only and 404s in demo.',
    routes: [
      ['GET', '/api/audiobooks', 'Caller’s shelf (age-gated, capped by MAX_LIBRARY_ITEMS, conditional)', 'session'],
      ['GET', '/api/server-library', 'Whole server library with inLibrary flag', 'session'],
      ['GET', '/api/audiobooks/:id', 'One book’s detail (age-visibility enforced)', 'session'],
      ['POST', '/api/audiobooks/:id/library', 'Add the book to your shelf', 'profile'],
      ['DELETE', '/api/audiobooks/:id/library', 'Remove the book from your shelf', 'profile'],
      ['POST', '/api/scan', 'Start scan + enrichment (404 in demo)', 'admin'],
      ['GET', '/api/scan/status', 'Scan progress per root (404 in demo)', 'admin'],
      ['GET', '/api/library-roots', 'List library roots + scan state, paths stripped (404 in demo)', 'admin'],
      ['POST', '/api/library-roots', 'Upsert a library root (404 in demo)', 'admin'],
      ['DELETE', '/api/library-roots/:id', 'Delete a library root (404 in demo)', 'admin'],
    ],
  },
  {
    title: 'ENRICHMENT — CANDIDATES & RUNS',
    note: 'Best-effort provider chain; members may apply matches for unapplied books, admins can force runs.',
    routes: [
      ['POST', '/api/audiobooks/:id/enrich', 'Single-book enrichment via the chain (404 in demo)', 'session'],
      ['POST', '/api/enrichment/run', 'Enqueue a (re)enrichment run (404 in demo)', 'admin'],
      ['GET', '/api/enrichment/status', 'Enrichment run status (404 in demo)', 'admin'],
      ['GET', '/api/enrichment/review-queue', 'Low-confidence review backlog (404 in demo)', 'admin'],
    ],
  },
  {
    title: 'METADATA — TAGS & OVERRIDE',
    note: 'Manual edits are admin-only; overrides always win over enrichment/scanner writes (ADR 028).',
    routes: [
      ['GET', '/api/audiobooks/:id/candidates', 'Stored candidates, score-ordered, internals stripped', 'session'],
      ['POST', '/api/audiobooks/:id/metadata', 'Apply a stored candidate (members) or manual edit incl. cover URL (admin)', 'session'],
      ['GET', '/api/audiobooks/:id/tags', 'Full tag suite with provenance', 'session'],
      ['PUT', '/api/audiobooks/:id/tags', 'Replace the tag suite; records overrides (404 in demo)', 'admin'],
      ['POST', '/api/audiobooks/:id/metadata/reset', 'Clear a book’s field overrides, re-queue (404 in demo)', 'admin'],
      ['POST', '/api/metadata/reset-all', 'Clear ALL overrides, re-queue everything', 'admin'],
      ['PUT', '/api/audiobooks/:id/tracks/:n/title', 'Set/clear one chapter-title override', 'session'],
      ['POST', '/api/audiobooks/:id/ai-suggest', 'LM Studio best-match suggestion (404 in demo)', 'admin'],
    ],
  },
  {
    title: 'TAXONOMY — GENRES & TAGS',
    note: 'Curated tree; admins mutate; the catch-all genre is undeletable.',
    routes: [
      ['GET', '/api/genres', 'Genre tree with age-scoped book counts', 'session'],
      ['POST', '/api/genres', 'Create a genre (404 in demo)', 'admin'],
      ['PATCH', '/api/genres/:id', 'Rename / reparent a genre (404 in demo)', 'admin'],
      ['DELETE', '/api/genres/:id', 'Delete a genre (404 in demo)', 'admin'],
      ['GET', '/api/tags', 'List custom tags with age-scoped counts', 'session'],
      ['POST', '/api/tags', 'Create a tag (404 in demo)', 'admin'],
      ['PATCH', '/api/tags/:id', 'Rename a tag (404 in demo)', 'admin'],
      ['DELETE', '/api/tags/:id', 'Delete a tag and its assignments (404 in demo)', 'admin'],
      ['POST', '/api/tags/:id/merge', 'Merge a tag into another (404 in demo)', 'admin'],
    ],
  },
  {
    title: 'DISCOVER & WISHLIST',
    note: 'Recommendations are tag-similarity; the buy sheet rate-limits to 30 req/min per profile.',
    routes: [
      ['GET', '/api/discover/similar/:id', 'Similar books for a seed', 'session'],
      ['GET', '/api/discover/for-me', 'Recommendations for your profile', 'profile'],
      ['GET', '/api/wishlist', 'Your wishlist', 'profile'],
      ['POST', '/api/wishlist', 'Add a metadata-only wishlist entry', 'profile'],
      ['DELETE', '/api/wishlist/:id', 'Remove your wishlist entry', 'profile'],
      ['PUT', '/api/wishlist/:id/owned', 'Mark your entry owned', 'profile'],
      ['GET', '/api/buy-context', 'LibriVox match for the “get this book” sheet (rate-limited)', 'profile'],
    ],
  },
  {
    title: 'PROGRESS & HISTORY',
    note: 'Last-write-wins on the server; the client only pushes strictly-newer positions on reconnect (spec 44).',
    routes: [
      ['GET', '/api/audiobooks/:id/progress', 'Your resume position', 'profile'],
      ['PUT', '/api/audiobooks/:id/progress', 'Save position/completed (clamped to duration)', 'profile'],
      ['POST', '/api/audiobooks/:id/sessions', 'Record a play session', 'profile'],
      ['GET', '/api/history', 'Last 100 play sessions (child-filtered)', 'profile'],
    ],
  },
  {
    title: 'PROFILES & FAVOURITES',
    note: 'Profile CRUD is admin-only; favourites are yours alone.',
    routes: [
      ['GET', '/api/profiles', 'List profiles (picker; 403 for non-admin, 404 in demo)', 'session'],
      ['POST', '/api/profiles', 'Create a profile (404 in demo)', 'admin'],
      ['DELETE', '/api/profiles/:id', 'Erase a profile and all its personal data (404 in demo)', 'admin'],
      ['PUT', '/api/audiobooks/:id/favourite', 'Favourite a book', 'profile'],
      ['DELETE', '/api/audiobooks/:id/favourite', 'Unfavourite (idempotent)', 'profile'],
      ['GET', '/api/favourites', 'Your favourited books (child-filtered)', 'profile'],
      ['GET', '/api/favourites/ids', 'Plain id set for list views', 'profile'],
    ],
  },
  {
    title: 'GDPR — YOUR DATA',
    note: 'Self-service access, rectification, erasure (Art. 15–18, 20); hashed secrets never leave the server.',
    routes: [
      ['GET', '/api/me/export', 'Art. 15/20 export (JSON)', 'profile'],
      ['PATCH', '/api/me', 'Art. 16 rectify your name/colour', 'profile'],
      ['DELETE', '/api/me', 'Art. 17 erase your account and all personal data', 'profile'],
      ['DELETE', '/api/me/listening-history/:historyId', 'Delete one history entry', 'profile'],
      ['DELETE', '/api/me/favourites/:mediaItemId', 'Remove one favourite', 'profile'],
    ],
  },
  {
    title: 'ADMIN — AUTH (PANEL)',
    note: 'Second listener on :3100, loopback-only by default. Cookie is SameSite=Strict, 8 h TTL.',
    routes: [
      ['GET', '/api/health', 'Admin liveness + adminConfigured flag (port 3100)', 'public'],
      ['GET', '/api/admin/config', 'Whether the admin credential is seeded', 'public'],
      ['POST', '/api/admin/login', 'Panel sign-in (rate-limited 10/5 min/IP)', 'public'],
      ['GET', '/api/admin/session', 'Check panel session validity', 'panel'],
      ['POST', '/api/admin/logout', 'Revoke panel session', 'public'],
      ['ALL', '/, /assets/*', 'Admin SPA from client/admin-dist; unknown non-/api paths fall back to it; misses -> 404 JSON', 'public'],
    ],
  },
  {
    title: 'ADMIN — STATUS & STORAGE',
    note: 'Read-only dashboard plus operator storage controls.',
    routes: [
      ['GET', '/api/admin/status', 'Roots, counts, enrichment, storage, DB type, CORS, uptime', 'panel'],
      ['POST', '/api/admin/storage/upload-url', 'Signed Supabase upload URL for a book file', 'panel'],
      ['GET', '/api/admin/storage/status', 'Storage sync state', 'panel'],
      ['POST', '/api/admin/storage/sync', 'Start library → storage sync (202/409)', 'panel'],
    ],
  },
  {
    title: 'ADMIN — LIBRARY CONTROLS',
    note: 'Mirrors the family listener’s admin-gated scan surface for the operator.',
    routes: [
      ['GET', '/api/admin/library-roots', 'Roots + scan state (paths included — operator only)', 'panel'],
      ['POST', '/api/admin/library-roots', 'Upsert a root', 'panel'],
      ['DELETE', '/api/admin/library-roots/:id', 'Delete a root', 'panel'],
      ['POST', '/api/admin/scan', 'Start scan + enrichment', 'panel'],
      ['GET', '/api/admin/scan/status', 'Scan progress per root', 'panel'],
    ],
  },
  {
    title: 'ADMIN — DB EXPLORER & API DOCS',
    note: 'Allowlisted read-only access; secrets stripped; queries row-capped.',
    routes: [
      ['GET', '/api/admin/db/tables', 'Allowlisted table row counts', 'panel'],
      ['GET', '/api/admin/db/tables/:table', 'Paged browse of a table (secret columns stripped)', 'panel'],
      ['POST', '/api/admin/db/query', 'Read-only SQL, validated, row-capped, result redacted', 'panel'],
      ['GET', '/api/admin/api-docs', 'Route inventory of both listeners (generated from live schemas)', 'panel'],
    ],
  },
  {
    title: 'ADMIN — KIDS ACCOUNTS (SPEC 38)',
    note: 'Age bands, never DOBs; kids see only age-appropriate books (404 everywhere else).',
    routes: [
      ['GET', '/api/admin/kids-accounts', 'List kids accounts with library counts', 'panel'],
      ['POST', '/api/admin/kids-accounts', 'Create a kids account', 'panel'],
      ['PATCH', '/api/admin/kids-accounts/:id', 'Rename / re-band / disable', 'panel'],
      ['DELETE', '/api/admin/kids-accounts/:id', 'Erase a kids account', 'panel'],
      ['POST', '/api/admin/kids-accounts/:id/reset-password', 'Reset a kids account’s password', 'panel'],
      ['POST', '/api/admin/kids-accounts/:id/fill-shelf', 'Shelve all age-appropriate books', 'panel'],
    ],
  },
  {
    title: 'ADMIN — AGE RATINGS & BLOCKLIST',
    note: 'Providers suggest ages; a human confirms. Blocklist applies everywhere including media URLs.',
    routes: [
      ['GET', '/api/admin/age-ratings/books', 'Search books by title/author (max 50)', 'panel'],
      ['GET', '/api/admin/age-ratings/review', 'Books with provider-suggested minimumAge', 'panel'],
      ['POST', '/api/admin/age-ratings/set', 'Confirm rating 0/4/7/9/12/16/null', 'panel'],
      ['POST', '/api/admin/age-ratings/confirm', 'Accept the suggested rating', 'panel'],
      ['POST', '/api/admin/age-ratings/dismiss', 'Dismiss the suggested rating', 'panel'],
      ['GET', '/api/admin/genre-blocklist', 'Blocklisted genres with counts', 'panel'],
      ['GET', '/api/admin/genre-blocklist/options', 'Unblocked candidates (max 20)', 'panel'],
      ['POST', '/api/admin/genre-blocklist', 'Blocklist a genre', 'panel'],
      ['DELETE', '/api/admin/genre-blocklist/:genreId', 'Unblocklist a genre', 'panel'],
    ],
  },
  {
    title: 'ADMIN — PROXY SHIM (FAMILY PORT)',
    note: 'Only when ADMIN_PROXY=true (Render demo). Otherwise 404 — panel unreachable from the family listener.',
    routes: [
      ['ALL', '/admin, /admin/*', 'Reverse-proxy to loopback :3100 admin SPA', 'public-shim'],
      ['ALL', '/api/admin, /api/admin/*', 'Reverse-proxy to loopback :3100 admin API', 'public-shim'],
    ],
  },
];

// Drop sentinel entries
for (const g of GROUPS) g.routes = g.routes.filter(([, , , a]) => a !== 'skip');

// Layout constants
const COLW = 660, COL_GAP = 36, MARGIN = 40, TOP = 150;
const ENTRY_PAD = 10, LINE_H = 16, BOX_PAD_Y = 12;
const FONT_DESC = 10.5, DESC_CHARS = 74;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) cur = (cur + ' ' + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Estimate height of a group block
function groupHeight(g) {
  let h = 34 + wrap(g.note, 86).length * LINE_H + 8; // header + note
  for (const [m, p, d] of g.routes) {
    const descLines = wrap(d, DESC_CHARS).length;
    h += 42 + descLines * LINE_H + 6;
  }
  return h + BOX_PAD_Y * 2;
}

// Balanced 3-column placement, preserving group order (sequential split)
const colCount = 3;
const totalH = placed_total();
function placed_total() { return GROUPS.reduce((s, g) => s + groupHeight(g), 0) + 18 * (GROUPS.length - 1); }
const target = totalH / colCount;
const columns = [[], [], []];
let col = 0, acc = 0;
for (const g of GROUPS) {
  const h = groupHeight(g);
  if (acc + h > target && col < colCount - 1 && columns[col].length) { col++; acc = 0; }
  columns[col].push({ g, h });
  acc += h + 18;
}
const colHeightsFinal = columns.map((col) => col.reduce((sum, { h }) => sum + h + 18, 0));
const bodyH = Math.max(...colHeightsFinal);
const W = MARGIN * 2 + colCount * COLW + (colCount - 1) * COL_GAP;
const H = TOP + bodyH + 90;

// Emit
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, Helvetica, sans-serif">`);
out.push(`  <rect width="${W}" height="${H}" fill="#0b1117"/>`);
out.push(`  <text x="${W / 2}" y="42" font-size="26" font-weight="bold" fill="#f8fafc" text-anchor="middle">Audiobook Manager - Complete API Reference (2026-11)</text>`);
out.push(`  <text x="${W / 2}" y="66" font-size="12" fill="#94a3b8" text-anchor="middle">Every route on both listeners. Generated from the source; verified 2026-11-17. Schemas on every route - no raw request.body.</text>`);

// Legend + flow strip
const legend = [
  ['PUBLIC', 'no session', ACOL.public],
  ['SESSION', 'household session', '#7dd3fc'],
  ['PROFILE', 'profile-bound session', ACOL.profile],
  ['ADMIN', 'session role=admin (family)', '#fb923c'],
  ['PANEL', 'admin_panel_session (:3100)', ACOL.panel],
  ['MEDIA', '5-min scoped ?media= bearer', ACOL.media],
];
let lx = MARGIN;
for (const [k, v, c] of legend) {
  out.push(`  <rect x="${lx}" y="82" width="13" height="13" rx="3" fill="${c}"/>`);
  out.push(`  <text x="${lx + 18}" y="93" font-size="11" fill="#cbd5e1"><tspan font-weight="bold">${esc(k)}</tspan> - ${esc(v)}</text>`);
  lx += 220;
}
out.push(`  <text x="${MARGIN}" y="126" font-size="11" fill="#64748b">Flow: client -> (Caddy / Render edge) -> family listener :3000 -> Fastify schema validation -> route handler -> Prisma -> DB.  '/api/*' is auth-gated on the family listener; CORS allowlist; OPTIONS preflights pass through.  Demo mode (ACCOUNT_EXPERIENCE=demo) 404s everything except the public allowlist and account-scoped routes; children (role=child) are blocked again in-handler on age-restricted routes.</text>`);

function renderGroup(g, x, y) {
  const h = groupHeight(g);
  out.push(`  <rect x="${x}" y="${y}" width="${COLW}" height="${h}" rx="10" fill="#131c2b" stroke="#334155"/>`);
  let cy = y + BOX_PAD_Y + 4;
  out.push(`  <text x="${x + 14}" y="${cy}" font-size="12.5" font-weight="bold" fill="#22d3ee" letter-spacing="1">${esc(g.title)}</text>`);
  cy += 8;
  for (const line of wrap(g.note, 88)) {
    out.push(`  <text x="${x + 14}" y="${cy + 12}" font-size="${FONT_DESC}" fill="#7c8aa0" font-style="italic">${esc(line)}</text>`);
    cy += LINE_H;
  }
  cy += 14;
  for (const [method, p, d, auth] of g.routes) {
    // auth chip geometry (right aligned)
    const authLabel = auth.toUpperCase().replace('PUBLIC-SHIM', 'PUBLIC');
    const chipW = authLabel.length * 6.3 + 14;
    const chipX = x + COLW - 12 - chipW;
    const chipColor = auth === 'panel' ? ACOL.panel : auth === 'admin' ? '#fb923c' : auth === 'media' ? ACOL.media : auth.includes('media') ? '#f472b6' : auth === 'public' || auth === 'public-shim' ? '#94a3b8' : auth === 'profile' ? ACOL.profile : '#7dd3fc';
    out.push(`  <rect x="${x + 12}" y="${cy}" width="46" height="17" rx="3" fill="${MCOL[method] || '#94a3b8'}"/>`);
    out.push(`  <text x="${x + 35}" y="${cy + 13}" font-size="10.5" font-weight="bold" fill="#020617" text-anchor="middle">${method}</text>`);
    const pathX = x + 66;
    out.push(`  <text x="${pathX}" y="${cy + 13}" font-size="10.5" fill="#e2e8f0" font-family="Consolas, monospace">${esc(p)}</text>`);
    out.push(`  <rect x="${chipX}" y="${cy}" width="${chipW}" height="17" rx="8" fill="none" stroke="${chipColor}"/>`);
    out.push(`  <text x="${chipX + chipW / 2}" y="${cy + 12.5}" font-size="8.5" fill="${chipColor}" text-anchor="middle">${esc(authLabel)}</text>`);
    cy += 21;
    for (const line of wrap(d, DESC_CHARS)) {
      out.push(`  <text x="${x + 66}" y="${cy + 10}" font-size="${FONT_DESC}" fill="#94a3b8">${esc(line)}</text>`);
      cy += LINE_H;
    }
    cy += 7;
  }
}

for (let c = 0; c < colCount; c++) {
  let y = TOP;
  const x = MARGIN + c * (COLW + COL_GAP);
  for (const { g, h } of columns[c]) {
    renderGroup(g, x, y);
    y += h + 18;
  }
}

out.push(`  <text x="${W / 2}" y="${H - 30}" font-size="10.5" fill="#475569" text-anchor="middle">Family listener: :3000 (households + demo).  Admin listener: :3100 (loopback default, separate credential, SameSite=Strict cookie).  Errors are codes (fail()), never details.  All mutations are profile-scoped row checks.</text>`);
out.push(`</svg>`);

fs.writeFileSync('docs/diagrams/api.svg', out.join('\n'));
console.log('written docs/diagrams/api.svg', W, 'x', H);
