import { usePack } from '../state/context';
import { downloadText } from '../lib/download';
import { exportBundle, toJson } from '../storage/repo';
import { today } from '../lib/dates';
import { href } from './router';
import { Logo } from './Emblem';
import type { OutboxStatus } from '../storage/queued-fs';

const SOURCE: Record<string, string> = { folder: 'Folder', dev: 'Dev server', server: 'Server', browser: 'Browser' };

export function Header() {
  const { loaded, fs, close, outbox } = usePack();
  const { pack } = loaded;
  const exportPack = async () => {
    downloadText(`${pack.id}-${today()}.pack.json`, toJson(await exportBundle(fs)));
  };
  return (
    <header class="topbar">
      <a class="brand" href={href({ name: 'dashboard' })} title="Back to the dashboard">
        <Logo />
        {pack.title}
      </a>
      <span class="meta">
        {pack.semester?.label && `${pack.semester.label} · `}
        {SOURCE[fs.kind]}: {fs.label}
      </span>
      <span class="spacer" />
      <OutboxBadge status={outbox} />
      <nav>
        <a class="btn small primary" href={href({ name: 'study' })}>
          Study
        </a>
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

/** Answers waiting on this device: shown until the server has them. */
function OutboxBadge({ status }: { status: OutboxStatus | null }) {
  // Sending right now is normal and quick; say something only when it does not go through.
  if (!status || (!status.failed && (!status.pending || !status.problem))) return null;
  const n = status.pending;
  const text =
    status.problem === 'login'
      ? `${n} waiting: log in again to send`
      : status.failed
        ? `${status.failed} not accepted by the server${n ? `, ${n} waiting` : ''}`
        : `${n} not sent yet${status.problem === 'offline' ? ' (offline)' : ''}`;
  const title =
    status.problem === 'login'
      ? 'Your login has expired. Answers stay on this device until you log in again.'
      : status.failed
        ? 'The server refused some saved answers. They are kept on this device; tell the admin.'
        : 'Saved on this device. They are sent as soon as the server can be reached.';
  return (
    <span class={`outbox-badge${status.failed || status.problem === 'login' ? ' bad' : ''}`} role="status" title={title}>
      {status.problem === 'login' ? <a href="/login">{text}</a> : text}
    </span>
  );
}
