'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { rightsDir } = require('./paths');

// The consent gate. Read before every build / push / browser launch. Missing or
// false flags mean the runtime stops and asks instead of acting.
const DEFAULTS = {
  browserProfile: '',
  // Pointer to the verified MDM browser profile. The pointer is committed; the
  // real session lives under a gitignored .profiles/ dir so cookies never enter git.
  profilePath: '',
  // App URL captured after `npx power-apps push` — the E2E tester's base URL.
  appUrl: '',
  allowBuild: false,
  allowPush: false,
  allowAutoRespec: false,
  allowAutoApplyDefects: false,
  grantedBy: 'user',
  grantedAt: null,
};

function approvalFile(root) {
  return path.join(rightsDir(root), 'approval.json');
}

function ensureRights(root, overrides) {
  const file = approvalFile(root);
  fs.mkdirSync(rightsDir(root), { recursive: true });
  if (!fs.existsSync(file)) {
    const data = Object.assign({}, DEFAULTS, { grantedAt: new Date().toISOString().slice(0, 10) }, overrides || {});
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    return data;
  }
  return load(root);
}

function load(root) {
  const file = approvalFile(root);
  if (!fs.existsSync(file)) return null;
  // Backfill any keys added after this file was first written (e.g. profilePath, appUrl).
  return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8')));
}

function allowed(rights, flag) {
  return !!(rights && rights[flag] === true);
}

function save(root, data) {
  fs.mkdirSync(rightsDir(root), { recursive: true });
  fs.writeFileSync(approvalFile(root), `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

// True once the MDM profile has been verified and its pointer stored.
function profileVerified(root) {
  const data = load(root);
  return !!(data && data.browserProfile && data.profilePath);
}

// Persist the verified-once profile pointer (name + local path). The actual
// session dir lives under a gitignored .profiles/ and is never written here.
function setProfile(root, { name, path: profilePath } = {}) {
  const data = ensureRights(root);
  if (name) data.browserProfile = name;
  data.profilePath = profilePath || data.profilePath || (data.browserProfile ? `./.profiles/${data.browserProfile}` : '');
  return save(root, data);
}

// Persist the app URL captured after a push so the E2E tester can target it.
function setAppUrl(root, url) {
  const data = ensureRights(root);
  data.appUrl = url || '';
  return save(root, data);
}

module.exports = { ensureRights, load, allowed, save, profileVerified, setProfile, setAppUrl, approvalFile, DEFAULTS };
