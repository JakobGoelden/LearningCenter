/**
 * Installable app and offline use (production builds only): registers the
 * service worker (public/sw.js), asks once for persistent storage, and keeps
 * the browser's install prompt for InstallHint.
 */

const PERSIST_KEY = 'lc.pwa.persistAsked';
/** How often an open app checks for a new service worker when it comes to the foreground. */
const UPDATE_EVERY_MS = 30 * 60 * 1000;

/** Chrome's install prompt (not in the DOM typings). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<(e: InstallPromptEvent | null) => void>();

function setInstallPrompt(e: InstallPromptEvent | null) {
  installPrompt = e;
  for (const l of listeners) l(e);
}

/** The pending install prompt (Android/desktop Chrome), or null. */
export function getInstallPrompt(): InstallPromptEvent | null {
  return installPrompt;
}

/** Calls `listener` whenever the install prompt appears or goes; returns the unsubscribe function. */
export function onInstallPromptChange(listener: (e: InstallPromptEvent | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the browser's install dialog; true if the person installed the app. */
export async function promptInstall(): Promise<boolean> {
  const e = installPrompt;
  if (!e) return false;
  setInstallPrompt(null); // a prompt can be shown only once
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

/** Running as an installed app (home screen), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** iPhone or iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Call once at start-up. Does nothing in development (Vite HMR) or without service worker support. */
export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own button instead of the mini-infobar
    setInstallPrompt(e as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => setInstallPrompt(null));

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const start = () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        let checked = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || Date.now() - checked < UPDATE_EVERY_MS) return;
          checked = Date.now();
          reg.update().catch(() => {});
        });
      })
      .catch((e) => console.warn('Service worker not registered:', e));
    askPersistentStorage();
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/** Asks once for storage the browser does not evict under pressure (Android); harmless elsewhere. */
function askPersistentStorage() {
  try {
    if (localStorage.getItem(PERSIST_KEY)) return;
    localStorage.setItem(PERSIST_KEY, '1');
  } catch {
    return;
  }
  navigator.storage
    ?.persisted?.()
    .then((done) => (done ? true : navigator.storage.persist?.()))
    .catch(() => {});
}
