'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Zero-dependency reader for Microsoft Edge profiles. Mirrors the vendored engine's
// discovery (info_cache in Edge's "Local State") but without importing Playwright, so
// `lifecycle profiles` works before you install anything. Used to pick — and persist —
// which signed-in profile the real engines (build entry + e2e runner) always attach to.

function defaultLocalStatePath(env = process.env) {
  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Local State');
}

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function discoverProfiles(statePath = defaultLocalStatePath()) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return [];
  }
  const info = json && json.profile && json.profile.info_cache;
  if (!info || typeof info !== 'object') return [];
  return Object.entries(info).map(([directory, meta]) => {
    const m = meta && typeof meta === 'object' ? meta : {};
    return {
      directory,
      displayName: firstString(m.name, m.shortcut_name, directory),
      username: firstString(m.user_name, m.gaia_name, ''),
    };
  });
}

// Resolve a user selection to a profile: a 1-based index, an exact profile directory,
// or a case-insensitive substring of the display name / email.
function resolveSelection(profiles, sel) {
  if (!profiles.length || sel == null || sel === '') return null;
  const s = String(sel).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= profiles.length ? profiles[n - 1] : null;
  }
  const lower = s.toLowerCase();
  return (
    profiles.find((p) => p.directory.toLowerCase() === lower) ||
    profiles.find((p) => p.displayName.toLowerCase().includes(lower) || p.username.toLowerCase().includes(lower)) ||
    null
  );
}

function label(p) {
  return p.username ? `${p.displayName} (${p.username})` : p.displayName;
}

module.exports = { defaultLocalStatePath, discoverProfiles, resolveSelection, label };
