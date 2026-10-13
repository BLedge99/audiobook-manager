import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { installApiBaseUrl } from './lib/api';
import './index.css';

// Must run before the first render: every module in the app fetches `/api/...`
// relative, and this is what points those at the configured server on Android
// (spec 26). In the browser it is a no-op, because no server URL is set.
installApiBaseUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);