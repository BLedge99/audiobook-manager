/*
 * Apply the saved theme before first paint.
 *
 * Without this, a listener who chose dark mode gets a white flash every
 * time the app opens -- the CSS is only applied once the bundle runs, and
 * on the APK that is visible as a flash before the splash. "auto" is left
 * unset on purpose so the stylesheet's prefers-color-scheme block handles
 * it without JavaScript.
 *
 * Kept as a separate file (not inline) so the Content-Security-Policy can
 * use script-src 'self' with no 'unsafe-inline'.
 */
(function () {
  try {
    var choice = localStorage.getItem("bookle-theme");
    if (choice === "light" || choice === "dark") {
      document.documentElement.setAttribute("data-theme", choice);
    }
  } catch (error) {
    /* private mode or storage disabled: fall back to the system theme. */
  }
})();
