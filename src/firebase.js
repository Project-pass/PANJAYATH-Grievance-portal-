import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Timestamp,
  doc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const OperationType = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
});

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

export function observeFirebaseAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogleCloud() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signOutGoogleCloud() {
  await signOut(auth);
}

export async function syncPublicOverviewToFirestore(stats) {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const path = 'public_stats/overview';
  try {
    await setDoc(doc(db, 'public_stats', 'overview'), {
      resolvedCount: Number(stats.resolvedCount || 0),
      avgDays: Number(stats.avgDays || 0),
      activeServicesCount: Number(stats.activeServicesCount || 6),
      avgRating: Number(stats.avgRating || 4.6),
      slaLimitDays: Number(stats.slaLimitDays || 7),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // Only super admins registered in /admins/{uid} can write public_stats; ignore permission-denied on non-admin viewers
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('permission-denied') && !msg.includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

export async function syncGrievanceToFirestore(ticket) {
  if (!auth.currentUser || !auth.currentUser.emailVerified || !ticket?.id) return;
  const path = `grievances/${ticket.id}`;
  try {
    const now = serverTimestamp();
    await setDoc(doc(db, 'grievances', ticket.id), {
      id: String(ticket.id).slice(0, 64),
      ownerUid: auth.currentUser.uid,
      citizenName: String(ticket.citizenName || 'Citizen').slice(0, 120),
      mobileLast4: String(ticket.mobile || '0000').slice(-4).padStart(4, '0'),
      ward: Number(ticket.ward || 1),
      category: String(ticket.category || 'Water Supply').slice(0, 64),
      department: String(ticket.department || 'General Administration').slice(0, 80),
      landmark: String(ticket.landmark || 'Ward Area').slice(0, 200),
      description: String(ticket.description || 'Submitted via portal').slice(0, 2000),
      status: String(ticket.status || 'Pending').slice(0, 40),
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export { Timestamp };
