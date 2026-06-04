'use strict';

// Maker-portal recipes: map a declarative build task to the real Power Platform
// surface where that asset lives. Engine 1 (the real build executor) uses these to
// NAVIGATE into Power Platform and confirm the surface loaded. The DOM steps that
// actually author the asset (the "front end") are not automated yet — each recipe
// carries `automated:false` and a `todo` describing exactly what's left, so the gap
// is explicit rather than faked.

const POWERAPPS = 'https://make.powerapps.com';
const POWERAUTOMATE = 'https://make.powerautomate.com';

// Build an environment-scoped URL when an env id is known; otherwise the portal home
// (the modern maker resolves to the user's default environment).
function scoped(base, env, suffix) {
  return env ? `${base}/environments/${env}/${suffix}` : base;
}

const RECIPES = {
  'dataverse.table.create': {
    surface: 'Dataverse Tables',
    describe: 'open the Tables list to create a table',
    url: (env) => scoped(POWERAPPS, env, 'tables'),
    automated: false,
    todo: 'New table → set display/plural name → primary column → Save → verify it appears in the table list',
  },
  'dataverse.column.add': {
    surface: 'Dataverse Tables',
    describe: 'open the Tables list to add a column',
    url: (env) => scoped(POWERAPPS, env, 'tables'),
    automated: false,
    todo: 'open the target table → + New column → set name + data type → Save',
  },
  'dataverse.connection.create': {
    surface: 'Connections',
    describe: 'open Connections to add a connection',
    url: (env) => scoped(POWERAPPS, env, 'connections'),
    automated: false,
    todo: 'New connection → pick connector → authenticate → confirm it is listed',
  },
  'powerautomate.flow.create': {
    surface: 'Power Automate Flows',
    describe: 'open the Flows list to create a flow',
    url: (env) => scoped(POWERAUTOMATE, env, 'flows'),
    automated: false,
    todo: 'New flow → choose trigger → add action(s) → Save → test',
  },
};

function recipeFor(type) {
  return RECIPES[type] || null;
}

const RECIPE_TYPES = Object.keys(RECIPES);

module.exports = { recipeFor, RECIPE_TYPES, RECIPES };
