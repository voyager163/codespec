'use strict';
const { spawnSync, spawn } = require('node:child_process');

// Is an executable resolvable on this machine? Uses the platform's own lookup
// (where on Windows, command -v elsewhere) so adapters can honestly report
// availability without assuming a path.
function hasBin(bin) {
  const probe = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [bin] : ['-v', bin];
  try {
    const r = spawnSync(probe, args, { stdio: 'ignore', shell: process.platform !== 'win32' });
    return r.status === 0;
  } catch {
    return false;
  }
}

// Best-effort recognizer for tool-activity lines some CLIs print while working
// (e.g. Claude Code's "⏺ Edit(file)" or a "Tool: name target" line). Returns a
// { name, target, meta } event or null. Plain prose lines return null, so onTool
// only ever fires on a real tool signal — never fabricated.
function detectTool(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  // "⏺ Edit(src/App.tsx)" / "● Run(npm run build)" style.
  let m = s.match(/^[⏺●▶]\s*([A-Za-z][\w-]*)\s*\(([^)]*)\)/);
  if (m) return { name: m[1].toLowerCase(), target: m[2].trim(), meta: '' };
  // "Tool: edit src/App.tsx" / "[tool] run npm test" style.
  m = s.match(/^\[?tool\]?\s*:?\s*([A-Za-z][\w-]*)\s+(.+)$/i);
  if (m) return { name: m[1].toLowerCase(), target: m[2].trim(), meta: '' };
  return null;
}

// Run a CLI and stream its stdout to onToken as it arrives. The prompt is written
// to the child's STDIN (not argv) so multi-word prompts never break on shell
// quoting. Honors an AbortSignal (the cockpit's Ctrl-C interrupt) and a timeout
// so a hung or unauthenticated CLI can never freeze the cockpit — it resolves
// with whatever it has and the caller falls back. Resolves; never rejects on a
// non-zero exit (the caller decides policy from { text, code, aborted, timedOut }).
// onTool, when given, fires for each recognized tool-activity line (see detectTool).
function streamCli(cmd, args, { onToken, onTool, signal, input, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let child;
    // On Windows the resolved binary is often a .cmd shim, which needs a shell.
    // We pass the whole command as one shell string (no separate args array) so
    // Node doesn't emit DEP0190 and nothing is mis-concatenated — the prompt is
    // on stdin, and flags never contain spaces.
    try {
      if (process.platform === 'win32') {
        child = spawn([cmd, ...args].join(' '), { shell: true });
      } else {
        child = spawn(cmd, args, { shell: false });
      }
    } catch {
      resolve({ text: '', code: -1, aborted: false, timedOut: false, failed: true });
      return;
    }

    let text = '';
    let done = false;
    const finish = (extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(Object.assign({ text, code: null, aborted: false, timedOut: false }, extra));
    };
    const kill = () => {
      try {
        child.kill();
      } catch {
        /* best-effort */
      }
    };
    const onAbort = () => {
      kill();
      finish({ aborted: true });
    };
    const timer = setTimeout(() => {
      kill();
      finish({ timedOut: true });
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    // Feed the prompt on stdin, then close it so the CLI can produce its answer.
    if (input != null && child.stdin) {
      child.stdin.on('error', () => {});
      try {
        child.stdin.write(input);
        child.stdin.end();
      } catch {
        /* the CLI may not read stdin; the arg path still applies */
      }
    }

    if (child.stdout) {
      let lineBuf = '';
      child.stdout.on('data', (chunk) => {
        const s = chunk.toString();
        text += s;
        if (onToken) onToken(s);
        // Scan completed lines for tool-activity markers and forward them.
        if (onTool) {
          lineBuf += s;
          let nl;
          while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const line = lineBuf.slice(0, nl);
            lineBuf = lineBuf.slice(nl + 1);
            const evt = detectTool(line);
            if (evt) onTool(evt);
          }
        }
      });
    }
    if (child.stderr) child.stderr.on('data', () => {});
    child.on('error', () => finish({ failed: true }));
    child.on('close', (code) => finish({ code }));
  });
}

module.exports = { hasBin, streamCli, detectTool };
