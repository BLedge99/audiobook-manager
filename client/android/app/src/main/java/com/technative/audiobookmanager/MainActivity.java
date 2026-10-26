package com.technative.audiobookmanager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override public void onCreate(android.os.Bundle savedInstanceState) {
    registerPlugin(BiometricVaultPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
