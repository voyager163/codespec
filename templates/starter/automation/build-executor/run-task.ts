// Reads a declarative task contract and runs the matching portal action. The
// codeapps skills (Dataverse, connectors, ALM) decide *what* is needed and drop
// a *.task.json here; this runner makes the browser do it. Gated by Approved_rights/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { assertAllowed } from '../shared/approved-rights';
import { loadEnv } from '../shared/env';
import { launchMdmContext } from '../shared/mdm-browser';
import { createDataverseTable, type ActionResult } from './actions/create-dataverse-table';

interface TaskContract {
  type: string;
  displayName?: string;
  schemaName?: string;
  columns?: Array<{ name: string; type: string }>;
  source?: string;
}

async function runTask(taskPath: string): Promise<void> {
  assertAllowed('allowBuild'); // stop and ask if not granted
  const task = JSON.parse(readFileSync(taskPath, 'utf8')) as TaskContract;
  const env = loadEnv();

  const context = await launchMdmContext({ profileDir: env.buildProfileDir, storageState: env.storageStatePath });
  const page = await context.newPage();
  await page.goto(env.makerPortalUrl);

  let result: ActionResult;
  switch (task.type) {
    case 'dataverse.table.create':
      result = await createDataverseTable(page, {
        displayName: task.displayName ?? '',
        schemaName: task.schemaName ?? '',
        columns: task.columns,
      });
      break;
    // TODO: add 'dataverse.column.add', 'flow.create', 'connection.create'.
    default:
      result = { status: 'failed', verifiedInPortal: false, detail: `Unknown task type: ${task.type}` };
  }

  const resultsDir = resolve(process.cwd(), 'automation', 'build-executor', 'results');
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(resolve(resultsDir, basename(taskPath).replace('.task.json', '.json')), JSON.stringify(result, null, 2));
  await context.close();

  if (result.status !== 'succeeded') process.exitCode = 1;
}

const taskArg = process.argv[2];
if (!taskArg) {
  console.error('Usage: tsx automation/build-executor/run-task.ts <path-to-task.json>');
  process.exit(1);
}
runTask(taskArg).catch((error) => {
  console.error(error);
  process.exit(1);
});
