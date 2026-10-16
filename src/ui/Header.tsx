import { usePack } from '../state/context';
import { downloadText } from '../lib/download';
import { exportBundle, toJson } from '../storage/repo';
import { today } from '../lib/dates';
import { href } from './router';

const SOURCE: Record<string, string> = { folder: 'Ordner', dev: 'Dev-Server', browser: 'Browser' };

export function Header() {
  const { loaded, fs, close } = usePack();
  const { pack } = loaded;
  const exportPack = async () => {
    downloadText(`${pack.id}-${today()}.pack.json`, toJson(await exportBundle(fs)));
  };
  return (
    <header class="topbar">
      <a class="brand" href={href({ name: 'dashboard' })}>
        {pack.title}
      </a>
      <span class="meta">
        {pack.semester?.label && `${pack.semester.label} · `}
        {SOURCE[fs.kind]}: {fs.label}
      </span>
      <span class="spacer" />
      <nav>
        <a class="btn small" href={href({ name: 'log' })}>
          Verlauf
        </a>
        <button class="small" onClick={exportPack} title="Ganzes Pack als eine JSON-Datei herunterladen">
          Export
        </button>
        <a class="btn small" href={href({ name: 'settings' })}>
          Einstellungen
        </a>
        <button class="small ghost" onClick={close}>
          Pack wechseln
        </button>
      </nav>
    </header>
  );
}
