/**
 * The unauthenticated surface: liveness, the public client config and the
 * privacy notice (GDPR Art. 12-14). No session required by design.
 */
import type { FastifyInstance } from "fastify";

export interface StaticRouteDeps {
  accountExperience: "household" | "demo";
  /** Enabled OAuth provider ids, shown on the sign-in page. */
  oauthProviders: string[];
}

export async function registerStaticRoutes(
  app: FastifyInstance,
  deps: StaticRouteDeps,
): Promise<void> {
  const { accountExperience, oauthProviders } = deps;

  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/config", async () => ({
    accountExperience,
    oauthProviders,
  }));

  // Public privacy notice (GDPR Art. 12–14). No session required.
  app.get("/privacy", async (_request, reply) => {
    const now = new Date().getFullYear();
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Privacy notice — Audiobook Manager</title>
<style>
  body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin-top: 0; }
  h2 { font-size: 1.125rem; margin-top: 1.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.25rem; }
  p { margin: 0.75rem 0; }
  ul { margin: 0.5rem 0 1rem 1.25rem; }
  li { margin: 0.25rem 0; }
  .note { background: #f3f4f6; border-radius: 6px; padding: 0.75rem 1rem; margin: 1rem 0; }
  a { color: #2563eb; }
  .small { font-size: 0.875rem; color: #4b5563; }
</style>
</head>
<body>
  <h1>Privacy notice — Audiobook Manager</h1>
  <p class="small">Last updated: 12 November 2026 &nbsp;|&nbsp; Applies to both household and production-demo deployments.</p>

  <h2 id="who-we-are">Who we are</h2>
  <p>Audiobook Manager is a local-first audiobook manager. The controller is whoever operates the server you connect to — in a household deployment, that is the household admin; in the production demo (<code>https://books.home.arpa</code>), the operator of that demo service. Contact details are at the end of this notice.</p>

  <h2 id="why-we-collect">Why we collect your data</h2>
  <p>We process personal data only to provide the audiobook service:</p>
  <ul>
    <li><strong>Identity and sign-in:</strong> your profile name, colour/avatar, password hash, and session — so your progress, favourites and library are kept separate from other people's.</li>
    <li><strong>Listening history and progress:</strong> where you are in each book, and when you listened — so you can resume across devices.</li>
    <li><strong>Favourites and wishlist:</strong> books you mark, so Discover can suggest similar titles.</li>
    <li><strong>Library membership:</strong> which books you have added to your profile.</li>
    <li><strong>Device credentials:</strong> passkey / biometric device records (cryptographic credentials only — no biometric templates are stored).</li>
  </ul>

  <h2 id="lawful-basis">Our legal basis for using it</h2>
  <p>We rely on:</p>
  <ul>
    <li><strong>Contract (Art. 6(1)(b))</strong> — account, session, library and progress data are necessary to provide the service.</li>
    <li><strong>Legitimate interest (Art. 6(1)(f))</strong> — favourites, wishlist, recommendations and listening history are core service features you reasonably expect, and you may object at any time.</li>
    <li><strong>Consent (Art. 6(1)(a))</strong> — where you sign up with Google, GitHub, or email/password in the production demo, and where you register a passkey.</li>
  </ul>

  <h2 id="what-data">What data we collect</h2>
  <ul>
    <li>Profile display name, colour and avatar (you choose these).</li>
    <li>Hashed password (never stored in plain text).</li>
    <li>Session token and expiry, device label, last-active time.</li>
    <li>Listening sessions: book, start/end time, position played.</li>
    <li>Favourites, wishlist items, library entries — all per profile.</li>
    <li>WebAuthn/passkey credential public keys (no biometric data leaves your device).</li>
    <li>In production demo mode: your email address (via OAuth provider or email sign-up).</li>
    <li>Age band for kids accounts (children managed by a household adult): one of under 6 / 6-9 / 10-13 / 14-17. No date of birth is stored — see "Children's accounts".</li>
  </ul>

  <h2 id="children">Children's accounts</h2>
  <p>Audiobook Manager can run accounts for children managed by a household adult. Children's accounts:</p>
  <ul>
    <li>See only books rated age-appropriate for their band (or unrated), unless the admin has blocklisted the genre; hidden books are invisible on every list and every direct link.</li>
    <li>Use the same rights as any account: they can export, delete and correct their own data; their listening is profile-scoped and isolated.</li>
    <li>Are not profiled, advertised to, or shared with third parties; recommendations draw only from age-suitable suggestions.</li>
    <li>Are created and managed only by the household adult in the admin panel — never in the family app.</li>
  </ul>

  <h2 id="who-receives">Who receives your data</h2>
  <div class="note"><strong>We do not share your personal data with any third party.</strong></div>
  <ul>
    <li>Catalogue enrichment queries (Open Library, LibriVox, Audnexus, optional Google Books) send only book identifiers such as ISBN, title or author — never your reading data or profile identity.</li>
    <li>Optional AI via LM Studio runs locally and sends no user personal data.</li>
    <li>Optional Supabase Storage sync stores audiobook files only (server-side, private bucket), not personal data.</li>
  </ul>

  <h2 id="how-long">How long we keep it</h2>
  <ul>
    <li>Profile and related data: kept while your account is active, and deleted when you delete your account.</li>
    <li>Sessions: expire after their TTL and are cleaned up automatically.</li>
    <li>WebAuthn challenges: single-use, short-lived.</li>
    <li>Inactive accounts may be deleted under the retention schedule (see <code>docs/retention.md</code>).</li>
  </ul>

  <h2 id="your-rights">Your rights</h2>
  <p>You may:</p>
  <ul>
    <li><strong>Export your data</strong> — request a copy of all personal data we hold about your profile (Art. 15, 20).</li>
    <li><strong>Delete your account</strong> — erase all your personal data (Art. 17).</li>
    <li><strong>Correct your data</strong> — update your profile name or colour (Art. 16).</li>
    <li><strong>Object</strong> to processing based on legitimate interest (Art. 21).</li>
    <li><strong>Restrict</strong> processing of your data (Art. 18).</li>
  </ul>
  <p>Use the account menu in the app, or contact us (details below). We will respond within one month.</p>

  <h2 id="cookies">Cookies</h2>
  <ul>
    <li>One <strong>session cookie</strong> is set: HttpOnly, Secure (over HTTPS), SameSite. It is strictly necessary to keep you signed in and does not require consent.</li>
    <li><strong>We do not use analytics or tracking cookies.</strong> No beacons, no advertising IDs, no third-party trackers.</li>
  </ul>

  <h2 id="no-profiling">No profiling or automated decisions</h2>
  <p>Discover suggestions use tag similarity over your favourites and catalogue metadata. They are not automated decisions with legal or similarly significant effect on you (Art. 22 does not apply).</p>

  <h2 id="international-transfers">International transfers</h2>
  <p>No personal data is transferred outside the server's jurisdiction. Catalogue queries may reach public APIs hosted outside the EEA/UK, but they carry no personal data about you.</p>

  <h2 id="complaints">Complaints</h2>
  <p>If you are unhappy with how we handle your data, contact the data-protection lead (details below). You also have the right to complain to your supervisory authority (Art. 77(d)).</p>

  <h2 id="contact">Contact us</h2>
  <p>Data-protection lead: the household admin (household deployment) or the demo-service operator (production demo). Use the contact address shown on your server's sign-in page, or email privacy@example.org.</p>

  <p class="small">© ${now} Audiobook Manager. This notice is part of the GDPR remediation plan (docs/GDPR-REMEDIATION-PLAN.md).</p>
</body>
</html>`;
    reply.type("text/html; charset=utf-8").send(html);
  });
}
