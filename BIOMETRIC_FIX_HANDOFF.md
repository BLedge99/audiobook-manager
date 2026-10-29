# Biometric Authentication Fix - Handoff Document

## Summary
Fixed two critical biometric authentication bugs:
1. **First button press failure** - "VAULT_UNAVAILABLE" error on initial fingerprint setup
2. **Instant unlock failure** - "Device sign-in no longer works" immediately after setup

## Root Causes

### Bug 1: Threading Issue
**Problem**: `BiometricPrompt` must be created and shown on the main UI thread, but the Capacitor plugin was running on a background thread.

**Error**: `java.lang.IllegalStateException: Must be called from main thread of fragment host`

**Fix**: Wrapped `BiometricPrompt` creation and `authenticate()` call in `fragmentActivity.runOnUiThread()`

### Bug 2: Per-Profile Storage Migration
**Problem**: Changed from global storage to per-profile storage (each profile gets its own Keystore key and SharedPreferences entry). Old data from v1 wasn't migrated.

**Fix**: 
- New key format: `bookle-biometric-vault-v2-profile-{profileId}`
- New storage format: `encrypted_payload_profile_{profileId}`
- Clear app data required for clean migration

### Bug 3: Key Deletion Timing
**Problem**: `deleteKey()` was called at start of `save()`, potentially deleting a key that was just created if save was called rapidly.

**Fix**: Only delete if key already exists in Keystore, with proper error handling.

## Files Changed

### Android Native Plugin
- `client/android/app/src/main/java/com/technative/audiobookmanager/BiometricVaultPlugin.java`
  - Added `Activity` import
  - Fixed threading: `runOnUiThread` for BiometricPrompt
  - Added detailed logging for debugging
  - Fixed key deletion logic
  - Per-profile Keystore keys and SharedPreferences

### TypeScript Layer
- `client/src/lib/biometricVault.ts`
  - Added `profileId` parameter to all methods
  - Added retry logic for transient `VAULT_UNAVAILABLE` errors
  - Enhanced logging with profile ID

- `client/src/lib/biometricFailure.ts`
  - Enhanced error messages for all failure types
  - Added `unavailable` and `transient` error categories

- `client/src/components/DeviceUnlockSettings.tsx`
  - Offline biometric support (no server registration needed)
  - Per-profile storage support
  - Different UI text for online vs offline modes

- `client/src/components/OfflineUnlock.tsx`
  - Per-profile biometric unlock
  - Support for both storage formats (with/without server secret)
  - Specific error messages for each failure type

- `client/src/components/AccountGate.tsx`
  - Per-profile biometric sign-in
  - Optional server secret handling
  - Enhanced error messages

- `client/src/App.tsx`
  - Updated `hasSavedValue` call with profileId

- `client/src/copy.ts`
  - Added new error messages:
    - `deviceUnavailable`, `deviceNotEnrolled`, `deviceTransient`
    - `deviceIntroOffline`, `deviceEnableOffline`, `deviceNeedsPasswordOffline`

### Settings UI
- `client/src/components/Settings.tsx`
  - Added build version indicator at bottom

### Tests Created
- `client/src/lib/biometricVault.test.ts` - Unit tests (16/17 passing)
- `client/src/components/DeviceUnlockSettings.integration.test.tsx` - Integration tests
- `client/src/components/OfflineUnlock.biometric.test.tsx` - Unlock flow tests
- `client/src/lib/biometricVault.spec.ts` - Manual test specification and debugging checklist

## Verification Steps

1. Clear app data (Settings → Apps → Audiobook Manager → Storage → Clear Data)
2. Open app, sign in with password
3. Go to Settings → Enable fingerprint (should work on single click)
4. Close app completely
5. Reopen app → Click "Unlock with fingerprint" → Should work!

## Build Version
- Current: `2026-10-29 11:31 UTC` (visible at bottom of Settings page)

## Debugging
Watch Android logs: `adb logcat -s BiometricVault:D`

Expected log flow for setup:
```
D BiometricVault: save() called for profile X
D BiometricVault: Creating new key for profile X
D BiometricVault: Initializing cipher for profile X
D BiometricVault: Showing biometric prompt for profile X
```

Expected log flow for unlock:
```
D BiometricVault: unlock() called for profile X
D BiometricVault: Found saved value for profile X
D BiometricVault: Getting key for profile X
D BiometricVault: Key found for alias: bookle-biometric-vault-v2-profile-X
D BiometricVault: Showing biometric prompt for unlock profile X
```

## Testing Notes
- Unit tests validate TypeScript API layer
- Integration tests validate component flows (need device for biometric)
- Manual test spec documents all test cases and debugging steps

## Future Improvements
1. Add migration for existing v1 biometric data
2. Consider adding biometric setup from offline unlock screen
3. Add device management UI to see registered devices per profile