import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setupSwReload } from './swUpdate.ts';
import { isPrivacyPath } from './lib/privacyPath.ts';

const PrivacyNotice = lazy(() => import('./pages/PrivacyNotice.tsx'));

const privacy = isPrivacyPath(window.location.pathname);

// The notice is a document, not a session: there is nothing to reload it into.
if (!privacy) setupSwReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {privacy ? (
      <Suspense fallback={<div className="min-h-dvh bg-ground" />}>
        <PrivacyNotice />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
