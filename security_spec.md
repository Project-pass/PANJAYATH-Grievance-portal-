# Security Specification & Payload Invariants (`ABC Gram Panchayat`)

## 1. Data Invariants
1. **Global Default-Deny**: No Firestore document outside explicitly matched collections may be read or written.
2. **Identity & Role Integrity**: Users cannot self-assign `SUPER_ADMIN`, `WARD_OFFICER`, or `CSC_OPERATOR` roles in `/staff_directory` or `/admins`. Only an existing Super Admin (verified via `/admins/{uid}`) may provision or update staff roles and permissions.
3. **Email Verification Mandate**: Every authenticated write requires `request.auth != null && request.auth.token.email_verified == true`.
4. **PII Split Isolation**: Public feeds (`/public_stats`, `/grievance_summaries`) never contain citizen names, phone numbers, addresses, or internal remarks. Full records (`/grievances`, `/services`, `/staff_directory/{uid}/private`) are restricted to the record owner (`ownerUid == request.auth.uid`) or verified active Panchayat staff.
5. **Immutable Audit Trail**: `/audit_logs` and `/security_alerts` are strictly append-only (`allow update, delete: if false;`), and `createdAt`/`ownerUid` fields on records are immutable after creation.
6. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps in Firestore writes must equal `request.time`.
7. **Terminal State Locking**: Once a grievance reaches `Resolved` or `Rejected`, or a service reaches `Approved` or `Rejected`, non-admin updates are strictly rejected.
8. **Size & Type Bounds**: Every string and ID is bounded by `maxLength` and regex patterns matching `firebase-blueprint.json`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Grievance Create**: Including `"isVerified": true` or `"internalRemark": "auto-approved"` in a citizen `create` payload -> must fail `hasOnly(...)`.
2. **Identity Spoofing on Grievance Create**: Setting `ownerUid` to another user's UID (`"other-uid-999"`) -> must fail `incoming().ownerUid == request.auth.uid`.
3. **Oversized ID Poisoning**: Attempting `create` at `/grievances/` with a 200-char or special-character document ID (`"../../admin"`) -> must fail `isValidId(ticketId)`.
4. **Oversized Description (Denial of Wallet)**: Sending a 50KB `description` string -> must fail `.size() <= 2000`.
5. **Client Timestamp Forgery**: Setting `createdAt` to a backdated ISO timestamp instead of `request.time` -> must fail `incoming().createdAt == request.time`.
6. **Self-Assigned Admin Escalation**: Regular signed-in user attempting to write `/admins/{uid}` or set `role: "SUPER_ADMIN"` in `/staff_directory/{uid}` -> must fail `!isAdmin()` check.
7. **Unverified Email Bypass**: Signed-in user with `email_verified: false` attempting a write -> must fail `request.auth.token.email_verified == true`.
8. **Cross-User PII Read**: Authenticated citizen reading `/grievances/{otherTicketId}` or `/staff_directory/{otherUid}/private/info` -> must fail ownership/staff check.
9. **Blanket List Scraping**: Unauthenticated or non-staff user calling `list` on `/grievances` or `/services` without scoping to `resource.data.ownerUid == request.auth.uid` -> must fail `allow list`.
10. **Terminal State Re-opening**: Non-admin attempting to update a `Resolved` grievance back to `Pending` -> must fail terminal state lock.
11. **Audit Log Tampering / Deletion**: Even an admin attempting `update` or `delete` on `/audit_logs/{logId}` -> must fail `allow update, delete: if false`.
12. **Certificate Self-Approval Bypass**: Ward officer without `canApproveCertificates` attempting to update `/services/{appId}` status to `"Approved"` -> must fail permission/admin check.
