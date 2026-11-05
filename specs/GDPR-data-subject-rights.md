# Spec: GDPR Data Subject Rights — Export, Erasure, Rectification

**Status:** Draft — implements GDPR remediation Phases 3–5  
**GDPR basis:** Art. 15–22 (access, portability, erasure, rectification, restriction, objection)

---

## 1. Purpose

Give every authenticated profile self-service control over their personal data:

- **Export** (Art. 15, 20): download all personal data as JSON
- **Erasure** (Art. 17): delete their own account and every related row
- **Rectification** (Art. 16): correct their profile name and colour
- **Entry deletion** (Art. 17): remove individual listening-history rows and favourites

No admin intervention is required for any of these. Admin break-glass deletion (`DELETE /api/profiles/:id`) is preserved separately and is not the GDPR path.

---

## 2. Endpoints

### GET /api/me/export

**Auth:** session required (`x-house-session` header or `house_session` cookie).  
**Demo mode:** allowed — an authenticated profile session may export.

**Response:** JSON object with:
- `exportedAt` — ISO-8601 timestamp
- `profile` — `id`, `name`, `color`, `role`, `createdAt`, `followsServerLibrary`
- `sessions` — `id`, `expiresAt`, `userAgent`, `deviceLabel`, `createdAt` (no token hashes)
- `listeningHistory` — `id`, `mediaItemId`, `position`, `completed`, `lastPlayed`, `playedAt`
- `playSessions` — `id`, `mediaItemId`, `startedAt`, `endedAt`, `fromPosition`, `toPosition`, `speed`
- `favourites` — `mediaItemId`, `createdAt`
- `wishlistItems` — `id`, `title`, `author`, `seedMediaItemId`, `owned`, `createdAt`
- `libraryEntries` — `mediaItemId`
- `deviceCredentials` — `label`, `createdAt` (no secret hashes)
- `webAuthnCredentials` — `credentialId`, `publicKey`, `counter`, `createdAt` (no private keys)

**Errors:** `401 auth_required` when unauthenticated; `400 profile_required` when no profile in session; `404 not_found` if the profile no longer exists.

**Isolation:** Returns only the requesting profile's data. No cross-profile leakage.

---

### DELETE /api/me

**Auth:** session required.  
**Demo mode:** allowed — an authenticated profile session may delete.

**Behaviour:** Deletes the requesting profile and, inside a single transaction, every related row:
`WebAuthnChallenge`, `WebAuthnCredential`, `DeviceCredential`, `Session`,
`ListeningHistory`, `PlaySession`, `Favourite`, `WishlistItem`,
`ProfileLibraryEntry`, then `Profile`.

**Response:** `204 No Content`.

**Errors:** `401 auth_required` when unauthenticated; `400 profile_required` when no profile in session.

**Client-side:** On success the client clears `localStorage.profileId`, clears the session token, and reloads. The encrypted IndexedDB cache (`privateRows`, `keyEnvelopes`) is wiped for that profile.

---

### PATCH /api/me

**Auth:** session required.  
**Demo mode:** allowed.

**Body:** `{ name?: string; color?: string }`

**Behaviour:** Updates the authenticated profile's `name` and/or `color`. A name that is already taken by another profile returns `409 profile_name_taken`. Empty strings are rejected with `400 profile_name_required`.

**Response:** The updated profile: `id`, `name`, `color`.

**Errors:** `401 auth_required`; `400 profile_required`; `400 profile_name_required`; `409 profile_name_taken`.

---

### DELETE /api/me/listening-history/:historyId

**Auth:** session required.

**Behaviour:** Deletes the listening-history row with the given ID, but only if it belongs to the authenticated profile. Returns `404 not_found` if the row does not exist or belongs to another profile.

**Response:** `204 No Content`.

---

### DELETE /api/me/favourites/:mediaItemId

**Auth:** session required.

**Behaviour:** Removes the favourite row for the given media item and the authenticated profile. Returns `404 not_found` if no such favourite exists.

**Response:** `204 No Content`.

---

## 3. Restriction (Art. 18)

Not implemented in this spec. A `PATCH /api/me/restrict` flag was planned but deferred; restriction can be achieved by erasure (`DELETE /api/me`) and re-creation. Revisit when a use case requires paused-but-retained processing.

---

## 4. Acceptance criteria

- [ ] Authenticated export returns all personal data for the requesting profile only
- [ ] Export excludes token hashes, password hashes, and secret hashes
- [ ] Unauthenticated export returns `401`
- [ ] Self-service deletion cascades to all related tables
- [ ] Other profiles' data is untouched by deletion
- [ ] Unauthenticated deletion returns `401`
- [ ] `PATCH /api/me` updates name and colour for the requesting profile only
- [ ] Name clashes with another profile return `409`
- [ ] `DELETE /api/me/listening-history/:id` deletes only the requesting profile's row
- [ ] `DELETE /api/me/favourites/:mediaItemId` deletes only the requesting profile's favourite
- [ ] Client "Export my data" button downloads a JSON file
- [ ] Client "Delete my account" button shows a confirmation dialog

---

## 5. Tests

Integration tests via Fastify `inject` with a temp SQLite DB:

- `server/src/export.test.ts` — 8 tests covering export (3), erasure (2), rectification (3)

All tests must pass with `make test-server`.
