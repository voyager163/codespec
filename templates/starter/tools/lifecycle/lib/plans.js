'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The plan registry. Whenever the agent finishes an HTML plan, it appends here so
// the cockpit/Studio can surface a "plan ready" card and `/plan open · list · diff`
// work without scanning the disk. Plans live as self-contained .html next to it.
function plansDir(root) {
  return path.join(root, '.powercodex', 'plans');
}

function registryFile(root) {
  return path.join(plansDir(root), 'index.json');
}

function ensurePlans(root) {
  const dir = plansDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = registryFile(root);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify({ plans: [] }, null, 2)}\n`);
  return file;
}

function readRegistry(root) {
  const file = registryFile(root);
  if (!fs.existsSync(file)) return { plans: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && Array.isArray(data.plans) ? data : { plans: [] };
  } catch {
    return { plans: [] };
  }
}

function nextId(reg) {
  const n = reg.plans.length + 1;
  return `P${String(n).padStart(3, '0')}`;
}

// Register a plan. `file` may be absolute or relative to the project root; it is
// stored relative so the registry is portable. Writing the html itself is the
// caller's job (the agent) — this records it so the surfaces can find it.
function registerPlan(root, plan = {}) {
  ensurePlans(root);
  const reg = readRegistry(root);
  const rel = plan.file
    ? path.relative(root, path.isAbsolute(plan.file) ? plan.file : path.join(root, plan.file)).split(path.sep).join('/')
    : `.powercodex/plans/plan-${reg.plans.length + 1}.html`;
  const jsonRel = plan.jsonFile
    ? path.relative(root, path.isAbsolute(plan.jsonFile) ? plan.jsonFile : path.join(root, plan.jsonFile)).split(path.sep).join('/')
    : null;
  const entry = {
    id: nextId(reg),
    title: plan.title || 'Untitled plan',
    file: rel,
    // The structured sibling record the agent reads to learn from past plans.
    jsonFile: jsonRel,
    provider: plan.provider || 'unknown',
    sections: plan.sections != null ? Number(plan.sections) : null,
    mockups: plan.mockups != null ? Number(plan.mockups) : null,
    tasks: plan.tasks != null ? Number(plan.tasks) : null,
    // How literal the Now/After picture is: 'mockup' (deterministic) or 'screenshot'.
    visuals: plan.visuals || 'mockup',
    status: 'ready',
    // Filled in after the build folds its real result back (see planhtml.foldOutcome).
    outcome: plan.outcome != null ? plan.outcome : null,
    createdAt: new Date().toISOString(),
  };
  reg.plans.push(entry);
  fs.writeFileSync(registryFile(root), `${JSON.stringify(reg, null, 2)}\n`);
  return entry;
}

// Stamp a plan's real build outcome onto its registry entry. Idempotent; returns the
// updated entry or null when the id isn't found.
function updatePlanOutcome(root, id, outcome) {
  const reg = readRegistry(root);
  const entry = reg.plans.find((p) => p.id === id);
  if (!entry) return null;
  entry.outcome = outcome || null;
  entry.status = outcome && outcome.verified ? 'built' : entry.status;
  fs.writeFileSync(registryFile(root), `${JSON.stringify(reg, null, 2)}\n`);
  return entry;
}

function listPlans(root) {
  return readRegistry(root).plans;
}

function latestPlan(root) {
  const plans = listPlans(root);
  return plans.length ? plans[plans.length - 1] : null;
}

// Resolve a plan by id, "latest", or a 1-based index; returns the entry + an
// absolute path + the URL it is served at (used by `/plan open`).
function resolvePlan(root, ref, port = 4321) {
  const plans = listPlans(root);
  if (!plans.length) return null;
  let entry = null;
  if (!ref || ref === 'latest') entry = plans[plans.length - 1];
  else if (/^\d+$/.test(ref)) entry = plans[Number(ref) - 1] || null;
  else entry = plans.find((p) => p.id.toLowerCase() === String(ref).toLowerCase()) || null;
  if (!entry) return null;
  return {
    entry,
    absPath: path.join(root, entry.file),
    url: `http://localhost:${port}/${entry.file}`,
  };
}

module.exports = {
  plansDir,
  registryFile,
  ensurePlans,
  readRegistry,
  registerPlan,
  updatePlanOutcome,
  listPlans,
  latestPlan,
  resolvePlan,
};
