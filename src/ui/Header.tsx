import { usePack } from '../state/context';
import { downloadText } from '../lib/download';
import { exportBundle, toJson } from '../storage/repo';
import { today } from '../lib/dates';
import { href } from './router';

const SOURCE: Record<string, string> = { folder: 'Folder', dev: 'Dev server', browser: 'Browser' };

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
          History
        </a>
        <button class="small" onClick={exportPack} title="Download the whole pack as one JSON file">
          Export
        </button>
        <a class="btn small" href={href({ name: 'settings' })}>
          Settings
        </a>
        <button class="small ghost" onClick={close}>
          Switch pack
        </button>
      </nav>
    </header>
  );
}
