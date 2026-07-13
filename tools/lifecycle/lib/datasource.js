'use strict';
// datasource.js — wraps `pac code add-data-source`, wiring a Dataverse table or
// another already-connected connector into the Code App's power.config.json.
// Table logical names must already exist (created via `dataverse-schema.js`'s
// applySchema); this module only performs the pac CLI wiring step.
const pacInit = require('./pac-init');

// Add a data source to the Code App at `root`/`appDir`.
//   api   — the pac connector id, e.g. "dataverse" or a shared_* connector id
//   table — required for Dataverse (a table logical name); omitted for other connectors
// `_pac` injects { checkPac, runPac } for deterministic tests (defaults to pac-init.js).
async function addDataSource(root, { api, table, appDir, emit = async () => {}, _pac } = {}) {
  const p = _pac || { checkPac: pacInit.checkPac, runPac: pacInit.runPac };
  if (!api) {
    return { added: false, output: '', error: 'No api/connector id given — which data source? (e.g. "dataverse")' };
  }
  try {
    await p.checkPac();
  } catch (e) {
    return { added: false, output: '', error: e.message };
  }
  const args = ['code', 'add-data-source', '-a', api];
  if (table) args.push('-t', table);
  const dir = appDir || root;
  await emit({ level: 'info', message: `pac ${args.join(' ')} in ${dir}` });
  const r = await p.runPac(args, { cwd: dir });
  if (r.code !== 0) {
    await emit({ level: 'bad', message: `pac code add-data-source failed:\n${r.stderr || r.stdout}` });
    return { added: false, output: r.stdout + '\n' + r.stderr, error: r.stderr || r.stdout };
  }
  await emit({ level: 'good', message: `Data source "${api}"${table ? ' (' + table + ')' : ''} added` });
  return { added: true, output: r.stdout };
}

module.exports = { addDataSource };
