'use strict';
// governance.js — enforce CLAUDE.md Rule 2 in code: never publish straight off main;
// go through a feature branch → PR → security scan (CodeQL/Dependabot) → only publish
// once the checks are clean.
//
// Two layers:
//   - Git operations (branch/commit/push) are real and unit-tested against a temp repo.
//   - PR creation + security-status polling hit the GitHub REST API and therefore need a
//     token (GITHUB_TOKEN / GH_TOKEN) and a network. That is a seam: the decision logic
//     (what counts as passed/failed/pending, and whether publishing is allowed) is pure
//     and tested; the HTTP calls run only when a token + remote are present.
//
// The gate is honest about uncertainty: it BLOCKS the clear Rule-2 violation (publishing
// from a protected branch) and blocks on known-failed security checks, but when it can't
// verify (no token/remote) it returns allowed:true with a note rather than pretending.
const { spawnSync } = require('node:child_process');

const PROTECTED = new Set(['main', 'master', 'release', 'production']);

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { code: r.status == null ? 1 : r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function isRepo(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree']).stdout === 'true';
}

function currentBranch(root) {
  const r = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.code === 0 ? r.stdout : null;
}

function isProtectedBranch(name) {
  return PROTECTED.has(String(name || '').toLowerCase());
}

function slugBranch(desc) {
  const base = String(desc || 'change').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'change';
  return `powercodex/${base}`;
}

// Parse owner/repo/host from a git remote URL. Handles https, ssh (git@), and the
// proxied http://host:port/git/owner/repo form used in some sandboxes.
function parseRemote(url) {
  if (!url) return null;
  let m = url.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i);
  if (m) return { host: m[1], owner: m[2], repo: m[3] };
  m = url.match(/^https?:\/\/[^/]+\/(?:git\/)?([^/]+)\/(.+?)(?:\.git)?$/i);
  if (m) {
    const host = (url.match(/^https?:\/\/([^/]+)/) || [])[1] || '';
    return { host, owner: m[1], repo: m[2] };
  }
  return null;
}

function remoteInfo(root) {
  const r = git(root, ['remote', 'get-url', 'origin']);
  if (r.code !== 0) return null;
  return parseRemote(r.stdout);
}

// Ensure work happens on a feature branch, never a protected one. Creates+checks out a
// new branch when currently on a protected branch. Returns { branch, created }.
function ensureFeatureBranch(root, desc) {
  const cur = currentBranch(root);
  if (cur && !isProtectedBranch(cur)) return { branch: cur, created: false };
  const name = slugBranch(desc);
  const r = git(root, ['checkout', '-B', name]);
  if (r.code !== 0) return { branch: cur, created: false, error: r.stderr };
  return { branch: name, created: true };
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  const r = git(root, ['commit', '-m', message || 'PowerCodex change']);
  // "nothing to commit" is not an error for our purposes.
  if (r.code !== 0 && !/nothing to commit/i.test(r.stdout + r.stderr)) return { committed: false, error: r.stderr || r.stdout };
  return { committed: r.code === 0, message };
}

function push(root, branch) {
  const r = git(root, ['push', '-u', 'origin', branch]);
  return { pushed: r.code === 0, error: r.code === 0 ? null : (r.stderr || r.stdout) };
}

function headSha(root) {
  const r = git(root, ['rev-parse', 'HEAD']);
  return r.code === 0 ? r.stdout : null;
}

// ---- security-status decision logic (pure) ------------------------------------
// Given GitHub check-runs for a commit, decide pass/fail/pending. Security checks
// (CodeQL, Dependabot/dependency-review, and anything named *security*/*scan*) gate the
// result; unrelated checks are informational.
function classifyChecks(checkRuns) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const isSecurity = (name) => /codeql|dependabot|dependency|security|scan|ghas|snyk|trivy/i.test(name || '');
  const security = runs.filter((r) => isSecurity(r.name));
  const relevant = security.length ? security : runs; // fall back to all checks if none are named security
  if (!relevant.length) return { state: 'pending', reason: 'no checks reported yet', checks: [] };
  const summary = relevant.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
  const anyPending = relevant.some((r) => r.status !== 'completed');
  if (anyPending) return { state: 'pending', reason: 'security checks still running', checks: summary };
  const failed = relevant.filter((r) => !['success', 'neutral', 'skipped'].includes(r.conclusion));
  if (failed.length) return { state: 'failed', reason: failed.map((f) => f.name).join(', ') + ' failed', checks: summary };
  return { state: 'passed', reason: 'all security checks passed', checks: summary };
}

async function fetchCheckRuns({ host, owner, repo, ref, token }) {
  const api = host && !/github\.com$/i.test(host) ? `https://${host}/api/v3` : 'https://api.github.com';
  const res = await fetch(`${api}/repos/${owner}/${repo}/commits/${ref}/check-runs`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'powercodex' },
  });
  if (!res.ok) throw new Error(`GitHub check-runs ${res.status}`);
  const data = await res.json();
  return data.check_runs || [];
}

// The gate the publish flow calls. `fetchStatus` is injectable for tests.
async function gatePublish(root, { token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, fetchStatus } = {}) {
  if (!isRepo(root)) return { allowed: true, verified: false, note: 'not a git repo — governance skipped' };
  const branch = currentBranch(root);
  if (isProtectedBranch(branch)) {
    return { allowed: false, blocking: true, reason: `You're on "${branch}". Rule 2: publish from a feature branch + PR, never ${branch}.`, branch };
  }
  const remote = remoteInfo(root);
  const sha = headSha(root);
  if (!token || !remote || !sha) {
    return { allowed: true, verified: false, branch, note: 'No GitHub token/remote — security gate not verified. Ensure your PR is green before going live.' };
  }
  let status;
  try {
    const runs = fetchStatus ? await fetchStatus({ ...remote, ref: sha, token }) : await fetchCheckRuns({ ...remote, ref: sha, token });
    status = classifyChecks(runs);
  } catch (e) {
    return { allowed: true, verified: false, branch, note: 'Could not read security checks (' + e.message + '). Verify your PR is green manually.' };
  }
  if (status.state === 'failed') return { allowed: false, blocking: true, verified: true, branch, reason: 'Security checks failed: ' + status.reason, checks: status.checks };
  if (status.state === 'pending') return { allowed: false, blocking: true, verified: true, branch, reason: 'Security checks still running — wait for them to finish.', checks: status.checks };
  return { allowed: true, verified: true, branch, reason: status.reason, checks: status.checks };
}

module.exports = {
  git, isRepo, currentBranch, isProtectedBranch, slugBranch, parseRemote, remoteInfo,
  ensureFeatureBranch, commitAll, push, headSha, classifyChecks, gatePublish,
};
