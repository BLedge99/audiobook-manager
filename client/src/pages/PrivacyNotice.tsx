/**
 * The public privacy notice, in-app. (Spec 42, phase 4.)
 *
 * The canonical document is served by the server at `GET /privacy` — a
 * standalone page with no JavaScript, always current. This component exists
 * so that the *application shell* can render the same notice when a
 * navigation to /privacy lands on it instead: the service worker's document
 * rule is NetworkFirst with a four-second timeout and a cached-shell fallback,
 * so a waking server (or none at all) can hand the browser the app instead of
 * the notice. There is no router to hand it to — so this is the route.
 *
 * Content parity with the server copy is pinned by PrivacyNotice.parity.test
 * — edit both or neither. Legally this page must remain legible: no JavaScript
 * grows beyond the app it arrived with, prose only, English.
 */

export default function PrivacyNotice() {
  const year = new Date().getFullYear();
  return (
    <main className="min-h-dvh bg-ground text-ink">
      <article className="mx-auto max-w-2xl px-5 py-8 leading-relaxed">
        <h1 className="font-display text-2xl font-semibold">Privacy notice — Audiobook Manager</h1>
        <p className="text-sm text-ink2">Last updated: 12 November 2026 &nbsp;|&nbsp; Applies to both household and production-demo deployments.</p>

        <h2 id="who-we-are" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Who we are</h2>
        <p className="mt-2">Audiobook Manager is a local-first audiobook manager. The controller is whoever operates the server you connect to — in a household deployment, that is the household admin; in the production demo (<code>https://books.home.arpa</code>), the operator of that demo service. Contact details are at the end of this notice.</p>

        <h2 id="why-we-collect" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Why we collect your data</h2>
        <p className="mt-2">We process personal data only to provide the audiobook service:</p>
        <ul className="mt-1 list-disc pl-6">
          <li><strong>Identity and sign-in:</strong> your profile name, colour/avatar, password hash, and session — so your progress, favourites and library are kept separate from other people&apos;s.</li>
          <li><strong>Listening history and progress:</strong> where you are in each book, and when you listened — so you can resume across devices.</li>
          <li><strong>Favourites and wishlist:</strong> books you mark, so Discover can suggest similar titles.</li>
          <li><strong>Library membership:</strong> which books you have added to your profile.</li>
          <li><strong>Device credentials:</strong> passkey / biometric device records (cryptographic credentials only — no biometric templates are stored).</li>
        </ul>

        <h2 id="lawful-basis" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Our legal basis for using it</h2>
        <p className="mt-2">We rely on:</p>
        <ul className="mt-1 list-disc pl-6">
          <li><strong>Contract (Art. 6(1)(b))</strong> — account, session, library and progress data are necessary to provide the service.</li>
          <li><strong>Legitimate interest (Art. 6(1)(f))</strong> — favourites, wishlist, recommendations and listening history are core service features you reasonably expect, and you may object at any time.</li>
          <li><strong>Consent (Art. 6(1)(a))</strong> — where you sign up with Google, GitHub, or email/password in the production demo, and where you register a passkey.</li>
        </ul>

        <h2 id="what-data" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">What data we collect</h2>
        <ul className="mt-2 list-disc pl-6">
          <li>Profile display name, colour and avatar (you choose these).</li>
          <li>Hashed password (never stored in plain text).</li>
          <li>Session token and expiry, device label, last-active time.</li>
          <li>Listening sessions: book, start/end time, position played.</li>
          <li>Favourites, wishlist items, library entries — all per profile.</li>
          <li>WebAuthn/passkey credential public keys (no biometric data leaves your device).</li>
          <li>In production demo mode: your email address (via OAuth provider or email sign-up).</li>
          <li>Age band for kids accounts (children managed by a household adult): one of under 6 / 6-9 / 10-13 / 14-17. No date of birth is stored — see &quot;Children&apos;s accounts&quot;.</li>
        </ul>

        <h2 id="children" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Children&apos;s accounts</h2>
        <p className="mt-2">Audiobook Manager can run accounts for children managed by a household adult. Children&apos;s accounts:</p>
        <ul className="mt-1 list-disc pl-6">
          <li>See only books rated age-appropriate for their band (or unrated), unless the admin has blocklisted the genre; hidden books are invisible on every list and every direct link.</li>
          <li>Use the same rights as any account: they can export, delete and correct their own data; their listening is profile-scoped and isolated.</li>
          <li>Are not profiled, advertised to, or shared with third parties; recommendations draw only from age-suitable suggestions.</li>
          <li>Are created and managed only by the household adult in the admin panel — never in the family app.</li>
        </ul>

        <h2 id="who-receives" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Who receives your data</h2>
        <p className="mt-2 rounded-md bg-ink2/10 p-3 font-bold">We do not share your personal data with any third party.</p>
        <ul className="mt-2 list-disc pl-6">
          <li>Catalogue enrichment queries (Open Library, LibriVox, Audnexus, optional Google Books) send only book identifiers such as ISBN, title or author — never your reading data or profile identity.</li>
          <li>Optional AI via LM Studio runs locally and sends no user personal data.</li>
          <li>Optional Supabase Storage sync stores audiobook files only (server-side, private bucket), not personal data.</li>
          <li>The app can show links to audiobook stores and libraries. Purchases made through links marked as an advert may earn the app a commission. Your tap is not sent to us, and the store decides what it receives.</li>
        </ul>

        <h2 id="how-long" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">How long we keep it</h2>
        <ul className="mt-2 list-disc pl-6">
          <li>Profile and related data: kept while your account is active, and deleted when you delete your account.</li>
          <li>Sessions: expire after their TTL and are cleaned up automatically.</li>
          <li>WebAuthn challenges: single-use, short-lived.</li>
          <li>Inactive accounts may be deleted under the retention schedule (see <code>docs/retention.md</code>).</li>
        </ul>

        <h2 id="your-rights" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Your rights</h2>
        <p className="mt-2">You may:</p>
        <ul className="mt-1 list-disc pl-6">
          <li><strong>Export your data</strong> — request a copy of all personal data we hold about your profile (Art. 15, 20).</li>
          <li><strong>Delete your account</strong> — erase all your personal data (Art. 17).</li>
          <li><strong>Correct your data</strong> — update your profile name or colour (Art. 16).</li>
          <li><strong>Object</strong> to processing based on legitimate interest (Art. 21).</li>
          <li><strong>Restrict</strong> processing of your data (Art. 18).</li>
        </ul>
        <p className="mt-2">Use the account menu in the app, or contact us (details below). We will respond within one month.</p>

        <h2 id="cookies" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Cookies</h2>
        <ul className="mt-2 list-disc pl-6">
          <li>One <strong>session cookie</strong> is set: HttpOnly, Secure (over HTTPS), SameSite. It is strictly necessary to keep you signed in and does not require consent.</li>
          <li><strong>We do not use analytics or tracking cookies.</strong> No beacons, no advertising IDs, no third-party trackers.</li>
        </ul>

        <h2 id="no-profiling" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">No profiling or automated decisions</h2>
        <p className="mt-2">Discover suggestions use tag similarity over your favourites and catalogue metadata. They are not automated decisions with legal or similarly significant effect on you (Art. 22 does not apply).</p>

        <h2 id="international-transfers" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">International transfers</h2>
        <p className="mt-2">No personal data is transferred outside the server&apos;s jurisdiction. Catalogue queries may reach public APIs hosted outside the EEA/UK, but they carry no personal data about you.</p>

        <h2 id="complaints" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Complaints</h2>
        <p className="mt-2">If you are unhappy with how we handle your data, contact the data-protection lead (details below). You also have the right to complain to your supervisory authority (Art. 77(d)).</p>

        <h2 id="contact" className="mt-6 border-b border-ink2/30 pb-1 text-lg font-semibold">Contact us</h2>
        <p className="mt-2">Data-protection lead: the household admin (household deployment) or the demo-service operator (production demo). Use the contact address shown on your server&apos;s sign-in page, or email privacy@example.org.</p>

        <p className="mt-6 text-sm text-ink2">© {year} Audiobook Manager. This notice is part of the GDPR remediation plan (docs/GDPR-REMEDIATION-PLAN.md).</p>

        <p className="mt-8"><a className="font-bold text-cobalt-ink underline underline-offset-2" href="/">← Back to the app</a></p>
      </article>
    </main>
  );
}
