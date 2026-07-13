'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { rightsDir } = require('./paths');

// The consent gate. Read before every build / push / browser launch. Missing or
// false flags mean the runtime stops and asks instead of acting.
const DEFAULTS = {
  browserProfile: '',
  // Human-friendly label for the chosen profile (e.g. "Work (you@tenant.com)").
  browserProfileLabel: '',
  // Pointer to the verified MDM browser profile. The pointer is committed; the
  // real session lives under a gitignored .profiles/ dir so cookies never enter git.
  profilePath: '',
  // App URL captured after `pac code push` — the E2E tester's base URL.
  appUrl: '',
  // On-device building & testing is safe (nothing goes live), so it is allowed by
  // default — the maker-first product builds & self-heals without prompting. Publishing
  // to a real environment stays OFF until the maker explicitly turns it on.
  allowBuild: true,
  allowPush: false,
  allowAutoRespec: false,
  allowAutoApplyDefects: true,
  // The agent harness (godmode + codeapps discipline injected into the connected
  // agent) is on by default — the whole point is discipline without invoking a skill.
  // Set false to fully disable injection; the agent then behaves as it did before.
  allowHarness: true,
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
function setProfile(root, { name, path: profilePath, label } = {}) {
  const data = ensureRights(root);
  if (name) data.browserProfile = name;
  if (label) data.browserProfileLabel = label;
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
