'use strict';
// timeout.js — turn "this could hang forever" into "this fails cleanly after N ms".
//
// The readiness review flagged that the loop's duration cap is only checked at rotation
// boundaries, so a single hung browser/CDP/pac call runs unbounded. These helpers give
// any individual async operation a hard ceiling.

class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label || 'operation'} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
    this.timedOut = true;
  }
}

// Reject if `promise` doesn't settle within ms. The underlying work isn't cancelled
// (callers that own a child process should also kill it), but the awaiter is freed.
function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return Promise.resolve(promise);
  let timer;
  const guard = new Promise((_resolve, reject) => {
    // Not unref'd: when a guarded operation truly hangs, this timer is the only thing
    // left to fire — it must keep the loop alive long enough to reject.
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), guard]);
}

// Like withTimeout, but resolves to `fallback` instead of rejecting on timeout — for
// best-effort steps that should degrade rather than throw.
async function withTimeoutOr(promise, ms, fallback, label) {
  try {
    return await withTimeout(promise, ms, label);
  } catch (e) {
    if (e && e.timedOut) return fallback;
    throw e;
  }
}

// A monotonic deadline helper for step loops: `deadline(ms)` returns () => remaining>0.
function deadline(ms) {
  const end = Date.now() + (ms || 0);
  return () => !ms || Date.now() < end;
}

module.exports = { withTimeout, withTimeoutOr, deadline, TimeoutError };
