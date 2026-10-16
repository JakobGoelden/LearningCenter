import { useEffect, useState } from 'preact/hooks';
import { usePack } from '../state/context';
import { readEvents } from '../storage/repo';
import type { LogEvent } from '../model/types';
import { href } from './router';

export function LogView() {
  const { fs, loaded } = usePack();
  const [events, setEvents] = useState<LogEvent[] | null>(null);
  useEffect(() => {
    readEvents(fs, 300).then((e) => setEvents(e.reverse()));
  }, [fs, loaded]);
  const names = new Map(loaded.subjects.map((s) => [s.id, s.short ?? s.name]));
  return (
    <div class="stack">
      <div class="page-head">
        <a href={href({ name: 'dashboard' })}>← Dashboard</a>
        <h1>Verlauf</h1>
        <span class="muted small">log/events.jsonl, neueste zuerst</span>
      </div>
      <div class="panel table-wrap">
        {events === null ? (
          <span class="muted">Lade …</span>
        ) : events.length === 0 ? (
          <span class="muted">Noch keine Ereignisse.</span>
        ) : (
          <table class="small">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Ereignis</th>
                <th>Fach</th>
                <th>Bezug</th>
                <th>Daten</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr>
                  <td style="white-space:nowrap">{new Date(e.ts).toLocaleString('de-DE')}</td>
                  <td>
                    <code>{e.type}</code>
                  </td>
                  <td>{e.subject ? names.get(e.subject) ?? e.subject : ''}</td>
                  <td>
                    <code>{e.ref}</code>
                  </td>
                  <td>
                    <code>{e.data ? JSON.stringify(e.data).slice(0, 160) : ''}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
