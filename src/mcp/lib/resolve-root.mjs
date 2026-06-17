// Path confinement for MCP tools (Fix 0.3).
// Every caller-supplied path (projectDir / targetDir / outputDir / appDir) is
// resolved to an absolute path and checked against an allow-list. By default the
// only allowed root is the server's workspace; POWERCODEX_ALLOWED_ROOTS (a
// path-delimited list) opts additional locations in for multi-repo users.
//
// This is the line between "automates my project" and "automates any path on the
// machine" — a host that exposes these tools to a model must not grant arbitrary
// filesystem-write + process-exec.

import fs from 'node:fs';
import path from 'node:path';

export function allowedRoots(defaultRoot) {
  const roots = [path.resolve(defaultRoot)];
  const env = process.env.POWERCODEX_ALLOWED_ROOTS;
  if (env) {
    for (const p of env.split(path.delimiter)) {
      const t = p.trim();
      if (t) roots.push(path.resolve(t));
    }
  }
  return roots;
}

function isWithin(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Resolve and confine a caller-supplied path. Throws (→ isError via safe()) when
// the path escapes the allow-list, or when mustExist is set and it isn't a dir.
export function resolveProjectDir(input, defaultRoot, { mustExist = false, label = 'path' } = {}) {
  const target = path.resolve(input || defaultRoot);
  const roots = allowedRoots(defaultRoot);
  if (!roots.some((r) => isWithin(r, target))) {
    throw new Error(
      `${label} "${target}" is outside the allowed workspace.\n` +
      `Allowed roots:\n  ${roots.join('\n  ')}\n` +
      `Set POWERCODEX_ALLOWED_ROOTS (path-delimited) to permit additional locations.`,
    );
  }
  if (mustExist) {
    if (!fs.existsSync(target)) throw new Error(`${label} does not exist: ${target}`);
    if (!fs.statSync(target).isDirectory()) throw new Error(`${label} is not a directory: ${target}`);
  }
  return target;
}
