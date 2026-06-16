'use strict';

// Maker-portal recipes: map a declarative build task to the real Power Platform
// surface where that asset lives. Engine 1 (the real build executor) uses these to
// drive the browser and author the asset. Recipes with automated:true have a real
// `build` function; automated:false recipes navigate to the surface but leave the
// DOM authoring step for a future vertical slice.

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
    // Real DOM automation (vertical slice). Engine 1 calls this; it creates the table
    // and only reports created:true after re-reading the tables list. Selectors are
    // best-effort and need live-tenant validation.
    automated: true,
    build: (engineModule, context, { env, task } = {}) =>
      engineModule.createDataverseTable(context, {
        environmentId: env,
        displayName: task && (task.displayName || task.name),
        pluralName: task && task.pluralName,
        primaryColumn: task && task.primaryColumn,
      }),
    todo: 'validate selectors against a live tenant; add column/relationship authoring',
  },
  'dataverse.column.add': {
    surface: 'Dataverse Tables',
    describe: 'open the table editor to add a column',
    url: (env, task) => task && task.tableLogicalName
      ? scoped(POWERAPPS, env, `entities/${task.tableLogicalName}/fields`)
      : scoped(POWERAPPS, env, 'tables'),
    automated: true,
    build: (engineModule, context, { env, task } = {}) =>
      engineModule.addDataverseColumn(context, {
        environmentId: env,
        tableLogicalName: task && task.tableLogicalName,
        displayName: task && (task.displayName || task.name),
        type: (task && task.columnType) || 'text',
        choices: (task && task.choices) || [],
        required: task && !!task.required,
        description: (task && task.description) || '',
      }),
    todo: 'validate selectors against a live tenant; add lookup/relationship support',
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
