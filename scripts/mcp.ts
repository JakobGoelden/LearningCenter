// MCP server over stdio for the person's AI: one JSON message per line.
// Registered in .mcp.json. Anything but protocol messages must stay off stdout.
import { createInterface } from 'node:readline';
import { handleMessage } from '../src/api/mcp';
import { openPack } from './open-pack';

const fs = openPack();

// One at a time, in order: a read must see the write before it.
let queue: Promise<void> = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  queue = queue.then(async () => {
    let answer: object | null;
    try {
      answer = await handleMessage(fs, JSON.parse(line));
    } catch (e) {
      answer = { jsonrpc: '2.0', id: null, error: { code: -32700, message: (e as Error).message } };
    }
    if (answer) process.stdout.write(JSON.stringify(answer) + '\n');
  });
});
