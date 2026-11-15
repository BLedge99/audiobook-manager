import { ArrowLeft } from "lucide-react";
import { copy } from "../../copy";
import { Btn, FullScreen, Wordmark } from "../../ui/primitives";

/**
 * The themed interstitial before the Google OAuth handoff (spec 41 phase 8):
 * a sideloaded app cannot be an Approved Mobile Application, so the redirect
 * is deliberate and explained, never a bare navigation.
 */
export function GoogleOauthConfirm({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title={copy.brand.name} subtitle={copy.brand.tagline} />
        <div className="panel mt-8 w-full min-w-0 max-w-sm px-4 py-6 text-center sm:px-6 sm:py-7">
          <svg viewBox="0 0 48 48" width="72" height="72" className="mx-auto drop-shadow-sm" aria-hidden="true">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.5-4.5H24v8.5h11.9c-.5 2.7-2.1 5-4.5 6.4v5.3h7.2c4.2-3.9 6.6-9.6 6.6-15.7z" />
            <path fill="#34A853" d="M24 46c5.9 0 10.8-1.9 14.4-5.2l-7.2-5.3c-2 1.3-4.6 2.1-7.2 2.1-5.6 0-10.4-3.8-12.1-8.8H4.4v5.5C8 40.6 15.4 46 24 46z" />
            <path fill="#FBBC05" d="M11.9 28.8c-1.1-2.6-1.1-5.3 0-7.9V15.5H4.4a22 22 0 0 0 0 17.8l7.5-4.5z" />
            <path fill="#EA4335" d="M24 9.5c3 0 5.7 1 7.9 3.1l5.9-5.9C33.3 3 28.8 1 24 1 15.4 1 8 6.4 4.4 15.5l7.5 5.8c1.6-4.9 6.5-8.8 12.1-8.8z" />
          </svg>
          <h1 className="mt-5 font-display text-2xl font-semibold text-ink">{copy.login.oauthGoogleConfirmHeading}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink2">{copy.login.oauthGoogleConfirmBody}</p>
          <Btn
            type="button"
            variant="primary"
            onClick={onContinue}
            className="mt-6 w-full"
          >
            {copy.login.oauthGoogleContinue}
          </Btn>
          <button
            type="button"
            onClick={onBack}
            className="mt-4 inline-flex items-center justify-center gap-1.5 text-sm font-bold text-ink3"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            {copy.account.back}
          </button>
        </div>
      </div>
    </FullScreen>
  );
}
