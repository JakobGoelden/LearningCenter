// The AI API on the command line, for AIs without MCP. Prints JSON.
// Usage (from the repo root):
//   npm run ai -- list
//   npm run ai -- <tool> [--pack <dir>] [--<argument> <value>]...
// Examples:
//   npm run ai -- get_weak_spots --subject db --limit 5
//   npm run ai -- edit_card --subject db --topic acid --id acid-i --answer "- ..."
import { callTool, TOOLS } from '../src/api/tools';
import { openPack } from './open-pack';

const [tool, ...rest] = process.argv.slice(2);
if (!tool || tool === 'list') {
  for (const t of TOOLS) {
    const args = Object.keys(t.inputSchema.properties).map((k) => (t.inputSchema.required?.includes(k) ? k : `[${k}]`));
    console.log(`${t.name} ${args.join(' ')}\n  ${t.description}\n`);
  }
  process.exit(tool ? 0 : 2);
}
const spec = TOOLS.find((t) => t.name === tool);
const args: Record<string, unknown> = {};
let pack: string | undefined;
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i].replace(/^--/, '').replace(/-/g, '_');
  const value = rest[i + 1] ?? '';
  if (key === 'pack') pack = value;
  else {
    const type = (spec?.inputSchema.properties[key] as { type?: string } | undefined)?.type;
    args[key] = type === 'integer' ? Number(value) : type === 'boolean' ? value === 'true' : type === 'array' ? value.split(',') : value;
  }
}
try {
  console.log(JSON.stringify(await callTool(openPack(pack), tool, args), null, 2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
