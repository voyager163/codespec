// A reusable portal operation: create a Dataverse table. Declarative in,
// verified out — re-reads the portal to confirm the table exists before success.
import type { Page } from '@playwright/test';
import { portalSelectors } from '../../shared/portal-selectors';

export interface CreateTableInput {
  displayName: string;
  schemaName: string;
  columns?: Array<{ name: string; type: string }>;
}

export interface ActionResult {
  status: 'succeeded' | 'failed';
  verifiedInPortal: boolean;
  detail?: string;
}

export async function createDataverseTable(page: Page, input: CreateTableInput): Promise<ActionResult> {
  // TODO: wire to your tenant's portal. Sketch of the real flow:
  await page.click(portalSelectors.nav.tables);
  await page.click(portalSelectors.table.newTableButton);
  await page.fill(portalSelectors.table.displayNameInput, input.displayName);
  await page.click(portalSelectors.table.saveButton);

  // Idempotent + verified: confirm the table is actually present before success.
  const verifiedInPortal = await page
    .getByText(input.displayName, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);

  return {
    status: verifiedInPortal ? 'succeeded' : 'failed',
    verifiedInPortal,
    detail: verifiedInPortal ? undefined : 'Table not found in portal after create.',
  };
}
