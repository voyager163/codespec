'use strict';
// The planner turns a plain-language goal + the maker's approved plan items into a
// concrete, ordered list of build tasks the engines can execute. This is the bridge
// the loop was missing: previously tasks were hardcoded; now they come from what the
// maker actually asked for.
//
// Tasks are of two kinds:
//   • code.screen  — author/extend a real React+TS screen (the autonomy spine; runs
//                    entirely on the maker's machine, no tenant needed).
//   • dataverse.*  — Power Platform portal assets (tables/columns/flows), executed by
//                    the browser engine against a live tenant when available.
// The chat flow produces code.screen tasks; data tasks are added only when the goal
// clearly implies a new persisted entity AND the maker has opted into tenant changes.

// Parse capability flags from the goal + plan items. Deterministic keyword mapping so
// the same request always yields the same buildable feature set — the generator reads
// these flags directly. Mirrors the heuristics the chat already shows the maker.
function parseCapabilities(goal, items) {
  const text = [goal || '', ...(items || [])].join(' \n ').toLowerCase();
  const has = (re) => re.test(text);
  return {
    filterByUser: has(/\b(my|mine|assigned|signed-in|sign-in|technician|tech|only me|just me|per user)\b/),
    sort: has(/\b(sort|order|soonest|deadline|due|date|priority|latest|recent|newest|oldest)\b/),
    highlight: has(/\b(red|overdue|highlight|colou?r|flag|warn|alert|attention|urgent)\b/),
    search: has(/\b(search|find|filter|lookup|look up)\b/),
    rowAction: has(/\b(done|complete|status|mark|approve|update|edit|toggle|action)\b/),
  };
}

// A safe PascalCase identifier and matching kebab route from a free-text goal.
function nameFrom(goal) {
  const words = String(goal || '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') || 'AppScreen';
  const base = /^[A-Za-z]/.test(pascal) ? pascal : 'Screen' + pascal;
  const componentName = base.endsWith('Screen') || base.endsWith('Page') ? base : base + 'Screen';
  const kebab = componentName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/-?(screen|page)$/, '');
  return { componentName, route: '/' + (kebab || 'screen'), kebab: kebab || 'screen' };
}

// Build the ordered task list. `plan.items` are the approved plain-language
// capabilities; `goal` is the one-line intent. `digest` (optional) lets the planner
// notice an existing screen so it extends rather than duplicates.
function planTasks({ goal, plan, digest } = {}) {
  const items = (plan && Array.isArray(plan.items) ? plan.items : []).map((s) => String(s));
  const caps = parseCapabilities(goal, items);
  const { componentName, route, kebab } = nameFrom(plan && plan.title ? plan.title.replace(/^Plan:\s*/i, '') : goal);

  const title = (plan && plan.title ? plan.title.replace(/^Plan:\s*/i, '') : goal) || 'Your screen';

  const tasks = [
    {
      type: 'code.screen',
      name: kebab,
      componentName,
      displayName: title,
      route,
      goal: goal || title,
      capabilities: caps,
      // The plain-language checklist drives both the generated UI comments and the
      // maker-facing progress, so what gets built reads back as what was approved.
      items: items.length ? items : ['Build the main screen for what you described'],
    },
  ];
  return { tasks, capabilities: caps, screen: { componentName, route } };
}

module.exports = { planTasks, parseCapabilities, nameFrom };
