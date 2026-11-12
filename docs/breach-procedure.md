# Breach Response Procedure — GDPR Art. 33–34

**Last updated:** 12 November 2026  
**Status:** Draft — implements Phase 8 of `docs/GDPR-REMEDIATION-PLAN.md`  
**Owner:** Data-protection lead (see `docs/gdpr-governance.md`)  
**Applies to:** All deployments — household and production demo

---

## 1. Roles

| Role | Who | Responsibility |
|------|-----|----------------|
| Data-protection lead | Household admin (household) / demo-service operator (production demo) | Declares the incident, leads containment, decides notification, keeps the internal log |
| Technical lead | Whoever operates the server | Implements containment (isolate, rotate, patch), preserves evidence, assists assessment |
| Communicator | Same as data-protection lead unless delegated | Drafts and sends supervisory-authority and data-subject notifications |

---

## 2. Detection

A breach may be detected by:

- A user report (e.g. "I can see another person's data")
- An admin observation (unexpected rows, failed logins, unexplained exports)
- A monitoring alert (server errors, auth failures, unusual query volume)
- A third-party notice (processor reports a compromise)

Any team member who suspects a breach must report it to the data-protection lead immediately. There is no penalty for a false alarm.

---

## 3. Containment

The data-protection lead decides containment steps with the technical lead. Examples:

- Revoke all sessions for affected profiles (`DELETE /api/me` self-service or admin session revocation)
- Rotate the app password and invalidate all household sessions
- Rotate device credentials and WebAuthn credentials for affected profiles
- Temporarily take the server offline (only if the breach is ongoing and containment cannot be achieved otherwise)
- Preserve logs and database state (do not purge `Session`, `WebAuthnChallenge`, or `ListeningHistory` rows until the technical lead confirms evidence is captured)

Containment must not destroy evidence needed for assessment.

---

## 4. Assessment

The data-protection lead assesses, without undue delay:

| Question | What to determine |
|----------|-------------------|
| What happened? | Access, alteration, deletion, disclosure, or loss of personal data |
| Which data? | Categories (profile, session, listening history, favourites, email, etc.) and approximate number of records |
| Which people? | Which profiles/subjects are affected; is cross-profile leakage involved? **Are any affected accounts kids accounts (`role = "child"`, spec 38)?** Children are higher-risk data subjects: exposure of their listening history, favourites or age band is likelier to harm a child, and the supervisory authority treats children's data as a material factor in the Art. 33 risk assessment. Any incident touching a kids account is presumptively at least a risk that must be assessed expressly against Art. 34 |
| Likely consequences? | Identity theft, fraud, reputational harm, exposure of reading habits |
| Is it high risk? | Art. 34 threshold — likely to result in a high risk to rights and freedoms |

---

## 5. Notification — supervisory authority (Art. 33)

If the breach is likely to result in a risk to rights and freedoms:

- Notify the competent supervisory authority **within 72 hours** of becoming aware.
- The notification must describe: nature of the breach, categories and approximate number of data subjects and records, likely consequences, and measures taken or proposed.
- If notification cannot be made within 72 hours, the delay must be justified in the notification.

If the breach is unlikely to result in a risk, document the assessment and rationale in the internal log; no supervisory-authority notification is required.

---

## 6. Communication — data subjects (Art. 34)

If the breach is likely to result in a **high risk** to rights and freedoms:

- Communicate to affected data subjects **without undue delay**.
- The communication must describe: nature of the breach, likely consequences, measures taken, and contact point for more information.
- Communication may be delayed or waived if: (a) data were encrypted/rendered unintelligible, (b) subsequent measures ensure the high risk is no longer likely, or (c) it would involve disproportionate effort (then a public communication or equivalent measure is required instead).

---

## 7. Internal record

All breaches — whether or not they trigger notification — must be recorded in the internal breach log, including:

- Date and time of detection and of the breach itself
- Description and categories of data affected
- Number of data subjects and records
- Assessment outcome (risk / no risk / high risk)
- Notifications made (authority, subjects) and dates
- Containment and remediation steps
- Lessons learned and follow-up actions

The log is maintained by the data-protection lead and retained for at least 24 months.

---

## 8. Post-incident review

Within 30 days of closure:

- Identify the root cause
- Update controls (code, configuration, documentation) to prevent recurrence
- Review whether the RoPA, retention schedule, or processor inventory needs updating
- Record the outcome in the internal log

---

## Cross-reference

- `docs/gdpr-governance.md` — data-protection lead contact and lawful-basis register
- `docs/roa.md` — Record of Processing Activities (categories of data per activity)
- `docs/retention.md` — retention schedule (what data exists to be breached)
- `GDPR-AUDIT.md` — original audit findings
- `server/src/auth/service.ts` — `cleanupExpired()` (session and credential lifecycle)
