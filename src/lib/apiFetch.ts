import { auth } from './firebase';

const GUEST_USER_KEY = 'recall-guest-user';

async function resolveAuthHeader(): Promise<string | null> {
  try {
    const fbUser = auth?.currentUser;
    if (fbUser) {
      const token = await fbUser.getIdToken();
      if (token) return `Bearer ${token}`;
    }
  } catch {}
  return null;
}

function isGuest(): boolean {
  try {
    const fbUser = auth?.currentUser;
    if (fbUser) return false;
  } catch {}
  try {
    const raw = localStorage.getItem(GUEST_USER_KEY);
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.isGuest || (typeof u?.uid === 'string' && u.uid.startsWith('guest'))) return true;
    }
  } catch {}
  return true;
}

function isLocalRequest(input: RequestInfo | URL): boolean {
  try {
    if (typeof input === 'string') {
      if (input.startsWith('/')) return !input.startsWith('//');
      if (input.startsWith('http')) {
        const u = new URL(input);
        return u.origin === window.location.origin;
      }
      return true;
    }
    if (input instanceof URL) return input.origin === window.location.origin;
    if (input instanceof Request) {
      const u = new URL(input.url, window.location.origin);
      return u.origin === window.location.origin;
    }
  } catch {}
  return false;
}

function urlPathOf(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') {
      if (input.startsWith('http')) return new URL(input).pathname;
      return input.split('?')[0] || '';
    }
    if (input instanceof URL) return input.pathname;
    if (input instanceof Request) return new URL(input.url, window.location.origin).pathname;
  } catch {}
  return '';
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  const m = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
  return m;
}

// Any of these path prefixes can change the number of unread Inbox items:
//   /memories         — direct create / patch / delete (review, archive, trash)
//   /capture          — URL / PDF / voice / time-bundle / session captures all
//                       eventually call save_memory and add to the inbox
// Mutating verbs against any of those broadcast a single global event that
// the sidebar listens to. Doing it here means every existing and future
// capture/triage call site refreshes the badge automatically — no per-page
// wiring needed.
const INBOX_AFFECTING_PREFIXES = ['/memories', '/capture'];

function maybeBroadcastInboxChange(input: RequestInfo | URL, init?: RequestInit): void {
  try {
    const path = urlPathOf(input);
    if (!INBOX_AFFECTING_PREFIXES.some(p => path === p || path.startsWith(p + '/'))) return;
    const method = methodOf(input, init);
    if (method === 'GET' || method === 'HEAD') return;
    window.dispatchEvent(new CustomEvent('inbox-count-refresh'));
  } catch {}
}

export function installApiFetch(): void {
  if ((window as any).__apiFetchInstalled) return;
  (window as any).__apiFetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isLocalRequest(input)) {
      return originalFetch(input as any, init);
    }
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Authorization')) {
      const authHeader = await resolveAuthHeader();
      if (authHeader) {
        headers.set('Authorization', authHeader);
      }
    }
    const nextInit: RequestInit = { ...(init || {}), headers };
    const res = await originalFetch(input as any, nextInit);
    if (res.ok) maybeBroadcastInboxChange(input, init);
    return res;
  };
}

export function getCurrentApiUserId(): string {
  try {
    const fbUser = auth?.currentUser;
    if (fbUser && !fbUser.isAnonymous) return fbUser.uid;
  } catch {}
  try {
    const raw = localStorage.getItem(GUEST_USER_KEY);
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.isGuest || (typeof u?.uid === 'string' && u.uid.startsWith('guest'))) return 'guest';
      if (u?.uid) return String(u.uid);
    }
  } catch {}
  return 'guest';
}
