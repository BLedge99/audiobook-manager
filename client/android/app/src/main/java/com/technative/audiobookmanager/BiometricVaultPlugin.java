package com.technative.audiobookmanager;

import android.app.Activity;
import android.os.Build;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

/** Stores device credentials only as AES-GCM ciphertext protected by Android Keystore. */
@CapacitorPlugin(name = "BiometricVault")
public class BiometricVaultPlugin extends Plugin {
  private static final String KEY_ALIAS_PREFIX = "bookle-biometric-vault-v2-profile-";
  private static final String PREFS = "bookle_biometric_vault";
  private static final String VALUE_PREFIX = "encrypted_payload_profile_";

  @PluginMethod public void isAvailable(PluginCall call) {
    int result = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
    JSObject response = new JSObject();
    response.put("available", result == BiometricManager.BIOMETRIC_SUCCESS);
    call.resolve(response);
  }

  @PluginMethod public void hasSavedValue(PluginCall call) {
    Integer profileId = call.getInt("profileId");
    if (profileId == null) { call.reject("profileId required"); return; }
    String valueKey = VALUE_PREFIX + profileId;
    boolean saved = getContext().getSharedPreferences(PREFS, 0).contains(valueKey);
    JSObject response = new JSObject();
    response.put("saved", saved);
    call.resolve(response);
  }

  @PluginMethod public void save(PluginCall call) {
    String payload = call.getString("payload");
    Integer profileId = call.getInt("profileId");
    if (payload == null || payload.length() > 12000) { call.reject("Invalid vault value"); return; }
    if (profileId == null) { call.reject("profileId required"); return; }
    String keyAlias = KEY_ALIAS_PREFIX + profileId;
    String valueKey = VALUE_PREFIX + profileId;
    
    android.util.Log.d("BiometricVault", "save() called for profile " + profileId);
    
    try {
      // Always delete and recreate the key to ensure it's fresh and valid
      // The key is invalidated when biometric enrollment changes anyway
      try {
        deleteKey(keyAlias);
        android.util.Log.d("BiometricVault", "Deleted existing key for profile " + profileId);
      } catch (Exception e) { 
        android.util.Log.d("BiometricVault", "No existing key to delete for profile " + profileId);
      }
      
      android.util.Log.d("BiometricVault", "Creating new key for profile " + profileId);
      SecretKey key = createKey(keyAlias);
      
      android.util.Log.d("BiometricVault", "Initializing cipher for profile " + profileId);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key);
      
      android.util.Log.d("BiometricVault", "Showing biometric prompt for profile " + profileId);
      prompt(call, cipher, true, payload, valueKey);
    } catch (Exception error) { 
      android.util.Log.e("BiometricVault", "save() failed for profile " + profileId, error);
      call.reject("VAULT_UNAVAILABLE: Biometric vault unavailable", error); 
    }
  }
  @PluginMethod public void unlock(PluginCall call) {
    Integer profileId = call.getInt("profileId");
    if (profileId == null) { call.reject("profileId required"); return; }
    String keyAlias = KEY_ALIAS_PREFIX + profileId;
    String valueKey = VALUE_PREFIX + profileId;
    
    android.util.Log.d("BiometricVault", "unlock() called for profile " + profileId);
    
    try {
      String stored = getContext().getSharedPreferences(PREFS, 0).getString(valueKey, null);
      if (stored == null) { 
        android.util.Log.e("BiometricVault", "No saved value found for profile " + profileId);
        call.reject("No biometric unlock is set up"); 
        return; 
      }
      
      android.util.Log.d("BiometricVault", "Found saved value for profile " + profileId);
      
      byte[] combined = Base64.decode(stored, Base64.NO_WRAP);
      byte[] iv = new byte[12];
      System.arraycopy(combined, 0, iv, 0, iv.length);
      
      android.util.Log.d("BiometricVault", "Getting key for profile " + profileId);
      SecretKey key = getKey(keyAlias);
      
      android.util.Log.d("BiometricVault", "Initializing cipher for unlock profile " + profileId);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
      
      android.util.Log.d("BiometricVault", "Showing biometric prompt for unlock profile " + profileId);
      prompt(call, cipher, false, null, valueKey);
    } catch (Exception error) {
      // Stable code: the Keystore key is gone or was invalidated (enrolling a
      // new fingerprint does that), so this saved value can never be opened
      // again. The client clears it and falls back to the password. Without
      // this code the failure looked identical to a transient one, which is
      // how a phone ended up with a permanently unusable device sign-in.
      android.util.Log.e("BiometricVault", "unlock() failed for profile " + profileId + " - key likely invalidated", error);
      call.reject("VAULT_KEY_INVALID: Biometric vault unavailable", error);
    }
  }

  @PluginMethod public void clear(PluginCall call) {
    Integer profileId = call.getInt("profileId");
    if (profileId == null) { call.reject("profileId required"); return; }
    String keyAlias = KEY_ALIAS_PREFIX + profileId;
    String valueKey = VALUE_PREFIX + profileId;
    
    android.util.Log.d("BiometricVault", "clear() called for profile " + profileId);
    
    getContext().getSharedPreferences(PREFS, 0).edit().remove(valueKey).apply();
    try { 
      deleteKey(keyAlias);
      android.util.Log.d("BiometricVault", "Clear successful for profile " + profileId);
      call.resolve();
    } catch (Exception error) {
      android.util.Log.e("BiometricVault", "Clear failed for profile " + profileId, error);
      call.reject("Failed to clear keystore", error);
    }
  }
  private SecretKey createKey(String keyAlias) throws Exception {
    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(keyAlias,
      KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setUserAuthenticationRequired(true);
    if (Build.VERSION.SDK_INT >= 24) spec.setInvalidatedByBiometricEnrollment(true);
    if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
    else spec.setUserAuthenticationValidityDurationSeconds(-1);
    generator.init(spec.build());
    return generator.generateKey();
  }

  private SecretKey getKey(String keyAlias) throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    SecretKey key = (SecretKey) store.getKey(keyAlias, null);
    if (key == null) {
      android.util.Log.e("BiometricVault", "Key NOT FOUND in Keystore for alias: " + keyAlias);
      // List all keys in keystore for debugging
      try {
        java.util.Enumeration<String> aliases = store.aliases();
        android.util.Log.d("BiometricVault", "Available keys in Keystore:");
        while (aliases.hasMoreElements()) {
          String alias = aliases.nextElement();
          android.util.Log.d("BiometricVault", "  - " + alias);
        }
      } catch (Exception e) {
        android.util.Log.e("BiometricVault", "Failed to list keystore aliases", e);
      }
      throw new Exception("Key not found in Keystore: " + keyAlias);
    }
    android.util.Log.d("BiometricVault", "Key found for alias: " + keyAlias);
    return key;
  }

  private void deleteKey(String keyAlias) throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    store.deleteEntry(keyAlias);
  }

  private void prompt(PluginCall call, Cipher cipher, boolean encrypt, String payload, String valueKey) {
    Activity activity = getActivity();
    if (!(activity instanceof FragmentActivity)) { 
      android.util.Log.e("BiometricVault", "Activity is not FragmentActivity: " + activity);
      call.reject("VAULT_UNAVAILABLE: Biometric prompt unavailable"); 
      return; 
    }
    FragmentActivity fragmentActivity = (FragmentActivity) activity;
    
    // Must run on main thread for BiometricPrompt
    fragmentActivity.runOnUiThread(() -> {
      BiometricPrompt prompt = new BiometricPrompt(fragmentActivity, ContextCompat.getMainExecutor(fragmentActivity), new BiometricPrompt.AuthenticationCallback() {
      @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
        try {
          Cipher authenticated = result.getCryptoObject().getCipher();
          if (encrypt) {
            byte[] encrypted = authenticated.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[authenticated.getIV().length + encrypted.length];
            System.arraycopy(authenticated.getIV(), 0, combined, 0, authenticated.getIV().length);
            System.arraycopy(encrypted, 0, combined, authenticated.getIV().length, encrypted.length);
            getContext().getSharedPreferences(PREFS, 0).edit().putString(valueKey, Base64.encodeToString(combined, Base64.NO_WRAP)).apply();
            call.resolve();
          } else {
            byte[] combined = Base64.decode(getContext().getSharedPreferences(PREFS, 0).getString(valueKey, ""), Base64.NO_WRAP);
            byte[] encrypted = new byte[combined.length - 12];
            System.arraycopy(combined, 12, encrypted, 0, encrypted.length);
            String value = new String(authenticated.doFinal(encrypted), StandardCharsets.UTF_8);
            JSObject response = new JSObject();
            response.put("payload", value);
            call.resolve(response);
          }
        } catch (Exception error) {
          call.reject(encrypt ? "VAULT_UNAVAILABLE: Biometric check failed" : "VAULT_KEY_INVALID: Biometric check failed", error);
        }
      }
      @Override public void onAuthenticationError(int code, CharSequence message) {
        // Keep the numeric code in the message: an older client classifies on
        // it, and the stable prefix is what the current one reads first.
        call.reject(biometricErrorCode(code) + ": Biometric prompt error code " + code + ": " + message);
      }
      @Override public void onAuthenticationFailed() { /* Allow the OS to retry. */ }
    });
    prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
      .setTitle(promptValue(call, "title", "Open your profile"))
      .setSubtitle(promptValue(call, "subtitle", "Use your fingerprint or face to continue."))
      .setNegativeButtonText(promptValue(call, "cancel", "Use password"))
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
      .build(), new BiometricPrompt.CryptoObject(cipher));
    }); // End runOnUiThread
  }

  private String promptValue(PluginCall call, String key, String fallback) {
    String value = call.getString(key);
    return value == null || value.isEmpty() ? fallback : value;
  }

  /**
   * Stable code for an androidx.biometric error, so the client can tell a
   * cancellation from a lockout from a broken key without parsing prose.
   *
   * These groupings match `client/src/lib/biometricFailure.ts`. A cancellation
   * must never be retried: that is what made pressing "Use password" open the
   * prompt again.
   */
  private static String biometricErrorCode(int code) {
    switch (code) {
      case 5:  // ERROR_CANCELED
      case 10: // ERROR_NEGATIVE_BUTTON
      case 13: // ERROR_USER_CANCELED
        return "BIOMETRIC_CANCELLED";
      case 7:  // ERROR_LOCKOUT
      case 9:  // ERROR_LOCKOUT_PERMANENT
        return "BIOMETRIC_LOCKOUT";
      case 1:  // ERROR_HW_UNAVAILABLE
      case 11: // ERROR_NO_BIOMETRICS
      case 12: // ERROR_HW_NOT_PRESENT
        return "BIOMETRIC_UNAVAILABLE";
      case 2:  // ERROR_UNABLE_TO_PROCESS
      case 3:  // ERROR_TIMEOUT
      case 8:  // ERROR_VENDOR
        return "BIOMETRIC_TRANSIENT";
      default:
        return "BIOMETRIC_ERROR";
    }
  }
}
