import { registerPlugin } from "@capacitor/core";
import { getServerUrl } from "./api";
import { isNativeShell } from "./platform";

interface NativeMediaProxyPlugin {
  setServerUrl(options: { serverUrl: string }): Promise<void>;
}

const nativeMediaProxy = registerPlugin<NativeMediaProxyPlugin>("NativeMediaProxy");

export function createMediaProxyUrl(targetUrl: string, appOrigin: string): string {
  const proxyUrl = new URL("/__media_proxy", appOrigin);
  proxyUrl.searchParams.set("target", targetUrl);
  return proxyUrl.toString();
}

export async function nativeMediaProxyUrl(targetUrl: string): Promise<string> {
  if (!isNativeShell()) return targetUrl;

  const serverUrl = getServerUrl();
  if (!serverUrl) return targetUrl;

  await nativeMediaProxy.setServerUrl({ serverUrl });
  return createMediaProxyUrl(targetUrl, window.location.origin);
}
