/**
 * The build's own timestamp, injected by Vite's `define`.
 *
 * Every APK reports `versionName` 1.0, so the phone cannot tell you whether
 * it is running the build you just made or the one from last week. "Did my
 * change take?" is a question worth being able to answer on the device
 * itself, and it is asked whenever a build is installed and the result is not
 * what was expected.
 */
declare const __BUILD_TIME__: string;
