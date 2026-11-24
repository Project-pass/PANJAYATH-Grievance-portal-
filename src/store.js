const SESSION_KEY = 'abc_gp_session_staff_id_v2';
const CACHE_KEY = 'abc_gp_state_cache_v2';

const CITIZEN_PERMISSIONS = {
  canApproveCertificates: false,
  canAssignTickets: false,
  canManageUsers: false,
  canDeleteRecords: false,
  canVerifyDocuments: false,
};

export const store = {
  portalState: {
    slaLimitDays: 7,
    staff: [],
    grievances: [],
    services: [],
    auditLogs: [],
  },
  sessionStaffId: localStorage.getItem(SESSION_KEY) || null,
  language: 'en',
  portalMode: window.location.pathname.startsWith('/admin') ? 'admin' : 'citizen',
  citizenView: 'home',
  adminView: window.location.pathname.includes('access-control') ? 'access-control' : 'overview',
  mobileMenuOpen: false,
  mobileSidebarOpen: false,
  trackQuery: 'ABC-GRV-2026-101',
  ratingDraft: 5,
  selectedService: null,
  submittedGrievance: null,
  submittedService: null,
  gPhotoPreview: '',
  serviceCheckedDocs: [],
  serviceUploadedFiles: [],
  adminFilters: {
    search: '',
    status: 'ALL',
    ward: 'ALL',
    category: 'ALL',
    slaOverdueOnly: false,
    auditSearch: '',
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
  if (!store.sessionStaffId) return null;
  const user = store.portalState.staff.find((s) => s.id === store.sessionStaffId);
  return user && user.isActive ? user : null;
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
  const headers = {
    'Content-Type': 'application/json',
    ...(store.sessionStaffId ? { 'X-Staff-Id': store.sessionStaffId } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

export async function refreshState() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      store.portalState = data;
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      notify();
      return;
    }
  } catch {
    // Fallback to cached state if offline
  }
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      store.portalState = JSON.parse(cached);
      notify();
    } catch {
      // ignore
    }
  }
}

export function setSessionStaffId(staffId) {
  store.sessionStaffId = staffId;
  if (staffId) localStorage.setItem(SESSION_KEY, staffId);
  else localStorage.removeItem(SESSION_KEY);
}

export async function loginWithCredentials(email, pin) {
  const res = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, pin }),
  });
  if (res.ok && res.data.staff) {
    setSessionStaffId(res.data.staff.id);
    await refreshState();
    return { ok: true };
  }
  return { ok: false, error: res.data.error || 'Authentication failed.' };
}

export function switchActiveRole(staffIdOrCitizen) {
  if (staffIdOrCitizen === 'CITIZEN') {
    setSessionStaffId(null);
    notify();
    return;
  }
  const staff = store.portalState.staff.find(
    (s) => s.id === staffIdOrCitizen && s.isActive
  );
  if (staff) {
    setSessionStaffId(staff.id);
    store.portalMode = 'admin';
    if (!window.location.pathname.startsWith('/admin')) {
      window.history.replaceState({}, '', '/admin');
    }
    notify();
  }
}

export function logoutStaff() {
  setSessionStaffId(null);
  notify();
}

export async function submitGrievance(payload) {
  const res = await apiRequest('/api/grievances', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    await refreshState();
    return res.data.ticket;
  }
  return null;
}

export async function submitServiceApplication(payload) {
  const res = await apiRequest('/api/services', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    await refreshState();
    return res.data.application;
  }
  return null;
}

export async function submitFeedback(ticketId, rating, comment) {
  await apiRequest(`/api/grievances/${encodeURIComponent(ticketId)}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment }),
  });
  await refreshState();
}

export async function updateGrievance(ticketId, patch) {
  const res = await apiRequest(`/api/grievances/${encodeURIComponent(ticketId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (res.ok) await refreshState();
  return res.data;
}

export async function updateServiceApplication(appId, patch) {
  const res = await apiRequest(`/api/services/${encodeURIComponent(appId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (res.ok) await refreshState();
  return res.data;
}

export async function deleteRecord(kind, id) {
  const path = kind === 'grievance' ? `/api/grievances/${id}` : `/api/services/${id}`;
  const res = await apiRequest(path, { method: 'DELETE' });
  if (res.ok) await refreshState();
  return res.data;
}

export async function saveStaff(staffId, payload) {
  const url = staffId ? `/api/staff/${encodeURIComponent(staffId)}` : '/api/staff';
  const method = staffId ? 'PUT' : 'POST';
  const res = await apiRequest(url, {
    method,
    body: JSON.stringify(payload),
  });
  if (res.ok) await refreshState();
  return res.data;
}

export async function toggleStaffActive(staffId) {
  const res = await apiRequest(`/api/staff/${encodeURIComponent(staffId)}/toggle`, {
    method: 'POST',
  });
  if (res.ok) await refreshState();
  return res.data;
}

export async function updateSlaLimit(days) {
  const res = await apiRequest('/api/config/sla', {
    method: 'PUT',
    body: JSON.stringify({ slaLimitDays: days }),
  });
  if (res.ok) await refreshState();
  return res.data;
}

export async function resetDemoData() {
  await apiRequest('/api/reset', { method: 'POST' });
  setSessionStaffId(null);
  store.portalMode = 'citizen';
  store.citizenView = 'home';
  window.history.replaceState({}, '', '/');
  await refreshState();
}
