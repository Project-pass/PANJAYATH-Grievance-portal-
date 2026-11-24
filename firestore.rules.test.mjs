import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'abc-gram-panchayat-rules-test';
const RULES_SOURCE = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

function parseEmulatorHost() {
  const raw = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, portStr] = raw.split(':');
  return {
    host: host || '127.0.0.1',
    port: Number(portStr) || 8080,
  };
}

let testEnv;

function validGrievancePayload(overrides = {}) {
  return {
    id: 'ABC-GRV-2026-901',
    ownerUid: 'citizen_1',
    citizenName: 'Meera Nair',
    mobileLast4: '4321',
    ward: 4,
    category: 'Water Supply',
    department: 'Water & Sanitation',
    landmark: 'Near Ration Shop Ward 4',
    description: 'Main drinking water pipeline leaking near junction since morning.',
    status: 'SUBMITTED',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function validSummaryPayload(overrides = {}) {
  return {
    id: 'ABC-GRV-2026-901',
    ward: 4,
    category: 'Water Supply',
    department: 'Water & Sanitation',
    status: 'SUBMITTED',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function validServicePayload(overrides = {}) {
  return {
    id: 'ABC-SRV-2026-901',
    ownerUid: 'citizen_1',
    serviceId: 'residence',
    serviceName: 'Residence Certificate',
    applicantName: 'Meera Nair',
    mobileLast4: '4321',
    ward: 4,
    address: 'House No 12, Ward 4, ABC Gram Panchayat',
    department: 'Revenue & Certificates',
    feeInr: 25,
    status: 'Submitted',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedFixtureData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.now();

    await setDoc(doc(db, 'admins', 'admin_1'), {
      uid: 'admin_1',
      grantedAt: now,
    });

    await setDoc(doc(db, 'staff_directory', 'staff_approver'), {
      uid: 'staff_approver',
      name: 'Ramesh Nair',
      designation: 'Senior Clerk',
      role: 'WARD_OFFICER',
      department: 'Revenue & Certificates',
      isActive: true,
      canApproveCertificates: true,
      canAssignTickets: false,
      canManageUsers: false,
      canDeleteRecords: false,
      canVerifyDocuments: true,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'staff_directory', 'staff_basic'), {
      uid: 'staff_basic',
      name: 'Lakshmi Pillai',
      designation: 'Junior Officer',
      role: 'WARD_OFFICER',
      department: 'Water & Sanitation',
      isActive: true,
      canApproveCertificates: false,
      canAssignTickets: false,
      canManageUsers: false,
      canDeleteRecords: false,
      canVerifyDocuments: true,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'staff_directory', 'staff_basic', 'private', 'info'), {
      uid: 'staff_basic',
      email: 'lakshmi@abc-panchayat.gov.in',
      updatedAt: now,
    });

    await setDoc(doc(db, 'staff_directory', 'staff_inactive'), {
      uid: 'staff_inactive',
      name: 'Suspended Officer',
      designation: 'Ward Officer',
      role: 'WARD_OFFICER',
      department: 'Water & Sanitation',
      isActive: false,
      canApproveCertificates: false,
      canAssignTickets: false,
      canManageUsers: false,
      canDeleteRecords: false,
      canVerifyDocuments: false,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'public_stats', 'overview'), {
      resolvedCount: 14,
      avgDays: 2.8,
      activeServicesCount: 6,
      avgRating: 4.6,
      slaLimitDays: 7,
      updatedAt: now,
    });

    await setDoc(doc(db, 'config', 'sla'), {
      slaLimitDays: 7,
      updatedAt: now,
    });

    await setDoc(doc(db, 'grievances', 'ABC-GRV-EXISTING'), {
      id: 'ABC-GRV-EXISTING',
      ownerUid: 'citizen_1',
      citizenName: 'Meera Nair',
      mobileLast4: '4321',
      ward: 4,
      category: 'Water Supply',
      department: 'Water & Sanitation',
      landmark: 'Ward 4 Junction',
      description: 'Water supply pressure is very low in morning hours.',
      status: 'SUBMITTED',
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'grievances', 'ABC-GRV-RESOLVED'), {
      id: 'ABC-GRV-RESOLVED',
      ownerUid: 'citizen_1',
      citizenName: 'Meera Nair',
      mobileLast4: '4321',
      ward: 4,
      category: 'Water Supply',
      department: 'Water & Sanitation',
      landmark: 'Ward 4 Pump House',
      description: 'Valve replaced and verified by field staff.',
      status: 'RESOLVED',
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'grievance_summaries', 'ABC-GRV-RESOLVED'), {
      id: 'ABC-GRV-RESOLVED',
      ward: 4,
      category: 'Water Supply',
      department: 'Water & Sanitation',
      status: 'RESOLVED',
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'services', 'ABC-SRV-EXISTING'), {
      id: 'ABC-SRV-EXISTING',
      ownerUid: 'citizen_1',
      serviceId: 'residence',
      serviceName: 'Residence Certificate',
      applicantName: 'Meera Nair',
      mobileLast4: '4321',
      ward: 4,
      address: 'House 12, Ward 4, ABC Gram Panchayat',
      department: 'Revenue & Certificates',
      feeInr: 25,
      status: 'Submitted',
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'audit_logs', 'aud-existing-1'), {
      id: 'aud-existing-1',
      actorUid: 'staff_basic',
      actorRole: 'WARD_OFFICER',
      action: 'INITIAL_SEED',
      targetId: 'ABC-GRV-EXISTING',
      details: 'Seeded initial audit record.',
      timestamp: now,
    });
  });
}

describe('Firestore Security Rules — Real Emulator Suite', () => {
  before(async () => {
    const { host, port } = parseEmulatorHost();
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: RULES_SOURCE,
        host,
        port,
      },
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedFixtureData();
  });

  describe('Positive Authorized Flows', () => {
    it('allows unauthenticated read of public_stats/overview and resolved grievance_summaries', async () => {
      const anonDb = testEnv.unauthenticatedContext().firestore();
      const statsSnap = await assertSucceeds(getDoc(doc(anonDb, 'public_stats', 'overview')));
      assert.equal(statsSnap.exists(), true);

      const sumSnap = await assertSucceeds(
        getDoc(doc(anonDb, 'grievance_summaries', 'ABC-GRV-RESOLVED'))
      );
      assert.equal(sumSnap.data()?.status, 'RESOLVED');
    });

    it('allows verified citizen to submit grievance + summary in atomic batch and read/list own records', async () => {
      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'citizen1@example.com', email_verified: true })
        .firestore();

      const batch = writeBatch(citizenDb);
      batch.set(doc(citizenDb, 'grievances', 'ABC-GRV-2026-901'), validGrievancePayload());
      batch.set(doc(citizenDb, 'grievance_summaries', 'ABC-GRV-2026-901'), validSummaryPayload());
      await assertSucceeds(batch.commit());

      const ownSnap = await assertSucceeds(
        getDoc(doc(citizenDb, 'grievances', 'ABC-GRV-2026-901'))
      );
      assert.equal(ownSnap.data()?.ownerUid, 'citizen_1');

      const scopedQuery = query(
        collection(citizenDb, 'grievances'),
        where('ownerUid', '==', 'citizen_1')
      );
      const listSnap = await assertSucceeds(getDocs(scopedQuery));
      assert.ok(listSnap.size >= 1);
    });

    it('allows active staff to update allowed grievance workflow fields and non-cert staff to verify service docs', async () => {
      const staffDb = testEnv
        .authenticatedContext('staff_basic', { email: 'lakshmi@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertSucceeds(
        updateDoc(doc(staffDb, 'grievances', 'ABC-GRV-EXISTING'), {
          status: 'IN_PROGRESS',
          publicRemark: 'Field inspection started.',
          internalRemark: 'Valve spare ordered.',
          assignedOfficerId: 'staff_basic',
          updatedAt: serverTimestamp(),
        })
      );

      await assertSucceeds(
        updateDoc(doc(staffDb, 'services', 'ABC-SRV-EXISTING'), {
          status: 'Documents Verified',
          officialRemark: 'Ration card verified.',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('allows staff with canApproveCertificates=true to approve service applications', async () => {
      const approverDb = testEnv
        .authenticatedContext('staff_approver', { email: 'ramesh@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertSucceeds(
        updateDoc(doc(approverDb, 'services', 'ABC-SRV-EXISTING'), {
          status: 'Approved',
          officialRemark: 'Approved for digital issue.',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('allows active staff to append own audit log and read own private staff record', async () => {
      const staffDb = testEnv
        .authenticatedContext('staff_basic', { email: 'lakshmi@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertSucceeds(
        getDoc(doc(staffDb, 'staff_directory', 'staff_basic', 'private', 'info'))
      );

      await assertSucceeds(
        setDoc(doc(staffDb, 'audit_logs', 'aud-staff-1'), {
          id: 'aud-staff-1',
          actorUid: 'staff_basic',
          actorRole: 'WARD_OFFICER',
          action: 'GRIEVANCE_INSPECTED',
          targetId: 'ABC-GRV-EXISTING',
          details: 'Staff inspected ward water leak.',
          timestamp: serverTimestamp(),
        })
      );
    });

    it('allows Super Admin to create staff directory profile, private info, SLA config, and security alert', async () => {
      const adminDb = testEnv
        .authenticatedContext('admin_1', { email: 'sec@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertSucceeds(
        setDoc(doc(adminDb, 'staff_directory', 'staff_new'), {
          uid: 'staff_new',
          name: 'Arun Kumar',
          designation: 'Overseer',
          role: 'WARD_OFFICER',
          department: 'Roads & Streetlights',
          isActive: true,
          canApproveCertificates: false,
          canAssignTickets: false,
          canManageUsers: false,
          canDeleteRecords: false,
          canVerifyDocuments: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      await assertSucceeds(
        setDoc(doc(adminDb, 'config', 'sla'), {
          slaLimitDays: 10,
          updatedAt: serverTimestamp(),
        })
      );

      await assertSucceeds(
        setDoc(doc(adminDb, 'security_alerts', 'alert-1'), {
          id: 'alert-1',
          severity: 'HIGH',
          eventType: 'RATE_LIMIT_BREACH',
          summary: 'Repeated failed login attempts detected.',
          timestamp: serverTimestamp(),
        })
      );
    });
  });

  describe('Dirty Dozen & Negative Security Assertions', () => {
    it('1. rejects shadow field injection on grievance create', async () => {
      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();

      await assertFails(
        setDoc(
          doc(citizenDb, 'grievances', 'ABC-GRV-2026-901'),
          validGrievancePayload({ shadowAdminFlag: true })
        )
      );
    });

    it('2. rejects identity spoofing via mismatched ownerUid', async () => {
      const attackerDb = testEnv
        .authenticatedContext('citizen_2', { email: 'c2@example.com', email_verified: true })
        .firestore();

      await assertFails(
        setDoc(
          doc(attackerDb, 'grievances', 'ABC-GRV-2026-901'),
          validGrievancePayload({ ownerUid: 'citizen_1' })
        )
      );
    });

    it('3. rejects path/id mismatch and invalid ID characters', async () => {
      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();

      await assertFails(
        setDoc(
          doc(citizenDb, 'grievances', 'ABC-GRV-DIFFERENT'),
          validGrievancePayload({ id: 'ABC-GRV-2026-901' })
        )
      );

      await assertFails(
        setDoc(
          doc(citizenDb, 'grievances', 'bad$id!'),
          validGrievancePayload({ id: 'bad$id!' })
        )
      );
    });

    it('4. rejects oversized description string (>2000 chars)', async () => {
      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();

      await assertFails(
        setDoc(
          doc(citizenDb, 'grievances', 'ABC-GRV-2026-901'),
          validGrievancePayload({ description: 'x'.repeat(2005) })
        )
      );
    });

    it('5. rejects client-forged createdAt timestamp', async () => {
      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();

      await assertFails(
        setDoc(
          doc(citizenDb, 'grievances', 'ABC-GRV-2026-901'),
          validGrievancePayload({ createdAt: Timestamp.fromMillis(1700000000000) })
        )
      );
    });

    it('6. blocks self-assigned SUPER_ADMIN privilege escalation on admins/{uid}', async () => {
      const attackerDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();

      await assertFails(
        setDoc(doc(attackerDb, 'admins', 'citizen_1'), {
          uid: 'citizen_1',
          grantedAt: serverTimestamp(),
        })
      );
    });

    it('7. blocks unverified email token write attempts', async () => {
      const unverifiedDb = testEnv
        .authenticatedContext('citizen_unverified', {
          email: 'unverified@example.com',
          email_verified: false,
        })
        .firestore();

      await assertFails(
        setDoc(
          doc(unverifiedDb, 'grievances', 'ABC-GRV-2026-901'),
          validGrievancePayload({ ownerUid: 'citizen_unverified' })
        )
      );
    });

    it('8. blocks cross-user private staff PII read', async () => {
      const otherStaffDb = testEnv
        .authenticatedContext('staff_approver', { email: 'ramesh@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertFails(
        getDoc(doc(otherStaffDb, 'staff_directory', 'staff_basic', 'private', 'info'))
      );

      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();
      await assertFails(
        getDoc(doc(citizenDb, 'staff_directory', 'staff_basic', 'private', 'info'))
      );
    });

    it('9. blocks unscoped collection list scraping on grievances, public_stats, and admins', async () => {
      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();

      await assertFails(getDocs(collection(citizenDb, 'grievances')));
      await assertFails(getDocs(collection(citizenDb, 'public_stats')));
      await assertFails(getDocs(collection(citizenDb, 'admins')));
    });

    it('10. blocks non-admin active staff updates on terminal RESOLVED grievances', async () => {
      const staffDb = testEnv
        .authenticatedContext('staff_basic', { email: 'lakshmi@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertFails(
        updateDoc(doc(staffDb, 'grievances', 'ABC-GRV-RESOLVED'), {
          status: 'IN_PROGRESS',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('11. enforces append-only immutability: blocks audit_logs update and delete even for Super Admin', async () => {
      const adminDb = testEnv
        .authenticatedContext('admin_1', { email: 'sec@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertFails(
        updateDoc(doc(adminDb, 'audit_logs', 'aud-existing-1'), {
          details: 'Tampered entry',
        })
      );
      await assertFails(deleteDoc(doc(adminDb, 'audit_logs', 'aud-existing-1')));
    });

    it('12. blocks unauthorized certificate approval by staff lacking canApproveCertificates', async () => {
      const basicStaffDb = testEnv
        .authenticatedContext('staff_basic', { email: 'lakshmi@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertFails(
        updateDoc(doc(basicStaffDb, 'services', 'ABC-SRV-EXISTING'), {
          status: 'Approved',
          officialRemark: 'Attempted unauthorized approval',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('13. rejects orphan grievance_summaries creation when parent grievance does not exist', async () => {
      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();

      await assertFails(
        setDoc(
          doc(citizenDb, 'grievance_summaries', 'ABC-GRV-ORPHAN'),
          validSummaryPayload({ id: 'ABC-GRV-ORPHAN' })
        )
      );
    });

    it('14. rejects inactive staff reads and updates on grievances', async () => {
      const inactiveDb = testEnv
        .authenticatedContext('staff_inactive', { email: 'old@abc-panchayat.gov.in', email_verified: true })
        .firestore();

      await assertFails(getDoc(doc(inactiveDb, 'grievances', 'ABC-GRV-EXISTING')));
      await assertFails(
        updateDoc(doc(inactiveDb, 'grievances', 'ABC-GRV-EXISTING'), {
          status: 'IN_PROGRESS',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('15. rejects citizen setting internalRemark or assignedOfficerId on grievance creation and service creation with Approved status', async () => {
      const citizenDb = testEnv
        .authenticatedContext('citizen_1', { email: 'c1@example.com', email_verified: true })
        .firestore();

      await assertFails(
        setDoc(
          doc(citizenDb, 'grievances', 'ABC-GRV-2026-901'),
          validGrievancePayload({ internalRemark: 'Spoofed staff note' })
        )
      );

      await assertFails(
        setDoc(
          doc(citizenDb, 'services', 'ABC-SRV-2026-901'),
          validServicePayload({ status: 'Approved' })
        )
      );
    });
  });
});
