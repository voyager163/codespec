'use strict';
const path = require('node:path');

// PowerCodex keeps its live view + consent gate as plain files in the repo,
// so everything stays reviewable in git.
function liveDir(root) {
  return path.join(root, '.powercodex', 'live');
}

function rightsDir(root) {
  return path.join(root, 'Approved_rights');
}

module.exports = { liveDir, rightsDir };
