// MCP prompts: surface all .github/prompts/*.md OPSX workflow files as MCP prompts.
//
// Content is read at REQUEST time (not registration), so editing a prompt file is
// reflected immediately without a server restart. A best-effort watcher registers
// prompt files added after startup and notifies the host (Fix 2.2).
//
// Known limitation: the MCP SDK only installs the prompts/* request handlers (and
// advertises the prompts capability) once the first prompt is registered. If a
// project starts with an EMPTY .github/prompts directory, the watcher can register
// files added later, but a client that negotiated no prompts capability at connect
// may not surface them until the next server restart.

import { existsSync, readdirSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';

function promptName(file) {
  return `opsx_${path.basename(file, '.md').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
}

export function registerOpsxPrompts(server, defaultRoot) {
  const promptsDir = path.join(defaultRoot, '.github', 'prompts');
  if (!existsSync(promptsDir)) return;

  const registered = new Set();

  const registerFile = (file) => {
    const name = promptName(file);
    if (registered.has(name)) return;
    registered.add(name);
    const filePath = path.join(promptsDir, file);
    server.prompt(
      name,
      `OPSX workflow prompt: ${path.basename(file, '.md')}`,
      () => {
        // Read fresh on every request so edits take effect without a restart.
        let text;
        try { text = readFileSync(filePath, 'utf8'); }
        catch { text = `Prompt file ${file} could not be read.`; }
        return { messages: [{ role: 'user', content: { type: 'text', text } }] };
      },
    );
  };

  const scan = () => {
    try {
      for (const f of readdirSync(promptsDir).filter((f) => f.endsWith('.md'))) registerFile(f);
    } catch {
      /* directory vanished or unreadable — nothing to register */
    }
  };

  scan();

  // Best-effort: pick up prompt files added later. fs.watch is platform-dependent,
  // so any failure here is swallowed — the initial scan still works.
  try {
    let pending = null;
    const w = watch(promptsDir, () => {
      clearTimeout(pending);
      pending = setTimeout(scan, 150); // debounce rapid editor events
      pending.unref?.();
    });
    w.unref?.();
  } catch {
    /* watching unsupported here — initial scan is the floor */
  }
}
