import {
  observeFirebaseAuth,
  signInWithGoogleCloud,
  signOutGoogleCloud,
} from './firebase.js';

const CITIZEN_PERMISSIONS = {
  canApproveCertificates: false,
  canAssignTickets: false,
  canManageUsers: false,
  canDeleteRecords: false,
  canVerifyDocuments: false,
};

function readCookie(name) {
  const prefix = `${name}=`;
  const parts = String(document.cookie || '').split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

export const store = {
  publicOverview: {
    slaLimitDays: 7,
    categorySlaDays: {},
    stats: {
      resolvedCount: 0,
      totalCount: 0,
      avgDays: '0.0',
      activeServicesCount: 6,
      avgRating: '0.0',
      ratingCount: 0,
    },
    recentWorks: [],
    serviceCatalog: [],
  },
  staffDashboard: {
    slaLimitDays: 7,
    grievances: [],
    services: [],
    staff: [],
    auditLogs: [],
    securityAlerts: [],
    notifications: [],
    auditRetention: null,
  },
  // Session ID stays strictly inside HttpOnly cookie (`panchayat_sid`); JS holds only bound CSRF token
  csrfToken: readCookie('panchayat_csrf'),
  currentUser: null,
  bootstrapRequired: false,
  envPasscodeConfigured: false,
  firebaseUser: null,
  isSubmitting: false,
  language: 'en',
  portalMode: window.location.pathname.startsWith('/admin') ? 'admin' : 'citizen',
  citizenView: 'home',
  adminView: window.location.pathname.includes('access-control') ? 'access-control' : 'overview',
  mobileMenuOpen: false,
  mobileSidebarOpen: false,
  trackQuery: '',
  trackToken: '',
  trackMobileLast4: '',
  trackedRecord: null,
  trackError: '',
  ratingDraft: 5,
  selectedService: null,
  submittedGrievance: null,
  submittedGrievanceToken: '',
  submittedDuplicates: [],
  submittedService: null,
  submittedServiceToken: '',
  gPhotoPreview: '',
  serviceCheckedDocs: [],
  serviceUploadedFiles: [],
  adminFilters: {
    search: '',
    status: 'ALL',
    ward: 'ALL',
    category: 'ALL',
    priority: 'ALL',
    slaOverdueOnly: false,
    auditSearch: '',
    page: 1,
    pageSize: 25,
  },
  selectedGrievanceId: null,
  selectedServiceId: null,
  walkInType: null,
  staffModalOpen: false,
  editingStaffId: null,
  staffModalWards: [],
  listeners: new Set(),
};

export function subscribe(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

export function notify() {
  store.listeners.forEach((fn) => fn());
}

export function getCurrentUser() {
  return store.currentUser && store.currentUser.isActive ? store.currentUser : null;
}

export function getActivePermissions() {
  const user = getCurrentUser();
  return user ? user.permissions : CITIZEN_PERMISSIONS;
}

export function canViewGrievance(ticket) {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN' || user.role === 'CSC_OPERATOR') return true;
  const inWard = user.assignedWards.includes(ticket.ward);
  const sameDept =
    ticket.department === user.department || ticket.assignedOfficerId === user.id;
  return inWard && sameDept;
}

export function canViewService(app) {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN' || user.role === 'CSC_OPERATOR') return true;
  const inWard = user.assignedWards.includes(app.ward);
  const sameDept = app.department === user.department || app.assignedOfficerId === user.id;
  return inWard && sameDept;
}

async function apiRequest(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const csrf = store.csrfToken || readCookie('panchayat_csrf');
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'PanchayatPortal',
    ...(isMutation && csrf ? { 'X-CSRF-Token': csrf } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: 'Unexpected server response.' };
  }
  return { status: res.status, ok: res.ok, data };
}

export async function refreshPublicOverview() {
  const [ovRes, authRes] = await Promise.all([
    apiRequest('/api/public/overview', { method: 'GET' }),
    apiRequest('/api/auth/status', { method: 'GET' }),
  ]);
  if (ovRes.ok && ovRes.data.ok) {
    store.publicOverview = {
      slaLimitDays: ovRes.data.slaLimitDays || 7,
      categorySlaDays: ovRes.data.categorySlaDays || {},
      stats: ovRes.data.stats || store.publicOverview.stats,
      recentWorks: ovRes.data.recentWorks || [],
      serviceCatalog: ovRes.data.serviceCatalog || [],
    };
  }
  if (authRes.ok && authRes.data.ok) {
    store.bootstrapRequired = Boolean(authRes.data.bootstrapRequired);
    store.envPasscodeConfigured = Boolean(authRes.data.envPasscodeConfigured);
    store.currentUser = authRes.data.authenticated ? authRes.data.user : null;
  }
  if (store.currentUser) {
    await refreshStaffDashboard();
  } else {
    notify();
  }
}

export async function refreshStaffDashboard() {
  const res = await apiRequest('/api/staff/dashboard', { method: 'GET' });
  if (res.ok && res.data.ok) {
    store.currentUser = res.data.user;
    store.staffDashboard = {
      slaLimitDays: res.data.slaLimitDays || 7,
      grievances: res.data.grievances || [],
      services: res.data.services || [],
      staff: res.data.staff || [],
      auditLogs: res.data.auditLogs || [],
      securityAlerts: res.data.securityAlerts || [],
      notifications: res.data.notifications || [],
      auditRetention: res.data.auditRetention || null,
    };
  } else if (res.status === 401) {
    store.csrfToken = null;
    store.currentUser = null;
  }
  notify();
}

export async function bootstrapClaimSecretary(passcode) {
  const res = await apiRequest('/api/auth/bootstrap-claim', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
  if (res.ok && res.data.ok) {
    store.csrfToken = res.data.csrfToken || readCookie('panchayat_csrf');
    store.currentUser = res.data.user;
    store.bootstrapRequired = false;
    await refreshStaffDashboard();
    return { ok: true };
  }
  return { ok: false, error: res.data.error || 'Setup failed.' };
}

export async function loginWithCredentials(identifier, passcode) {
  const res = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, passcode }),
  });
  if (res.ok && res.data.ok) {
    store.csrfToken = res.data.csrfToken || readCookie('panchayat_csrf');
    store.currentUser = res.data.user;
    await refreshStaffDashboard();
    return { ok: true };
  }
  return { ok: false, error: res.data.error || 'Authentication failed.' };
}

export async function logoutStaff() {
  await apiRequest('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  store.csrfToken = null;
  store.currentUser = null;
  store.staffDashboard = {
    slaLimitDays: store.publicOverview.slaLimitDays,
    grievances: [],
    services: [],
    staff: [],
    auditLogs: [],
    securityAlerts: [],
    notifications: [],
    auditRetention: null,
  };
  store.selectedGrievanceId = null;
  store.selectedServiceId = null;
  notify();
}

export async function changeOwnPassword(currentPassword, newPassword) {
  const res = await apiRequest('/api/staff/account/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function resetStaffPassword(staffId, newPassword) {
  const res = await apiRequest(`/api/staff/users/${encodeURIComponent(staffId)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function submitGrievance(payload, asStaffWalkIn = false) {
  if (store.isSubmitting) return { ok: false, error: 'Submission already in progress.' };
  store.isSubmitting = true;
  notify();
  try {
    const endpoint = asStaffWalkIn ? '/api/staff/grievances' : '/api/public/grievances';
    const res = await apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok && res.data.ok) {
      store.submittedGrievanceToken = res.data.trackingToken || '';
      store.submittedDuplicates = res.data.potentialDuplicates || [];
      await refreshPublicOverview();
      return {
        ok: true,
        ticket: res.data.ticket,
        trackingToken: res.data.trackingToken,
        potentialDuplicates: res.data.potentialDuplicates || [],
      };
    }
    return { ok: false, error: res.data.error || 'Unable to submit grievance.' };
  } finally {
    store.isSubmitting = false;
    notify();
  }
}

export async function submitServiceApplication(payload, asStaffWalkIn = false) {
  if (store.isSubmitting) return { ok: false, error: 'Submission already in progress.' };
  store.isSubmitting = true;
  notify();
  try {
    const endpoint = asStaffWalkIn ? '/api/staff/services' : '/api/public/services';
    const res = await apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok && res.data.ok) {
      store.submittedServiceToken = res.data.trackingToken || '';
      await refreshPublicOverview();
      return { ok: true, application: res.data.application, trackingToken: res.data.trackingToken };
    }
    return { ok: false, error: res.data.error || 'Unable to submit service application.' };
  } finally {
    store.isSubmitting = false;
    notify();
  }
}

export async function trackApplication(trackingId, trackingToken, mobileLast4) {
  store.trackQuery = trackingId;
  store.trackToken = trackingToken;
  store.trackMobileLast4 = mobileLast4;
  store.trackError = '';
  const res = await apiRequest('/api/public/track', {
    method: 'POST',
    body: JSON.stringify({ trackingId, trackingToken, mobileLast4 }),
  });
  if (res.ok && res.data.ok) {
    store.trackedRecord = res.data.record;
  } else {
    store.trackedRecord = null;
    store.trackError = res.data.error || 'Verification failed.';
  }
  notify();
  return res.data;
}

export async function submitFeedback(ticketId, rating, comment) {
  const res = await apiRequest(
    `/api/public/grievances/${encodeURIComponent(ticketId)}/feedback`,
    {
      method: 'POST',
      body: JSON.stringify({
        trackingToken: store.trackToken,
        mobileLast4: store.trackMobileLast4,
        rating,
        comment,
      }),
    }
  );
  if (res.ok && res.data.ok) {
    store.trackedRecord = res.data.record;
    await refreshPublicOverview();
  }
  return res.data;
}

export async function reopenGrievance(ticketId, reason) {
  const res = await apiRequest(
    `/api/public/grievances/${encodeURIComponent(ticketId)}/reopen`,
    {
      method: 'POST',
      body: JSON.stringify({
        trackingToken: store.trackToken,
        mobileLast4: store.trackMobileLast4,
        reason,
      }),
    }
  );
  if (res.ok && res.data.ok) {
    store.trackedRecord = res.data.record;
    await refreshPublicOverview();
  }
  return res.data;
}

export async function updateGrievance(ticketId, patch) {
  const res = await apiRequest(`/api/staff/grievances/${encodeURIComponent(ticketId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function addGrievanceComment(ticketId, body, isInternal = false) {
  const res = await apiRequest(`/api/staff/grievances/${encodeURIComponent(ticketId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, isInternal }),
  });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function escalateOverdueGrievances() {
  const res = await apiRequest('/api/staff/grievances/escalate-overdue', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function updateServiceApplication(appId, patch) {
  const res = await apiRequest(`/api/staff/services/${encodeURIComponent(appId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function deleteRecord(kind, id) {
  const path =
    kind === 'grievance'
      ? `/api/staff/grievances/${encodeURIComponent(id)}`
      : `/api/staff/services/${encodeURIComponent(id)}`;
  const res = await apiRequest(path, { method: 'DELETE' });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function saveStaff(staffId, payload) {
  const url = staffId
    ? `/api/staff/users/${encodeURIComponent(staffId)}`
    : '/api/staff/users';
  const method = staffId ? 'PUT' : 'POST';
  const res = await apiRequest(url, {
    method,
    body: JSON.stringify(payload),
  });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function toggleStaffActive(staffId) {
  const res = await apiRequest(`/api/staff/users/${encodeURIComponent(staffId)}/toggle`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (res.ok) await refreshStaffDashboard();
  return res.data;
}

export async function updateSlaLimit(days) {
  const res = await apiRequest('/api/staff/config/sla', {
    method: 'PUT',
    body: JSON.stringify({ slaLimitDays: days }),
  });
  if (res.ok) await refreshPublicOverview();
  return res.data;
}

export async function maintenanceReset(confirmPhrase, maintenanceKey = '') {
  const payload = { confirmPhrase };
  if (maintenanceKey) payload.maintenanceKey = maintenanceKey;
  const res = await apiRequest('/api/staff/maintenance/reset', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    store.csrfToken = null;
    store.currentUser = null;
    store.portalMode = 'citizen';
    store.citizenView = 'home';
    window.history.replaceState({}, '', '/');
    await refreshPublicOverview();
  }
  return res.data;
}

export async function connectFirebaseGoogle() {
  try {
    const user = await signInWithGoogleCloud();
    store.firebaseUser = user;
    notify();
    return { ok: true, user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Google Sign-In cancelled.' };
  }
}

export async function disconnectFirebaseGoogle() {
  await signOutGoogleCloud();
  store.firebaseUser = null;
  notify();
}

observeFirebaseAuth((user) => {
  store.firebaseUser = user;
  notify();
});
