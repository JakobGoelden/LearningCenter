import { useEffect, useState } from 'preact/hooks';
import { getInstallPrompt, isIos, isStandalone, onInstallPromptChange, promptInstall } from './register';

const DISMISSED_KEY = 'lc.pwa.installHintDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Suggests installing the app: on iOS (not yet installed) how to add it to the
 * home screen, elsewhere an "Install app" button when the browser offers one.
 * Renders nothing once installed or dismissed.
 */
export function InstallHint() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [prompt, setPrompt] = useState(getInstallPrompt);
  useEffect(() => onInstallPromptChange(setPrompt), []);

  if (dismissed || isStandalone()) return null;
  const ios = isIos();
  if (!ios && !prompt) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* remembered for this visit only */
    }
  };

  return (
    <div class="notice pwa-hint" role="note">
      {ios ? (
        <span class="pwa-hint-text">Install: Share → Add to Home Screen. Otherwise iOS deletes offline data after 7 days.</span>
      ) : (
        <>
          <span class="pwa-hint-text">Install the app to learn offline.</span>
          <button class="primary small" onClick={() => promptInstall().catch(() => {})}>
            Install app
          </button>
        </>
      )}
      <button class="ghost small" onClick={dismiss} aria-label="Dismiss install hint">
        ✕
      </button>
    </div>
  );
}
