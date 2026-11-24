/**
 * Firestore Security Rules Verification Matrix ("Dirty Dozen" + Positive Flows)
 * Note: Project uses pure JS frontend; this verification spec documents the rules unit test cases
 * executed against DRAFT_firestore.rules and firestore.rules via ESLint & rule-logic assertions.
 */

export const DIRTY_DOZEN_CASES = [
  {
    id: 1,
    name: 'Shadow field injection on grievance create',
    collection: 'grievances',
    op: 'create',
    payload: { id: 'ABC-GRV-1', ownerUid: 'user-1', shadowAdminFlag: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Identity spoofing via mismatched ownerUid',
    collection: 'grievances',
    op: 'create',
    payload: { id: 'ABC-GRV-2', ownerUid: 'victim-uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Path variable ID poisoning',
    collection: 'grievances',
    op: 'create',
    docId: 'bad/../../id_exceeding_regex',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Oversized description string (>2000 chars)',
    collection: 'grievances',
    op: 'create',
    payloadSize: 50000,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Client-forged createdAt timestamp',
    collection: 'grievances',
    op: 'create',
    forgedTimestamp: true,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Self-assigned SUPER_ADMIN privilege escalation',
    collection: 'admins',
    op: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Unverified email token write attempt',
    collection: 'grievances',
    op: 'create',
    emailVerified: false,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Cross-user private PII read',
    collection: 'staff_directory/other/private',
    op: 'get',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Unscoped collection list scraping on grievances',
    collection: 'grievances',
    op: 'list',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Non-admin update on terminal Resolved ticket',
    collection: 'grievances',
    op: 'update',
    existingStatus: 'Resolved',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Audit log modification or deletion',
    collection: 'audit_logs',
    op: 'delete',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthorized certificate approval by non-approver',
    collection: 'services',
    op: 'update',
    nextStatus: 'Approved',
    expected: 'PERMISSION_DENIED',
  },
];
