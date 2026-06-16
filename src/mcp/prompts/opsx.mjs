// MCP prompts: surface all .github/prompts/*.md OPSX workflow files as MCP prompts.
// Each file becomes a named prompt the host can inject into the conversation.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function registerOpsxPrompts(server, defaultRoot) {
  const promptsDir = path.join(defaultRoot, '.github', 'prompts');
  if (!existsSync(promptsDir)) return;

  let files;
  try {
    files = readdirSync(promptsDir).filter((f) => f.endsWith('.md'));
  } catch {
    return;
  }

  for (const file of files) {
    const name = `opsx_${path.basename(file, '.md').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
    const filePath = path.join(promptsDir, file);
    const content = readFileSync(filePath, 'utf8');

    server.prompt(
      name,
      `OPSX workflow prompt: ${path.basename(file, '.md')}`,
      () => ({
        messages: [{
          role: 'user',
          content: { type: 'text', text: content },
        }],
      }),
    );
  }
}
