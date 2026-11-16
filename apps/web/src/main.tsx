import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './i18n';
import { SessionProvider } from './session';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider fallback={<div className="splash" />}>
      <App />
    </SessionProvider>
  </StrictMode>,
);

// Service worker: updates install silently (see sw.ts). Not in dev, where Vite serves modules directly.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js', { type: 'module' }).catch(() => {});
}
