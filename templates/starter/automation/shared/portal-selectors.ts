// Maker-portal locators, versioned in one place so a portal UI change is a
// one-file fix. TODO: confirm these against your tenant's current portal.
export const portalSelectors = {
  nav: {
    tables: 'a[aria-label="Tables"]',
    flows: 'a[aria-label="Flows"]',
    connections: 'a[aria-label="Connections"]',
  },
  table: {
    newTableButton: 'button:has-text("New table")',
    displayNameInput: 'input[aria-label="Display name"]',
    saveButton: 'button:has-text("Save")',
    columnAddButton: 'button:has-text("New column")',
  },
  // TODO: add flow + connection selectors as those actions are implemented.
} as const;

export type PortalSelectors = typeof portalSelectors;
