'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { liveDir } = require('./paths');
const { readEvents } = require('./bus');

const STAGES = ['Intake', 'Plan', 'Approve', 'Build', 'Run', 'Test', 'Observe'];
const LEVEL_DOT = { info: '#6ea8fe', good: '#5ad19a', warn: '#f5c97b', bad: '#f08a8a', observation: '#a78bfa' };

// Re-renders the always-on live dashboard from the append-only status bus.
// Self-contained HTML; meta-refresh keeps it live while the loop keeps writing.
function render(root) {
  const events = readEvents(root);
  const dir = liveDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'index.html');
  fs.writeFileSync(out, buildHtml(events));
  return out;
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildHtml(events) {
  const last = events[events.length - 1] || {};
  const rotation = events.reduce((max, e) => Math.max(max, e.rotation || 0), 0);
  const stageEvents = events.filter((e) => typeof e.stage === 'number' && e.stage < 7);
  const curStage = stageEvents.length ? stageEvents[stageEvents.length - 1].stage : 0;
  const done = last.stage === 7;
  const stopped = done && last.level === 'warn';
  const observations = events.filter((e) => e.level === 'observation');
  const feed = events.slice(-28).reverse();

  const strip = STAGES.map((label, i) => {
    const cls = done || i < curStage ? 'done' : i === curStage ? 'active' : '';
    return `<div class="stage ${cls}"><div class="sn">${i} · ${esc(label)}${done || i < curStage ? ' ✓' : ''}</div></div>`;
  }).join('');

  const feedRows = feed
    .map((e) => {
      const t = (e.ts || '').slice(11, 19);
      const dot = LEVEL_DOT[e.level] || '#99a2b8';
      const rot = e.rotation ? `r${e.rotation}` : '—';
      return `<li><span class="t mono">${esc(t)}</span><span class="dt" style="background:${dot}"></span><span class="tx"><span class="src">${esc(e.agent || 'system')}</span> <span class="rot">${esc(rot)}</span> · ${esc(e.message)}</span></li>`;
    })
    .join('');

  const obsRows = observations.length
    ? observations
        .slice()
        .reverse()
        .map((e) => {
          const d = e.data || {};
          const sig = d.signal || 'observation';
          return `<div class="obs ${esc(sig)}"><div class="orow"><span class="sig ${esc(sig)}">${esc(sig)}</span><span class="conf mono">conf ${esc((d.confidence != null ? d.confidence : 0).toFixed ? d.confidence.toFixed(2) : d.confidence)}</span></div><div class="ot">${esc(e.message.replace(/^Authored next spec from observation · \w+ · /, ''))}</div><div class="oa">${d.needsApproval ? 'Endorse →' : 'Auto-applying…'}</div></div>`;
        })
        .join('')
    : '<div class="empty">No observations yet — real observations arrive with live e2e testing.</div>';

  const statusPill = done
    ? stopped
      ? '<span class="pill warn">stopped</span>'
      : '<span class="pill good">complete ✓</span>'
    : '<span class="pill live"><span class="dot"></span> running</span>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
${done ? '' : '<meta http-equiv="refresh" content="2"/>'}
<title>PowerCodex Lifecycle · live</title>
<style>
:root{--bg:#0b0d12;--panel:#161a24;--panel2:#1c2130;--line:#262c3a;--text:#e8ecf4;--muted:#99a2b8;--faint:#6b7488;--accent:#6ea8fe;--accent2:#a78bfa;--good:#5ad19a;--warn:#f5c97b;}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1000px 500px at 85% -10%,rgba(167,139,250,.13),transparent 60%),var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;line-height:1.5}
.mono{font-family:"SF Mono","JetBrains Mono",Consolas,Menlo,monospace}
.wrap{max-width:1080px;margin:0 auto;padding:22px 22px 60px}
.top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:14px 0 18px;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:11px;font-weight:700}
.mark{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#06203f;font-weight:900}
.brand small{display:block;font-weight:500;font-size:11.5px;color:var(--faint)}
.sp{flex:1}.stat{text-align:right}.stat .v{font-weight:700}.stat .l{font-size:11px;color:var(--faint);text-transform:uppercase;letter-spacing:.06em}
.pill{font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;border:1px solid var(--line);display:inline-flex;align-items:center;gap:7px}
.pill.good{color:var(--good);border-color:rgba(90,209,154,.35);background:rgba(90,209,154,.08)}
.pill.warn{color:var(--warn);border-color:rgba(245,201,123,.35);background:rgba(245,201,123,.08)}
.pill.live{color:var(--accent);border-color:rgba(110,168,254,.35);background:rgba(110,168,254,.08)}
.pill.live .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:p 1.6s infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:.3}}
.strip{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin:20px 0}
@media(max-width:680px){.strip{grid-template-columns:repeat(4,1fr)}}
.stage{border:1px solid var(--line);border-radius:11px;padding:12px 10px;background:var(--panel);position:relative;overflow:hidden}
.stage .sn{font-size:12px;font-weight:600;color:var(--faint)}
.stage.done{border-color:rgba(90,209,154,.3)}.stage.done .sn{color:var(--good)}
.stage.active{border-color:rgba(110,168,254,.55);background:linear-gradient(180deg,rgba(110,168,254,.1),var(--panel))}.stage.active .sn{color:var(--text)}
.stage.active::after{content:"";position:absolute;left:0;bottom:0;height:2px;width:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));animation:sw 2s linear infinite}
@keyframes sw{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.cols{display:grid;grid-template-columns:1.5fr 1fr;gap:20px}@media(max-width:820px){.cols{grid-template-columns:1fr}}
.sect{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent2);font-weight:700;margin:0 0 12px}
.panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:8px 14px}
.feed{list-style:none;margin:0;padding:0;max-height:440px;overflow:auto;font-size:13px}
.feed li{display:grid;grid-template-columns:62px 14px 1fr;gap:10px;align-items:start;padding:8px 4px;border-bottom:1px solid rgba(38,44,58,.6)}
.feed li:last-child{border-bottom:0}.feed .t{color:var(--faint);font-size:11.5px}.feed .dt{width:8px;height:8px;border-radius:50%;margin-top:5px}
.feed .tx{color:var(--muted)}.feed .src{color:var(--accent);font-weight:600}.feed .rot{color:var(--faint);font-size:11px}
.obs{border:1px solid var(--line);border-left-width:3px;border-radius:10px;padding:12px;margin:10px 0;background:var(--panel2)}
.obs.gap{border-left-color:var(--accent)}.obs.improvement{border-left-color:var(--accent2)}.obs.defect{border-left-color:#f08a8a}
.obs .orow{display:flex;align-items:center;gap:8px}
.sig{font-size:11px;font-weight:700;text-transform:uppercase;padding:2px 8px;border-radius:999px}
.sig.gap{color:var(--accent);background:rgba(110,168,254,.12)}.sig.improvement{color:var(--accent2);background:rgba(167,139,250,.12)}.sig.defect{color:#f08a8a;background:rgba(240,138,138,.12)}
.conf{margin-left:auto;color:var(--faint);font-size:11.5px}.ot{margin:8px 0 4px;font-size:13.5px}.oa{font-size:12px;color:var(--muted)}
.empty{color:var(--faint);text-align:center;padding:24px;font-size:13px}
.note{color:var(--faint);font-size:12px;text-align:center;margin-top:24px}
</style></head><body><div class="wrap">
<div class="top">
  <div class="brand"><span class="mark">P</span><span>PowerCodex Lifecycle <small>.powercodex/live/index.html</small></span></div>
  ${statusPill}
  <div class="sp"></div>
  <div class="stat"><div class="v">Rotation ${rotation || '—'}</div><div class="l">current loop</div></div>
  <div class="stat"><div class="v mono">${esc((last.ts || '').slice(11, 19) || '—')}</div><div class="l">last event</div></div>
</div>
<div class="strip">${strip}</div>
<div class="cols">
  <div><div class="sect">Live activity · newest first</div><div class="panel"><ul class="feed">${feedRows || '<li><span></span><span></span><span class="tx">No events yet — run <code>powercodex-lifecycle loop</code></span></li>'}</ul></div></div>
  <div><div class="sect">Specs authored from observation</div>${obsRows}</div>
</div>
<p class="note">Rendered from <code>.powercodex/live/status.json</code> (append-only event bus) · ${events.length} events · mode reflects the running loop. While the loop runs this page auto-refreshes every 2s.</p>
</div></body></html>`;
}

module.exports = { render, buildHtml };
