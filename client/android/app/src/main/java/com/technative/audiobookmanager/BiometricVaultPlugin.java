package com.technative.audiobookmanager;

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
  private static final String KEY_ALIAS = "bookle-biometric-vault-v1";
  private static final String PREFS = "bookle_biometric_vault";
  private static final String VALUE = "encrypted_payload";

  @PluginMethod public void isAvailable(PluginCall call) {
    int result = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
    JSObject response = new JSObject();
    response.put("available", result == BiometricManager.BIOMETRIC_SUCCESS);
    call.resolve(response);
  }

  @PluginMethod public void hasSavedValue(PluginCall call) {
    boolean saved = getContext().getSharedPreferences(PREFS, 0).contains(VALUE);
    JSObject response = new JSObject();
    response.put("saved", saved);
    call.resolve(response);
  }

  @PluginMethod public void save(PluginCall call) {
    String payload = call.getString("payload");
    if (payload == null || payload.length() > 12000) { call.reject("Invalid vault value"); return; }
    try {
      deleteKey();
      SecretKey key = createKey();
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key);
      prompt(call, cipher, true, payload);
    } catch (Exception error) { call.reject("Biometric vault unavailable", error); }
  }

  @PluginMethod public void unlock(PluginCall call) {
    try {
      String stored = getContext().getSharedPreferences(PREFS, 0).getString(VALUE, null);
      if (stored == null) { call.reject("No biometric unlock is set up"); return; }
      byte[] combined = Base64.decode(stored, Base64.NO_WRAP);
      byte[] iv = new byte[12];
      System.arraycopy(combined, 0, iv, 0, iv.length);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(128, iv));
      prompt(call, cipher, false, null);
    } catch (Exception error) { call.reject("Biometric vault unavailable", error); }
  }

  @PluginMethod public void clear(PluginCall call) {
    getContext().getSharedPreferences(PREFS, 0).edit().remove(VALUE).apply();
    try { deleteKey(); } catch (Exception ignored) {}
    call.resolve();
  }

  private SecretKey createKey() throws Exception {
    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(KEY_ALIAS,
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

  private SecretKey getKey() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    return (SecretKey) store.getKey(KEY_ALIAS, null);
  }

  private void deleteKey() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    store.deleteEntry(KEY_ALIAS);
  }

  private void prompt(PluginCall call, Cipher cipher, boolean encrypt, String payload) {
    if (!(getActivity() instanceof FragmentActivity)) { call.reject("Biometric prompt unavailable"); return; }
    FragmentActivity activity = (FragmentActivity) getActivity();
    BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
      @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
        try {
          Cipher authenticated = result.getCryptoObject().getCipher();
          if (encrypt) {
            byte[] encrypted = authenticated.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[authenticated.getIV().length + encrypted.length];
            System.arraycopy(authenticated.getIV(), 0, combined, 0, authenticated.getIV().length);
            System.arraycopy(encrypted, 0, combined, authenticated.getIV().length, encrypted.length);
            getContext().getSharedPreferences(PREFS, 0).edit().putString(VALUE, Base64.encodeToString(combined, Base64.NO_WRAP)).apply();
            call.resolve();
          } else {
            byte[] combined = Base64.decode(getContext().getSharedPreferences(PREFS, 0).getString(VALUE, ""), Base64.NO_WRAP);
            byte[] encrypted = new byte[combined.length - 12];
            System.arraycopy(combined, 12, encrypted, 0, encrypted.length);
            String value = new String(authenticated.doFinal(encrypted), StandardCharsets.UTF_8);
            JSObject response = new JSObject();
            response.put("payload", value);
            call.resolve(response);
          }
        } catch (Exception error) { call.reject("Biometric check failed", error); }
      }
      @Override public void onAuthenticationError(int code, CharSequence message) { call.reject("Biometric check cancelled"); }
      @Override public void onAuthenticationFailed() { /* Allow the OS to retry. */ }
    });
    prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
      .setTitle(promptValue(call, "title", "Open your profile"))
      .setSubtitle(promptValue(call, "subtitle", "Use your fingerprint or face to continue."))
      .setNegativeButtonText(promptValue(call, "cancel", "Use password"))
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
      .build(), new BiometricPrompt.CryptoObject(cipher));
  }

  private String promptValue(PluginCall call, String key, String fallback) {
    String value = call.getString(key);
    return value == null || value.isEmpty() ? fallback : value;
  }
}
