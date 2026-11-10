import type { FastifyInstance } from "fastify";

export function registerPrivacyRoute(app: FastifyInstance): void {
  app.get("/privacy", async (_request, reply) => {
    const year = new Date().getFullYear();
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy notice — Audiobook Manager</title>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a}
h1{font-size:1.5rem}h2{font-size:1.125rem;margin-top:1.5rem;border-bottom:1px solid #e5e5e5}
</style>
</head>
<body>
<h1>Privacy notice — Audiobook Manager</h1>
<p>Last updated: 5 November 2026. Applies to household and production-demo deployments.</p>
<h2>Who we are</h2>
<p>The controller is the person operating the server you use: the household administrator or the production-demo operator. Contact them through the server operator.</p>
<h2>Why we use your data</h2>
<p>We process account and sign-in details, listening progress and history, favourites, wishlist entries, library membership, and device credentials to provide and secure the service and keep your experience in sync across devices.</p>
<h2>Legal basis</h2>
<p>Account, session, library and progress data are processed to provide the service (Art. 6(1)(b) GDPR). Favourites, wishlist, recommendations and listening history support expected service features (Art. 6(1)(f)). Sign-up and passkey registration use consent where required (Art. 6(1)(a)).</p>
<h2>Data and recipients</h2>
<p>We store profile details, session metadata, listening activity, favourites, wishlist entries, library membership, and cryptographic passkey credentials. Biometric templates are not stored. Enrichment queries use book identifiers, not your personal data. Personal data is not sold or shared with third parties.</p>
<h2>Retention and your rights</h2>
<p>Data is retained as described in the server operator's retention policy. You can request access, export, rectification, erasure, restriction or object to processing. You may also complain to your supervisory authority. Use the account controls for export, profile correction and deletion where available.</p>
<h2>Cookies and recommendations</h2>
<p>The service uses one strictly necessary session cookie to keep you signed in. It has no analytics or tracking cookies. Recommendations use book tags and are not automated decisions with legal or similarly significant effects under Art. 22 GDPR.</p>
<h2>Transfers and complaints</h2>
<p>The service is designed for local use; personal data is not transferred internationally. You may contact your supervisory authority under Art. 77 GDPR.</p>
<p>© ${year} Audiobook Manager</p>
</body>
</html>`;
    return reply.type("text/html; charset=utf-8").send(html);
  });
}
