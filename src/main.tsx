import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installApiFetch } from './lib/apiFetch';

installApiFetch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Real-User Monitoring for Core Web Vitals. Imported async after first
// paint so it never blocks the initial render — the observer attaches
// passively and ships samples on visibility change.
if (typeof window !== 'undefined') {
  const start = () => import('./lib/vitals').then((m) => m.reportWebVitals()).catch(() => {});
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(start, { timeout: 2000 });
  } else {
    setTimeout(start, 1500);
  }
}
