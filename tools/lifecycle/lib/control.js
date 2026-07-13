'use strict';
const fs = require('node:fs');
const { emit, reset } = require('./bus');
const { render } = require('./dashboard');
const { load: loadRights, ensureRights, approvalFile } = require('./rights');
const { proposeMvp } = require('./mvp');
const { reflect } = require('./reflect');
const freeze = require('./freeze');
const { buildStories, saveStories, refineStories, readStories } = require('./stories');
const { readDigest } = require('./digest');
const providers = require('./providers');
const pacInit = require('./pac-init');
const { addDataSource } = require('./datasource');

// Server-side controller: turns dashboard actions into real effects on the
// status bus, the rights gate, and a running loop. Held in memory by `serve`.
class Controller {
  constructor(root, opts = {}) {
    this.root = root;
    this.simulate = opts.simulate !== false;
    this.running = false;
    this.paused = false;
    this.intake = { goal: null, mvp: null, compliance: 86 };
    // Approval gate. The loop blocks at stage 2 (Approve) until the maker presses
    // "Build this", which fires the `approve` action and flips this true. A run that
    // is started without prior approval (the chat's Build button calls intake+start
    // together) is treated as pre-approved so the existing flow is unbroken.
    this.approved = false;
    this.requireApproval = opts.requireApproval === true;
  }

  status() {
    return { running: this.running, paused: this.paused, approved: this.approved, intake: this.intake };
  }

  isPaused() {
    return this.paused;
  }

  // True once the change is approved for build. When approval is not required
  // (the default chat path, where Build IS the approval), this is always true.
  isApproved() {
    return this.approved || !this.requireApproval;
  }

  async action(body = {}) {
    switch (body.type) {
      case 'intake':
        return this.setIntake(body);
      case 'start':
        if (this.running) return { ok: false, error: 'loop already running' };
        // A start without a separate approval step pre-approves the run (the chat's
        // "Build this" is the approval). If requireApproval was set, the loop will
        // block at stage 2 until an `approve` action arrives.
        if (!this.requireApproval) this.approved = true;
        this.start({ rotations: Number(body.rotations) || 3 }).catch((e) => console.error('loop error:', e.message));
        return { ok: true, started: true };
      case 'pause':
        this.paused = true;
        return { ok: true, paused: true };
      case 'resume':
        this.paused = false;
        return { ok: true, paused: false };
      case 'approve':
        // Real gate: unblock a loop that is waiting at the Approve stage.
        this.approved = true;
        emit(this.root, { rotation: 0, stage: 2, agent: 'planner', level: 'good', message: 'Change approved by user — build gate opened' });
        render(this.root);
        return { ok: true, approved: true };
      case 'reject':
        // Withdraw approval; a loop blocked at Approve will stop and escalate.
        this.approved = false;
        emit(this.root, { rotation: 0, stage: 2, agent: 'planner', level: 'warn', message: 'Change not approved — build gate held closed' });
        render(this.root);
        return { ok: true, approved: false };
      case 'rights':
        return this.setRight(body.flag, body.value);
      case 'propose-mvp': {
        if (freeze.isFrozen(this.root, 'mvp')) return { ok: false, error: 'MVP is frozen — unlock for a major change first' };
        const digest = readDigest(this.root);
        const out = proposeMvp(this.root, { goal: body.goal || this.intake.goal, digest });
        emit(this.root, { rotation: 0, stage: 0, agent: 'planner', level: 'good', message: `Proposed an MVP ${digest ? 'from your code' : 'from the goal'} → ${out}` });
        render(this.root);
        return { ok: true, path: out, grounded: !!digest };
      }
      case 'generate-stories': {
        if (freeze.isFrozen(this.root, 'stories')) return { ok: false, error: 'stories are frozen — unlock for a major change first' };
        const digest = readDigest(this.root);
        if (!digest) return { ok: false, error: 'no digest — run `import --analyze` first to read your code' };
        const result = buildStories(this.root, { goal: body.goal || this.intake.goal });
        emit(this.root, { rotation: 0, stage: 1, agent: 'planner', level: 'good', message: `Generated ${result.doc.stories.length} code-grounded user stories → ${result.path}` });
        render(this.root);
        return { ok: true, count: result.doc.stories.length, stories: result.doc.stories };
      }
      case 'save-stories': {
        if (freeze.isFrozen(this.root, 'stories')) return { ok: false, error: 'stories are frozen — unlock for a major change first' };
        const prior = readStories(this.root) || {};
        const saved = saveStories(this.root, Object.assign({}, prior, { stories: body.stories || prior.stories || [] }));
        emit(this.root, { rotation: 0, stage: 1, agent: 'intake', level: 'info', message: `User edited the stories (${saved.doc.stories.length}) via dashboard` });
        render(this.root);
        return { ok: true, count: saved.doc.stories.length };
      }
      case 'refine': {
        const artifact = body.artifact === 'mvp' ? 'mvp' : 'stories';
        if (freeze.isFrozen(this.root, artifact)) return { ok: false, error: `${artifact} is frozen — unlock for a major change first` };
        const provider = providers.resolve(body.provider || 'simulated');
        if (artifact === 'mvp') {
          const out = proposeMvp(this.root, { goal: body.goal || this.intake.goal, digest: readDigest(this.root), force: true });
          emit(this.root, { rotation: 0, stage: 1, agent: 'planner', level: 'good', message: `Refined the MVP from your edits → ${out}` });
          render(this.root);
          return { ok: true, artifact, path: out };
        }
        const res = await refineStories(this.root, { edited: body.edited, provider });
        if (!res.ok) return res;
        emit(this.root, { rotation: 0, stage: 1, agent: 'planner', level: 'good', message: `Refined the stories from your edits (changed: ${res.diff.changed.length}, added: ${res.diff.added.length}, removed: ${res.diff.removed.length})` });
        render(this.root);
        return { ok: true, artifact, diff: res.diff, count: res.doc.stories.length };
      }
      case 'freeze': {
        const artifact = body.artifact === 'mvp' ? 'mvp' : 'stories';
        freeze.freeze(this.root, artifact);
        if (artifact === 'stories') { const d = readStories(this.root); if (d) saveStories(this.root, d); }
        emit(this.root, { rotation: 0, stage: 1, agent: 'intake', level: 'good', message: `Approved & froze the ${artifact} · the loop will build against it and never rewrite it` });
        render(this.root);
        return { ok: true, artifact, status: 'frozen' };
      }
      case 'unlock': {
        const artifact = body.artifact === 'mvp' ? 'mvp' : 'stories';
        freeze.unlock(this.root, artifact);
        if (artifact === 'stories') { const d = readStories(this.root); if (d) saveStories(this.root, d); }
        emit(this.root, { rotation: 0, stage: 1, agent: 'intake', level: 'warn', message: `Unlocked the ${artifact} for a major change · it can be refined or regenerated again` });
        render(this.root);
        return { ok: true, artifact, status: 'draft' };
      }
      case 'push': {
        const rights = loadRights(this.root);
        if (!rights || rights.allowPush !== true) {
          return { ok: false, error: 'Push is off — turn on "Publish to my environment" in the rights panel first' };
        }
        const boundEmit = async ({ level, message }) => { emit(this.root, { rotation: 0, stage: 4, agent: 'runner', level, message }); render(this.root); };
        const result = await pacInit.buildAndPush(this.root, { appDir: body.appDir, emit: boundEmit });
        return Object.assign({ ok: result.pushed }, result);
      }
      case 'add-datasource': {
        const rights = loadRights(this.root);
        if (!rights || rights.allowPush !== true) {
          return { ok: false, error: 'Add datasource is off — turn on "Publish to my environment" in the rights panel first' };
        }
        const boundEmit = async ({ level, message }) => { emit(this.root, { rotation: 0, stage: 4, agent: 'runner', level, message }); render(this.root); };
        const result = await addDataSource(this.root, { api: body.api, table: body.table, appDir: body.appDir, emit: boundEmit });
        return Object.assign({ ok: result.added }, result);
      }
      case 'reflect': {
        const lesson = reflect(this.root, { title: body.title || 'Lesson from this session', severity: body.severity, what: body.what, how: body.how });
        render(this.root);
        return { ok: true, lesson: lesson.id };
      }
      case 'reset':
        reset(this.root);
        render(this.root);
        return { ok: true };
      default:
        return { ok: false, error: `unknown action: ${body.type}` };
    }
  }

  setIntake(body) {
    this.intake = {
      goal: body.goal || null,
      mvp: body.mvp || null,
      compliance: body.compliance != null ? Number(body.compliance) : 86,
      // The approved plan (title + plain-language items) drives the planner so the loop
      // builds what the maker actually approved. Optional explicit tasks override it.
      plan: body.plan && Array.isArray(body.plan.items) ? body.plan : null,
      tasks: Array.isArray(body.tasks) ? body.tasks : null,
      provider: body.provider || null,
      // The id of the comprehensive plan authored at chat time, so the loop can fold its
      // real build outcome back into that same plan document (planhtml.foldOutcome).
      planId: body.planId || null,
    };
    emit(this.root, {
      rotation: 0,
      stage: 0,
      agent: 'intake',
      level: 'good',
      message: `Goal + MVP set via dashboard (compliance ${this.intake.compliance}%)`,
      data: { goal: this.intake.goal, mvp: this.intake.mvp, compliance: this.intake.compliance, mode: this.simulate ? 'simulate' : 'real' },
    });
    render(this.root);
    return { ok: true };
  }

  setRight(flag, value) {
    ensureRights(this.root);
    const data = loadRights(this.root);
    if (!data || !(flag in data)) return { ok: false, error: `unknown flag: ${flag}` };
    data[flag] = !!value;
    fs.writeFileSync(approvalFile(this.root), `${JSON.stringify(data, null, 2)}\n`);
    emit(this.root, { rotation: 0, stage: 0, agent: 'intake', level: value ? 'good' : 'warn', message: `Approved_rights/ ${flag} = ${!!value} (via dashboard)` });
    render(this.root);
    return { ok: true, flag, value: !!value };
  }

  async start(opts = {}) {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    const { runLoop } = require('./loop');
    try {
      await runLoop(this.root, {
        fresh: true,
        rotations: opts.rotations || 3,
        simulate: this.simulate,
        delayMs: opts.delayMs || 850,
        render: true,
        goal: this.intake.goal || undefined,
        mvp: this.intake.mvp || undefined,
        compliance: this.intake.compliance,
        plan: this.intake.plan || undefined,
        tasks: this.intake.tasks || undefined,
        provider: this.intake.provider || undefined,
        planId: this.intake.planId || undefined,
        isPaused: () => this.paused,
        isApproved: () => this.isApproved(),
      });
    } finally {
      this.running = false;
    }
  }
}

module.exports = { Controller };
