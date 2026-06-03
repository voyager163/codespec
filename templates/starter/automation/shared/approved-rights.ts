// The consent gate, shared by both engines. Read before every build / push /
// browser launch. Missing file or a false flag means: stop and ask.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ApprovedRights {
  browserProfile: string;
  allowBuild: boolean;
  allowPush: boolean;
  allowAutoRespec: boolean;
  allowAutoApplyDefects: boolean;
  grantedBy: string;
  grantedAt: string | null;
}

const APPROVAL_PATH = resolve(process.cwd(), 'Approved_rights', 'approval.json');

export function loadRights(): ApprovedRights | null {
  if (!existsSync(APPROVAL_PATH)) return null;
  return JSON.parse(readFileSync(APPROVAL_PATH, 'utf8')) as ApprovedRights;
}

export function assertAllowed(flag: keyof ApprovedRights): void {
  const rights = loadRights();
  if (!rights || rights[flag] !== true) {
    throw new Error(
      `Approved_rights/ ${String(flag)} is not granted. Set it in Approved_rights/approval.json before this action.`,
    );
  }
}
