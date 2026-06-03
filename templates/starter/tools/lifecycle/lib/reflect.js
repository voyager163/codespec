'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { emit } = require('./bus');
const { brainDir } = require('./workspace');

// The reflection step (Hermes discipline): after a change, record a lesson into
// the (possibly shared) Learning_Experience/ so the system stops repeating
// mistakes — across every project in the workspace.
function reflect(root, opts = {}) {
  const dir = brainDir(root); // shared brain when inside a workspace
  fs.mkdirSync(dir, { recursive: true });

  const id = nextId(dir);
  const title = opts.title || 'Untitled lesson';
  const severity = opts.severity || 'minor';
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'lesson';
  const file = path.join(dir, `${id}-${slug}.md`);

  fs.writeFileSync(
    file,
    `# ${title}\n\n` +
      `- **Severity:** ${severity}\n` +
      `- **Logged:** ${new Date().toISOString().slice(0, 10)}\n` +
      (opts.rotation ? `- **Rotation:** ${opts.rotation}\n` : '') +
      `\n## What happened\n\n${opts.what || '(describe what went wrong or what worked)'}\n\n` +
      `## How to apply next time\n\n${opts.how || '(the rule to follow so this does not recur)'}\n`,
  );

  // Keep a one-line index if the project uses LEARNINGS.md.
  const index = path.join(dir, 'LEARNINGS.md');
  if (fs.existsSync(index)) {
    fs.appendFileSync(index, `- ${id} — ${title} (${severity})\n`);
  }

  emit(root, { agent: 'reflector', stage: 6, level: 'good', message: `Reflection logged ${id}: ${title}`, data: { lesson: id, severity } });
  return { id, file };
}

function nextId(dir) {
  let max = 0;
  for (const name of fs.readdirSync(dir)) {
    const m = /^L(\d+)/i.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `L${String(max + 1).padStart(3, '0')}`;
}

module.exports = { reflect };
