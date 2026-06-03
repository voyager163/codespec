// The never-ending test → detect → self-heal → retest loop. It does not just fail
// loudly: on a real bug it drives opsx explore → propose → apply and loops until
// green AND the app matches the approved MVP. Guardrails keep it safe.
import { failureToChange, type FailureSignal } from './failure-to-change';

export interface LoopGuards {
  maxIterations: number;
  maxAttemptsPerFailure: number;
}

export interface LoopHooks {
  /** Run the e2e suite; return the failing spec names. */
  runE2e: () => Promise<string[]>;
  /** Drive opsx explore → propose → apply for a scaffolded change. */
  applyChange: (changeName: string) => Promise<void>;
  /** Optional progress reporter (e.g. PowerCodex status bus emit). */
  report?: (message: string) => void;
}

export async function runHealLoop(hooks: LoopHooks, guards: LoopGuards): Promise<'green' | 'escalated'> {
  let prevSignature: string | null = null;

  for (let iteration = 1; iteration <= guards.maxIterations; iteration += 1) {
    hooks.report?.(`e2e iteration ${iteration}`);
    const failures = await hooks.runE2e();

    if (failures.length === 0) {
      hooks.report?.('green — app matches approved MVP');
      return 'green'; // the only deliberate stop
    }

    const signature = failures.join(',');
    if (signature === prevSignature) {
      hooks.report?.('no-progress detector: same failure twice → escalate');
      return 'escalated';
    }
    prevSignature = signature;

    const signal: FailureSignal = {
      signal: 'defect',
      spec: failures[0],
      evidence: ['trace.zip'],
      confidence: 0.85,
      suggestedProposal: `Fix the assertion(s) failing in ${failures[0]}.`,
    };
    const { changeName } = failureToChange(signal);
    hooks.report?.(`self-heal: scaffolded ${changeName}, applying…`);
    await hooks.applyChange(changeName);
  }

  hooks.report?.('iteration cap reached → escalate');
  return 'escalated';
}
