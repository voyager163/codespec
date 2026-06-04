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

// Run a CLI and stream its stdout to onToken as it arrives. The prompt is written
// to the child's STDIN (not argv) so multi-word prompts never break on shell
// quoting. Honors an AbortSignal (the cockpit's Ctrl-C interrupt) and a timeout
// so a hung or unauthenticated CLI can never freeze the cockpit — it resolves
// with whatever it has and the caller falls back. Resolves; never rejects on a
// non-zero exit (the caller decides policy from { text, code, aborted, timedOut }).
function streamCli(cmd, args, { onToken, signal, input, timeoutMs = 60000 } = {}) {
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
      child.stdout.on('data', (chunk) => {
        const s = chunk.toString();
        text += s;
        if (onToken) onToken(s);
      });
    }
    if (child.stderr) child.stderr.on('data', () => {});
    child.on('error', () => finish({ failed: true }));
    child.on('close', (code) => finish({ code }));
  });
}

module.exports = { hasBin, streamCli };
