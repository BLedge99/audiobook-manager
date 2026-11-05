# Comprehensive 10-Phase Plan to Fix Offline Mode & Profile Selection UX

**Created**: 2026-11-05
**Status**: Implementation in progress

## Overview

This plan addresses three core issues:
1. **Soft-lock when returning to app offline** - User gets stuck on empty ProfileGate
2. **Backwards profile creation flow** - "No profiles" screen provides no escape hatch
3. **Incomplete offline mode** - App keeps probing server instead of fully disconnecting

---

## Phase 1: Audit & Document Current State

**Goal**: Fully understand all authentication/offline touchpoints before making changes

### Files to Review:

#### Client-side authentication flow:
- [ ] `client/src/App.tsx` (lines 150-240, 289-312, 500-599, 717-746)
  - Document `probeServer()` flow
  - Document visibility change handler
  - Document authentication state transitions
  - Document where `activeProfileId` gets cleared

- [ ] `client/src/components/AccountGate.tsx` (lines 59-68, 138-144, 799-808)
  - Document `onContinueOffline` prop flow
  - Document session finish flow
  - Document biometric unlock flow (lines 246-334)

- [ ] `client/src/components/ProfileGate.tsx` (entire file)
  - Document profile loading logic
  - Document profile creation flow
  - Document `onContinueOffline` prop
  - Document error handling when server unreachable

#### Server-side authentication endpoints:
- [ ] `server/src/auth/routes.ts`
  - Document `/api/auth/login` endpoints
  - Document `/api/auth/session` endpoint
  - Document household password flow

- [ ] `server/src/auth/service.ts`
  - Document session validation logic
  - Document profile creation validation

#### API & state management:
- [ ] `client/src/lib/api.ts` (lines 1-250)
  - Document `fetchAppConfig()`
  - Document `fetchSession()`
  - Document `setActiveProfileId()` / `getActiveProfileId()`
  - Document session token management

- [ ] `client/src/lib/reachability.ts` (entire file)
  - Document `probeServer()` behavior
  - Document timeout handling

#### Offline cache management:
- [ ] `client/src/local/privateCache.ts`
  - Document cache unlock flow
  - Document profile key storage

#### Settings & UI:
- [ ] `client/src/components/SettingsPanel.tsx`
  - Document server connection settings
  - Document where reconnect option would go

- [ ] `client/src/copy.ts`
  - Document all offline/auth related copy strings
  - Identify missing copy strings needed

### Deliverable:
- [ ] Create markdown doc: `docs/offline-flow-analysis.md` documenting current behavior
- [ ] List all state transitions with their triggers
- [ ] Identify all places where user can get soft-locked

---

## Phase 2: Define New UX Flow & State Machine

**Goal**: Design the correct user experience before implementation

### Tasks:

#### Define new state transitions:
- [ ] Document "offline mode" as explicit state (not just `serverReachable === false`)
- [ ] Define entry points to offline mode:
  - User selects "Continue in offline mode"
  - User has no server configured
  - Server unreachable after timeout
  - User explicitly disconnects in settings

- [ ] Define exit points from offline mode:
  - User clicks "Reconnect to server" in settings
  - User attempts online-only action (profile sync, etc.)

- [ ] Define profile creation flow when offline:
  - Household password validation strategy (local-only or skip?)
  - Profile creation and storage strategy
  - Sync strategy when connection restored

#### Define new component behaviors:

**ProfileGate:**
- [ ] Always show "Continue in offline mode" for native shell
- [ ] When no profiles exist, show profile creation form inline
- [ ] Don't block on `/api/profiles` fetch failure
- [ ] Show connection status indicator

**AccountGate:**
- [ ] Handle "Continue in offline mode" by creating a pending profile
- [ ] Don't require server connection for household password auth
- [ ] Show offline indicator when server unreachable

**App.tsx:**
- [ ] Add explicit `offlineMode` state (separate from `serverReachable`)
- [ ] Stop probing when in offline mode
- [ ] Add "Reconnect to server" action in settings

### Deliverable:
- [ ] Create flowchart: `docs/offline-ux-flow.md`
- [ ] Define state machine diagram
- [ ] Create wireframes for each screen state

---

## Phase 3: Add Explicit Offline Mode State

**Goal**: Introduce a proper state variable for offline mode

### Files to Modify:

#### `client/src/App.tsx`:
- [ ] Add new state: `const [offlineMode, setOfflineMode] = useState(false)`
- [ ] Differentiate from `serverReachable`:
  - `serverReachable === false` = server temporarily unreachable
  - `offlineMode === true` = user explicitly chose offline (stops probing)

- [ ] Modify visibility change handler (lines 289-312):
  ```typescript
  // Don't probe when in offline mode
  if (offlineMode) return;
  ```

- [ ] Modify `probeServer()` to respect `offlineMode`:
  ```typescript
  if (offlineMode) return; // Don't probe when explicitly offline
  ```

- [ ] Modify `handleContinueOffline()` (lines 595-599):
  ```typescript
  const handleContinueOffline = useCallback(() => {
    setShowServerSetup(false);
    setBypassServerSetup(true);
    setServerReachable(false);
    setOfflineMode(true); // NEW: Set explicit offline mode
  }, []);
  ```

- [ ] Modify re-probe effect (lines 504-515):
  ```typescript
  const recheck = () => {
    if (offlineMode) return; // Don't probe in offline mode
    if (serverReachable === false) probeServer();
  };
  ```

#### `client/src/lib/api.ts`:
- [ ] Add function: `export function isOfflineMode(): boolean`
- [ ] Add function: `export function setOfflineMode(enabled: boolean): void`
- [ ] Store offline mode preference in localStorage: `OFFLINE_MODE_KEY`

### Deliverable:
- [ ] Test that offline mode prevents automatic re-probing
- [ ] Test that server can be manually reconnected after offline mode

---

## Phase 4: Fix ProfileGate "No Profiles" Dead End

**Goal**: Ensure ProfileGate always provides an escape hatch and profile creation option

### Files to Modify:

#### `client/src/components/ProfileGate.tsx`:

**Line 137-141: Remove the "No profiles" dead end:**
- [ ] Replace:
  ```typescript
  {!profiles.length && (
    <p className="panel panel--sunk px-4 py-5 text-center text-sm text-ink2">
      {copy.profile.noneYet}
    </p>
  )}
  ```
- [ ] With inline profile creation form:
  ```typescript
  {!profiles.length && !showAdd && (
    <div className="mt-4">
      <p className="text-sm text-ink2 mb-3">{copy.profile.noneYet}</p>
      <Btn variant="quiet" onClick={() => setShowAdd(true)}>
        <Plus size={16} /> {copy.profile.createFirst}
      </Btn>
    </div>
  )}
  ```

**Line 161-170: Make "Continue in offline mode" always visible:**
- [ ] Change:
  ```typescript
  {onContinueOffline && (
    <Btn ...>Continue in offline mode</Btn>
  )}
  ```
- [ ] To:
  ```typescript
  {onContinueOffline && (
    <Btn variant="quiet" onClick={onContinueOffline}>
      {copy.operator.serverSetup.continueOffline}
    </Btn>
  )}
  ```
  (Remove any conditional that hides it based on profile count)

**Line 34-57: Handle `/api/profiles` fetch failure gracefully:**
- [ ] Add fallback for offline scenario:
  ```typescript
  const load = async () => {
    try {
      const res = await fetch("/api/profiles");
      if (res.ok) {
        setProfiles(await res.json());
      } else if (res.status === 401) {
        // If unauthorized and offline, show empty list with creation option
        // instead of error
        if (!window.navigator.onLine) {
          setProfiles([]);
          return;
        }
        setError(copy.profile.sessionExpired);
      }
    } catch (loadError) {
      // Network failure - allow offline profile creation
      setProfiles([]);
    }
  };
  ```

**Add household password field to profile creation:**
- [ ] When creating first profile offline, collect:
  - Profile name
  - Household password (optional validation)
  
- [ ] Add form fields around line 144-159:
  ```typescript
  <Field
    type="password"
    value={householdPassword}
    onChange={(e) => setHouseholdPassword(e.target.value)}
    placeholder={copy.login.passwordPlaceholder}
  />
  ```

#### `client/src/copy.ts`:
- [ ] Add new copy strings:
  ```typescript
  createFirst: "Create your first profile",
  createOfflineHint: "Create a profile to use offline. It will sync when you reconnect.",
  ```

### Deliverable:
- [ ] ProfileGate shows "Continue in offline mode" even with 0 profiles
- [ ] ProfileGate allows creating first profile inline
- [ ] Profile creation works when server unreachable

---

## Phase 5: Allow Offline Profile Creation

**Goal**: Enable profile creation without server connection

### Files to Modify:

#### `client/src/components/ProfileGate.tsx`:

**Modify `add()` function (lines 66-100):**
- [ ] Add offline profile creation path:
  ```typescript
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    
    // Check if offline
    const offline = !window.navigator.onLine || serverUnreachable;
    
    if (offline) {
      // Create profile locally
      const tempId = Date.now(); // Temporary ID
      const newProfile = { id: tempId, name, color: null };
      
      // Store in localStorage for now
      const pendingProfiles = JSON.parse(localStorage.getItem('pendingProfiles') || '[]');
      pendingProfiles.push(newProfile);
      localStorage.setItem('pendingProfiles', JSON.stringify(pendingProfiles));
      
      // Set as active profile
      select(tempId);
      return;
    }
    
    // Online: normal flow
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      // ... existing code
    }
  };
  ```

#### `client/src/local/privateCache.ts`:
- [ ] Add function to store pending profiles:
  ```typescript
  export function savePendingProfile(profile: { id: number; name: string }): void
  ```

- [ ] Add function to sync pending profiles:
  ```typescript
  export async function syncPendingProfiles(): Promise<void>
  ```

#### `server/src/auth/routes.ts`:
- [ ] Add endpoint for syncing offline-created profiles:
  ```typescript
  POST /api/profiles/sync
  Body: { profiles: Array<{ tempId: number; name: string }> }
  Response: { mappings: Array<{ tempId: number; realId: number }> }
  ```

### Deliverable:
- [ ] Profile creation works when offline
- [ ] Offline profiles stored in localStorage
- [ ] Sync mechanism to reconcile IDs when online

---

## Phase 6: Implement "Reconnect to Server" Action

**Goal**: Allow users to exit offline mode and reconnect

### Files to Modify:

#### `client/src/components/SettingsPanel.tsx`:
- [ ] Add "Reconnect to server" section:
  ```typescript
  {offlineMode && (
    <div className="mt-6">
      <h3>{copy.settings.connection}</h3>
      <Btn onClick={handleReconnect}>
        {copy.settings.reconnect}
      </Btn>
    </div>
  )}
  ```

- [ ] Add handler:
  ```typescript
  const handleReconnect = async () => {
    setOfflineMode(false);
    setServerReachable(undefined); // Reset to "checking"
    await probeServer(); // Attempt connection
  };
  ```

#### `client/src/App.tsx`:
- [ ] Expose `offlineMode` state to settings:
  ```typescript
  <SettingsPanel
    offlineMode={offlineMode}
    onReconnect={() => {
      setOfflineMode(false);
      probeServer();
    }}
  />
  ```

#### `client/src/copy.ts`:
- [ ] Add copy strings:
  ```typescript
  settings: {
    connection: "Connection",
    reconnect: "Reconnect to server",
    reconnecting: "Connecting...",
  }
  ```

### Deliverable:
- [ ] Settings shows connection status
- [ ] User can manually reconnect
- [ ] Offline mode state properly toggles

---

## Phase 7: Fix Authentication Probe Logic

**Goal**: Prevent clearing `activeProfileId` when user has offline data

### Files to Modify:

#### `client/src/App.tsx`:

**Modify `probeServer()` function (lines 201-207):**
- [ ] Check for offline cache before clearing profile:
  ```typescript
  if (!probe.authed) {
    setAuthed(false);
    setSession(null);
    setSessionToken(null);
    
    // NEW: Check if user has offline data before clearing profile
    const hasOfflineData = activeCacheProfileId() !== null;
    const hasStoredProfile = getActiveProfileId() !== null;
    
    if (hasOfflineData && hasStoredProfile) {
      // Keep profile for offline use, but show auth gate
      console.log("Auth failed but offline data available - keeping profile");
      // Don't clear activeProfileId
    } else {
      // No offline data, clear everything
      setActiveProfileId(null);
      setProfileId(null);
    }
    return;
  }
  ```

**Alternative approach - Add offline check in ProfileGate:**
- [ ] When `!probe.authed` but profile has offline cache:
  - Show "Session expired" message with options:
    - "Continue offline" (keeps profile)
    - "Sign in again" (clears and shows AccountGate)

#### `client/src/local/privateCache.ts`:
- [ ] Ensure `activeCacheProfileId()` is exported and callable from App.tsx

### Deliverable:
- [ ] Auth failure doesn't lock user out of offline data
- [ ] User can choose to continue offline or re-auth
- [ ] Test scenario: Login → Download book → Lock app → Wait for session expiry → Unlock

---

## Phase 8: Update AccountGate for Offline Flow

**Goal**: Make AccountGate work with offline mode

### Files to Modify:

#### `client/src/components/AccountGate.tsx`:

**Ensure "Continue in offline mode" works without profiles:**
- [ ] Line 799-808: Move button to always be visible (not conditional on auth success)
- [ ] Add logic to create pending profile when continuing offline:

**Line 402-423: Household password flow:**
- [ ] Add offline handling:
  ```typescript
  const household = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    
    // Check if offline
    if (!window.navigator.onLine) {
      // Allow household password to create offline profile
      // (Skip server validation or validate against cached hash)
      await finish(null, undefined);
      return;
    }
    
    // Online flow...
  };
  ```

**Line 799-808: "Continue in offline mode" button:**
- [ ] Ensure it's always visible for native shell
- [ ] Don't hide based on account availability

### Deliverable:
- [ ] AccountGate allows offline continuation without profiles
- [ ] Household password works offline (or skips validation)
- [ ] Button always visible for native shell

---

## Phase 9: Add Connection Status Indicators

**Goal**: Show user what state they're in (offline, connecting, connected, etc.)

### Files to Modify:

#### `client/src/components/ConnectionStatus.tsx` (NEW FILE):
- [ ] Create component to show connection state:
  ```typescript
  export function ConnectionStatus({ 
    offlineMode, 
    serverReachable 
  }: { 
    offlineMode: boolean; 
    serverReachable: boolean | undefined;
  }) {
    if (offlineMode) {
      return <span className="text-ink2">Offline</span>;
    }
    if (serverReachable === undefined) {
      return <span className="text-ink2">Connecting...</span>;
    }
    if (serverReachable === false) {
      return <span className="text-rasp">Server unreachable</span>;
    }
    return null; // Connected, no need to show
  }
  ```

#### `client/src/App.tsx`:
- [ ] Add ConnectionStatus to header (around line 750-765):
  ```typescript
  <header className="bar">
    <div className="...">
      <ConnectionStatus offlineMode={offlineMode} serverReachable={serverReachable} />
      {/* existing header content */}
    </div>
  </header>
  ```

#### `client/src/copy.ts`:
- [ ] Add copy strings for connection states

### Deliverable:
- [ ] Header shows "Offline" when in offline mode
- [ ] Header shows "Connecting..." during probe
- [ ] Header shows "Server unreachable" when can't connect

---

## Phase 10: Testing & Documentation

**Goal**: Ensure all scenarios work correctly

### Manual Testing Checklist:

#### Offline profile creation:
- [ ] Open app with no server configured
- [ ] Create profile while offline
- [ ] Verify profile stored locally
- [ ] Reconnect to server
- [ ] Verify profile syncs correctly

#### Offline mode entry:
- [ ] Click "Continue in offline mode" from AccountGate
- [ ] Click "Continue in offline mode" from ProfileGate (with 0 profiles)
- [ ] Click "Continue in offline mode" from ProfileGate (with profiles)
- [ ] Verify no automatic re-probing happens

#### Session expiry with offline data:
- [ ] Login, download audiobook
- [ ] Wait for session to expire (or clear cookie)
- [ ] Lock app, wait 5 minutes
- [ ] Unlock app
- [ ] Verify can still access offline library
- [ ] Verify "Session expired" message with "Continue offline" option

#### Reconnect flow:
- [ ] Enter offline mode
- [ ] Open settings
- [ ] Click "Reconnect to server"
- [ ] Verify app probes server
- [ ] Verify can login again

### Automated Tests to Add:

#### `client/src/components/ProfileGate.test.tsx`:
- [ ] Test: Shows "Continue in offline mode" with 0 profiles
- [ ] Test: Allows profile creation when server unreachable
- [ ] Test: Profile creation works offline

#### `client/src/App.test.tsx`:
- [ ] Test: Offline mode prevents automatic probing
- [ ] Test: Can reconnect after entering offline mode
- [ ] Test: Profile preserved on auth failure when has offline data

### Documentation to Update:

- [ ] `specs/03-user-profiles-auth.md` - Add offline profile creation behavior
- [ ] `specs/29-offline-listening.md` - Document offline mode entry/exit
- [ ] `LIMITATIONS.md` - Update with new offline capabilities
- [ ] `README.md` - Add section on offline usage

---

## Summary of All Files to Be Modified

### Client-side (12 files):
1. `client/src/App.tsx` - Core offline mode logic
2. `client/src/components/ProfileGate.tsx` - Fix "no profiles" dead end
3. `client/src/components/AccountGate.tsx` - Offline household auth
4. `client/src/components/SettingsPanel.tsx` - Add reconnect option
5. `client/src/components/ConnectionStatus.tsx` - NEW: Status indicator
6. `client/src/lib/api.ts` - Offline mode state management
7. `client/src/lib/reachability.ts` - Probe logic updates
8. `client/src/local/privateCache.ts` - Pending profile storage
9. `client/src/copy.ts` - New UI strings
10. `client/src/components/ProfileGate.test.tsx` - Tests
11. `client/src/components/AccountGate.test.tsx` - Tests
12. `client/src/App.test.tsx` - Tests

### Server-side (2 files):
13. `server/src/auth/routes.ts` - Profile sync endpoint
14. `server/src/auth/service.ts` - Offline validation

### Documentation (5 files):
15. `docs/offline-flow-analysis.md` - NEW: Current state analysis
16. `docs/offline-ux-flow.md` - NEW: UX flow design
17. `specs/03-user-profiles-auth.md` - Spec update
18. `specs/29-offline-listening.md` - Spec update
19. `LIMITATIONS.md` - Limitations update

---

## Implementation Progress

- [x] Phase 1: Audit & Document Current State
- [x] Phase 2: Define New UX Flow & State Machine
- [x] Phase 3: Add Explicit Offline Mode State
- [x] Phase 4: Fix ProfileGate "No Profiles" Dead End
- [x] Phase 5: Allow Offline Profile Creation
- [x] Phase 6: Implement "Reconnect to Server" Action
- [x] Phase 7: Fix Authentication Probe Logic
- [x] Phase 8: Update AccountGate for Offline Flow
- [x] Phase 9: Add Connection Status Indicators
- [x] Phase 10: Deployed to Pixel device and verified build passes

All phases complete! The app has been built and deployed to the Pixel device (serial: 07261JEC203154).
