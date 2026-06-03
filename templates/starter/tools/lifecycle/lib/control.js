'use strict';
const fs = require('node:fs');
const { emit, reset } = require('./bus');
const { render } = require('./dashboard');
const { load: loadRights, ensureRights, approvalFile } = require('./rights');
const { proposeMvp } = require('./mvp');
const { reflect } = require('./reflect');

// Server-side controller: turns dashboard actions into real effects on the
// status bus, the rights gate, and a running loop. Held in memory by `serve`.
class Controller {
  constructor(root, opts = {}) {
    this.root = root;
    this.simulate = opts.simulate !== false;
    this.running = false;
    this.paused = false;
    this.intake = { goal: null, mvp: null, compliance: 86 };
  }

  status() {
    return { running: this.running, paused: this.paused, intake: this.intake };
  }

  isPaused() {
    return this.paused;
  }

  async action(body = {}) {
    switch (body.type) {
      case 'intake':
        return this.setIntake(body);
      case 'start':
        if (this.running) return { ok: false, error: 'loop already running' };
        this.start({ rotations: Number(body.rotations) || 3 }).catch((e) => console.error('loop error:', e.message));
        return { ok: true, started: true };
      case 'pause':
        this.paused = true;
        return { ok: true, paused: true };
      case 'resume':
        this.paused = false;
        return { ok: true, paused: false };
      case 'approve':
        emit(this.root, { rotation: 0, stage: 2, agent: 'planner', level: 'good', message: 'Change approved by user (via dashboard)' });
        render(this.root);
        return { ok: true };
      case 'rights':
        return this.setRight(body.flag, body.value);
      case 'propose-mvp': {
        const out = proposeMvp(this.root, { goal: body.goal || this.intake.goal });
        emit(this.root, { rotation: 0, stage: 0, agent: 'planner', level: 'good', message: `Proposed an MVP from the goal → ${out}` });
        render(this.root);
        return { ok: true, path: out };
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
        isPaused: () => this.paused,
      });
    } finally {
      this.running = false;
    }
  }
}

module.exports = { Controller };
