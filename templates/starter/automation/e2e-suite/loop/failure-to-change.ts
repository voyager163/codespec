// Bridges a test failure into an OpenSpec change scaffold, rendered in the same
// HTML artifact format the planning workflow uses (see .github/prompts/_html-artifact.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FailureSignal {
  signal: 'defect' | 'gap' | 'improvement';
  spec: string;
  evidence: string[]; // trace.zip, screenshots, console
  confidence: number;
  suggestedProposal: string;
}

/** Scaffolds openspec/changes/<name>/ with a proposal + an observation record. */
export function failureToChange(signal: FailureSignal): { changeName: string; dir: string } {
  const changeName = `auto-fix-${slug(signal.spec)}`;
  const dir = resolve(process.cwd(), 'openspec', 'changes', changeName);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    resolve(dir, 'observation.json'),
    JSON.stringify(
      {
        origin: 'e2e-observer',
        signal: signal.signal,
        evidence: signal.evidence,
        confidence: signal.confidence,
        suggestedProposal: signal.suggestedProposal,
        renderedArtifact: 'preview.html', // Plan A format
        needsApproval: signal.signal !== 'defect',
      },
      null,
      2,
    ),
  );

  writeFileSync(
    resolve(dir, 'proposal.md'),
    `## Why\n\nE2E observed a ${signal.signal} on \`${signal.spec}\`.\n\n## What Changes\n\n- ${signal.suggestedProposal}\n`,
  );

  // TODO: render preview.html via the shared HTML-artifact convention.
  return { changeName, dir };
}

function slug(value: string): string {
  return value.replace(/\.spec\.ts$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
