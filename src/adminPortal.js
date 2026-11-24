import {
  ALL_WARDS,
  DEFAULT_ROLE_PERMISSIONS,
  DEPARTMENTS,
  GRIEVANCE_CATEGORIES,
  GRIEVANCE_STATUS_LABELS,
  IMG_ROAD_AFTER,
  IMG_STREETLIGHT_FIXED,
  PRIORITIES,
  SERVICE_CATALOG,
} from './i18n.js';
import {
  ICONS,
  esc,
  formatDateTime,
  formatShortDate,
  getSlaInfo,
  renderPriorityBadge,
  renderSlaBadge,
  renderStatusLabel,
} from './icons.js';
import {
  addGrievanceComment,
  bootstrapClaimSecretary,
  canViewGrievance,
  canViewService,
  changeOwnPassword,
  connectFirebaseGoogle,
  deleteRecord,
  disconnectFirebaseGoogle,
  escalateOverdueGrievances,
  getActivePermissions,
  getCurrentUser,
  loginWithCredentials,
  logoutStaff,
  maintenanceReset,
  notify,
  resetStaffPassword,
  saveStaff,
  store,
  submitGrievance,
  submitServiceApplication,
  toggleStaffActive,
  updateGrievance,
  updateServiceApplication,
  updateSlaLimit,
} from './store.js';

const CANONICAL_GRIEVANCE_STATUSES = Object.keys(GRIEVANCE_STATUS_LABELS);

const GRIEVANCE_TRANSITIONS = {
  SUBMITTED: ['ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'REJECTED'],
  ACKNOWLEDGED: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED', 'REJECTED'],
  ASSIGNED: ['IN_PROGRESS', 'ON_HOLD', 'ESCALATED', 'RESOLVED', 'REJECTED'],
  IN_PROGRESS: ['ON_HOLD', 'ESCALATED', 'RESOLVED', 'REJECTED'],
  ON_HOLD: ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'REJECTED'],
  ESCALATED: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'REJECTED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REJECTED: ['REOPENED'],
  REOPENED: ['ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'REJECTED'],
};

function getAllowedNextStatuses(currentStatus, role) {
  const curr = CANONICAL_GRIEVANCE_STATUSES.includes(currentStatus) ? currentStatus : 'SUBMITTED';
  const nexts = GRIEVANCE_TRANSITIONS[curr] || [];
  const filtered = nexts.filter((st) => {
    if (role === 'CSC_OPERATOR' && ['RESOLVED', 'CLOSED', 'REJECTED'].includes(st)) return false;
    if (role === 'WARD_OFFICER' && ['CLOSED', 'REOPENED'].includes(st)) return false;
    return true;
  });
  return [curr, ...filtered.filter((s) => s !== curr)];
}

const PERM_LIST = [
  { key: 'canApproveCertificates', label: 'Approve Certificates', desc: 'Final digital sign-off authority for citizen service certificates' },
  { key: 'canAssignTickets', label: 'Assign Tickets', desc: 'Route or reassign grievances and applications across staff' },
  { key: 'canVerifyDocuments', label: 'Verify Documents', desc: 'Mark service documents verified or request citizen corrections' },
  { key: 'canManageUsers', label: 'Manage Users & RBAC', desc: 'Create staff accounts, assign wards, and edit role permissions' },
  { key: 'canDeleteRecords', label: 'Delete Records', desc: 'Permanently remove duplicate or invalid records' },
];

function renderLoginScreen() {
  const bootstrap = store.bootstrapRequired;

  return `
    <div class="min-h-[calc(100vh-44px)] bg-[#F8FAFC] flex items-center justify-center px-4 py-10">
      <div class="w-full max-w-[960px] grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div class="lg:col-span-6 p-6 sm:p-8 lg:p-10">
          <div class="flex items-center gap-2.5 text-[#1E3A8A]">
            ${ICONS.landmark('w-6 h-6')}
            <span class="font-display text-lg font-bold">ABC Gram Panchayat</span>
          </div>
          <h1 class="mt-6 font-display text-2xl font-bold text-slate-900">Official Staff & Admin Sign In</h1>
          <p class="mt-1.5 text-sm text-slate-600">Authenticated session access for Panchayat Secretary, Ward Officers, and CSC Front-Desk Operators.</p>
          <div id="admin-login-error" role="alert" aria-live="polite" class="hidden mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>

          <form id="admin-login-form" class="mt-6 space-y-4">
            <div>
              <label for="admin-identifier" class="block text-sm font-medium text-slate-700 mb-1.5">User ID / Official Email</label>
              <input id="admin-identifier" name="identifier" type="text" required autocomplete="username" placeholder="admin_test or secretary@abcpanchayat.gov.in" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
            </div>
            <div>
              <label for="admin-passcode" class="block text-sm font-medium text-slate-700 mb-1.5">Password / Access Passcode</label>
              <input id="admin-passcode" name="passcode" type="password" maxlength="128" required autocomplete="current-password" placeholder="••••••••" class="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
            </div>
            <button type="submit" class="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer">
              ${ICONS.shield('w-4 h-4')}
              <span>Sign In to Admin Workspace</span>
            </button>
          </form>

          <div class="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Protected by C + Python RBAC & Opaque Sessions</span>
            <button type="button" data-portal-switch="citizen" class="text-[#1E3A8A] font-semibold hover:underline cursor-pointer">Return to Citizen Portal</button>
          </div>
        </div>

        <div class="lg:col-span-6 bg-[#F8FAFC] border-t lg:border-t-0 lg:border-l border-slate-200 p-6 sm:p-8 lg:p-10 flex flex-col justify-between">
          ${
            bootstrap
              ? `<div>
                  <span class="inline-block px-2.5 py-1 text-[11px] font-semibold bg-emerald-100 text-emerald-900 rounded-md">First-Run Setup Available</span>
                  <h2 class="mt-3 font-display text-lg font-bold text-slate-900">Claim Panchayat Secretary Account</h2>
                  <p class="mt-1.5 text-xs text-slate-600 leading-relaxed">
                    No Secretary password is configured yet. Set a strong one-time initial password (8+ characters combining letters, digits, or symbols) for User ID <span class="font-mono font-semibold text-slate-900">admin_test</span> (<span class="font-mono text-slate-800">secretary@abcpanchayat.gov.in</span>). Once claimed, this setup locks permanently.
                  </p>
                  <div id="bootstrap-claim-error" role="alert" aria-live="polite" class="hidden mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"></div>
                  <form id="bootstrap-claim-form" class="mt-4 space-y-3">
                    <div>
                      <label for="claim-passcode" class="block text-xs font-semibold text-slate-700 mb-1">Choose Secretary Password *</label>
                      <input id="claim-passcode" name="passcode" type="password" minlength="8" maxlength="128" required placeholder="8+ chars (e.g., letters + digits or _)" class="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg" />
                    </div>
                    <div>
                      <label for="claim-passcode-confirm" class="block text-xs font-semibold text-slate-700 mb-1">Confirm Password *</label>
                      <input id="claim-passcode-confirm" name="confirmPasscode" type="password" minlength="8" maxlength="128" required placeholder="Re-enter password" class="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg" />
                    </div>
                    <button type="submit" class="w-full px-4 py-2.5 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg cursor-pointer">
                      Claim Secretary Role & Sign In
                    </button>
                  </form>
                </div>`
              : `<div>
                  <p class="text-xs font-semibold text-[#1E3A8A]">Credential & Session Policy</p>
                  <h2 class="mt-2 font-display text-lg font-bold text-slate-900">Role-Based Access Control</h2>
                  <ul class="mt-3 space-y-2 text-xs text-slate-600 list-disc pl-4 leading-relaxed">
                    <li>All staff passcodes are hashed server-side using salted scrypt.</li>
                    <li>Sessions use server-issued opaque tokens with 30-minute idle timeout.</li>
                    <li>Repeated failed attempts trigger progressive delays and a 15-minute lockout.</li>
                    <li>Ward Officers and CSC Operators receive credentials from the Panchayat Secretary via Access & Roles.</li>
                  </ul>
                  <div class="mt-5 pt-4 border-t border-slate-200">
                    <p class="text-xs font-semibold text-slate-700 mb-2">Cloud Firestore Identity (Optional)</p>
                    ${
                      store.firebaseUser
                        ? `<div class="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg p-3 text-xs">
                             <span class="truncate text-slate-700">${esc(store.firebaseUser.email || 'Google Connected')}</span>
                             <button type="button" id="btn-fb-signout" class="text-red-700 font-semibold hover:underline cursor-pointer">Disconnect</button>
                           </div>`
                        : `<button type="button" id="btn-fb-signin" class="w-full px-4 py-2 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer">Connect Google Cloud Identity</button>`
                    }
                  </div>
                </div>`
          }
          <p class="mt-6 text-[11px] text-slate-500">Suspended accounts and unauthorized cross-ward actions are audited and blocked.</p>
        </div>
      </div>
    </div>
  `;
}

function renderOverview(user, visibleGrievances, visibleServices) {
  const slaLimit = store.staffDashboard.slaLimitDays || 7;
  const open = visibleGrievances.filter((g) => !['RESOLVED', 'CLOSED', 'REJECTED'].includes(g.status));
  const breached = open.filter((g) => getSlaInfo(g, g.slaLimitDays || slaLimit).isBreached);
  const resolved = visibleGrievances.filter((g) => ['RESOLVED', 'CLOSED'].includes(g.status)).length;
  const rate = visibleGrievances.length > 0 ? Math.round((resolved / visibleGrievances.length) * 100) : 0;
  const pendingSrv = visibleServices.filter((s) => s.status !== 'Approved' && s.status !== 'Rejected');
  const notifications = (store.staffDashboard.notifications || []).slice(0, 6);

  const wardCounts = ALL_WARDS.map((w) => ({
    ward: w,
    count: visibleGrievances.filter((g) => g.ward === w).length,
  }))
    .filter((x) => x.count > 0 || user.assignedWards.includes(x.ward))
    .slice(0, 10);
  const maxWard = Math.max(1, ...wardCounts.map((c) => c.count));

  const catCounts = GRIEVANCE_CATEGORIES.map((c) => ({
    category: c,
    count: visibleGrievances.filter((g) => g.category === c).length,
  }));
  const maxCat = Math.max(1, ...catCounts.map((c) => c.count));

  return `
    <div class="space-y-8">
      <div>
        <h1 class="font-display text-2xl font-bold text-slate-900">Executive Governance Dashboard</h1>
        <p class="text-sm text-slate-600 mt-0.5">
          Scoped view for <strong>${esc(user.name)}</strong> (${esc(user.department)} · ${
    user.assignedWards.length === 15 ? 'All 15 Wards' : `Wards ${user.assignedWards.join(', ')}`
  })
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-white border border-slate-200 rounded-xl p-5">
          <p class="text-xs font-medium text-slate-500">Total Open Grievances</p>
          <p class="mt-2 text-3xl font-bold font-mono tabular-nums text-[#1E3A8A]">${open.length}</p>
          <p class="mt-1 text-xs text-slate-500">Out of ${visibleGrievances.length} authorized tickets</p>
        </div>
        <div class="bg-white border border-slate-200 rounded-xl p-5">
          <p class="text-xs font-medium text-slate-500">Pending Service Approvals</p>
          <p class="mt-2 text-3xl font-bold font-mono tabular-nums text-slate-900">${pendingSrv.length}</p>
          <p class="mt-1 text-xs text-slate-500">Across ${visibleServices.length} visible applications</p>
        </div>
        <div class="border rounded-xl p-5 ${breached.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}">
          <p class="text-xs font-semibold ${breached.length > 0 ? 'text-red-800' : 'text-slate-500'}">SLA Breached Tickets (&gt;${slaLimit}d)</p>
          <p class="mt-2 text-3xl font-bold font-mono tabular-nums ${breached.length > 0 ? 'text-red-700' : 'text-slate-900'}">${breached.length}</p>
          <button type="button" id="btn-inspect-breached" class="mt-1 text-xs font-semibold text-red-700 hover:underline cursor-pointer">Inspect overdue tickets</button>
        </div>
        <div class="bg-white border border-slate-200 rounded-xl p-5">
          <p class="text-xs font-medium text-slate-500">Resolution Rate</p>
          <p class="mt-2 text-3xl font-bold font-mono tabular-nums text-[#059669]">${rate}%</p>
          <p class="mt-1 text-xs text-slate-500">Completed vs total visible</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-white border border-slate-200 rounded-xl p-6">
          <h2 class="font-display text-base font-bold text-slate-900">Ward-wise Grievance Distribution</h2>
          <p class="text-xs text-slate-500 mt-0.5 mb-5">Ticket volume across assigned Panchayat wards</p>
          <div class="space-y-3">
            ${wardCounts
              .map(
                (item) => `
              <div class="flex items-center gap-3 text-xs">
                <span class="w-16 font-mono font-medium text-slate-700 shrink-0">Ward ${item.ward}</span>
                <div class="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div class="h-full bg-[#1E3A8A] rounded-full" style="width:${Math.round((item.count / maxWard) * 100)}%"></div>
                </div>
                <span class="w-8 text-right font-mono font-semibold tabular-nums text-slate-900">${item.count}</span>
              </div>`
              )
              .join('')}
          </div>
        </div>

        <div class="bg-white border border-slate-200 rounded-xl p-6">
          <h2 class="font-display text-base font-bold text-slate-900">Category-wise Civic Workload</h2>
          <p class="text-xs text-slate-500 mt-0.5 mb-5">Breakdown by infrastructure & public health sector</p>
          <div class="space-y-3.5">
            ${catCounts
              .map(
                (item) => `
              <div class="space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-medium text-slate-700">${esc(item.category)}</span>
                  <span class="font-mono font-semibold tabular-nums text-slate-900">${item.count}</span>
                </div>
                <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div class="h-full bg-[#059669] rounded-full" style="width:${Math.round((item.count / maxCat) * 100)}%"></div>
                </div>
              </div>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="font-display text-base font-bold text-slate-900">Grievance SLA Policy Threshold (C Engine)</h2>
          <p class="text-xs text-slate-600 mt-1">Default baseline ${slaLimit} working days (adjusted by category &amp; priority; Sundays and holidays excluded; <code class="font-mono">ON_HOLD</code> pauses SLA).</p>
        </div>
        ${
          user.role === 'SUPER_ADMIN'
            ? `<form id="sla-config-form" class="flex items-center gap-2 shrink-0">
                <label for="sla-days-input" class="text-xs font-medium text-slate-600">Days:</label>
                <input id="sla-days-input" type="number" min="1" max="30" value="${slaLimit}" class="w-20 px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg" />
                <button type="submit" class="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">Save SLA</button>
              </form>`
            : `<span class="text-xs text-slate-500 font-mono">Managed by Panchayat Secretary</span>`
        }
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-white border border-slate-200 rounded-xl p-6">
          <h2 class="font-display text-base font-bold text-slate-900">Recent Assignment & Escalation Alerts</h2>
          <p class="text-xs text-slate-500 mt-0.5 mb-4">In-app notifications routed to your account</p>
          ${
            notifications.length === 0
              ? `<p class="text-xs text-slate-500">No recent notifications.</p>`
              : `<div class="space-y-2.5">
                  ${notifications
                    .map(
                      (n) => `
                    <div class="p-3 rounded-lg bg-[#F8FAFC] border border-slate-200 text-xs">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-mono font-semibold text-[#1E3A8A]">${esc(n.targetId)}</span>
                        <span class="font-mono text-slate-500">${esc(formatDateTime(n.createdAt))}</span>
                      </div>
                      <p class="text-slate-700 mt-1">${esc(n.message)}</p>
                    </div>`
                    )
                    .join('')}
                </div>`
          }
        </div>

        <div class="bg-white border border-slate-200 rounded-xl p-6">
          <h2 class="font-display text-base font-bold text-slate-900">Account Security · Change My Password</h2>
          <p class="text-xs text-slate-500 mt-0.5 mb-4">Updating your password automatically revokes all other active sessions.</p>
          <div id="self-pw-msg" role="alert" aria-live="polite" class="hidden mb-3 p-2.5 rounded-lg text-xs"></div>
          <form id="self-password-form" class="space-y-3">
            <div>
              <label for="self-curr-pw" class="block text-xs font-medium text-slate-700 mb-1">Current Password *</label>
              <input id="self-curr-pw" name="currentPassword" type="password" required autocomplete="current-password" class="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label for="self-new-pw" class="block text-xs font-medium text-slate-700 mb-1">New Password (8+ chars, 2+ char classes) *</label>
              <input id="self-new-pw" name="newPassword" type="password" minlength="8" maxlength="128" required autocomplete="new-password" class="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
            <button type="submit" class="px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">Update My Password</button>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderGrievancesDesk(user, visibleGrievances) {
  const f = store.adminFilters;
  const slaLimit = store.staffDashboard.slaLimitDays || 7;
  const filtered = visibleGrievances.filter((g) => {
    if (f.status !== 'ALL' && g.status !== f.status) return false;
    if (f.ward !== 'ALL' && g.ward !== Number(f.ward)) return false;
    if (f.category !== 'ALL' && g.category !== f.category) return false;
    if (f.priority !== 'ALL' && (g.priority || 'NORMAL') !== f.priority) return false;
    if (f.slaOverdueOnly && !getSlaInfo(g, g.slaLimitDays || slaLimit).isBreached) return false;
    if (f.search.trim()) {
      const hay = `${g.id} ${g.citizenName} ${g.landmark} ${g.description}`.toLowerCase();
      if (!hay.includes(f.search.trim().toLowerCase())) return false;
    }
    return true;
  });

  return `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-bold text-slate-900">Grievance Redressal Desk</h1>
          <p class="text-sm text-slate-600 mt-0.5">Showing ${filtered.length} of ${visibleGrievances.length} authorized tickets.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          ${
            user.role === 'SUPER_ADMIN'
              ? `<button type="button" id="btn-escalate-overdue" class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg cursor-pointer">${ICONS.triangleAlert('w-3.5 h-3.5')}<span>Escalate Overdue Tickets</span></button>`
              : ''
          }
          ${
            user.role === 'CSC_OPERATOR' || user.role === 'SUPER_ADMIN'
              ? `<button type="button" data-open-walkin="grievance" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">${ICONS.plus('w-4 h-4')}<span>Register Walk-in Grievance</span></button>`
              : ''
          }
        </div>
      </div>

      <div id="desk-action-msg" role="status" aria-live="polite" class="hidden p-3 rounded-lg text-xs"></div>

      <div class="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div class="relative lg:col-span-2">
          <span class="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">${ICONS.search('w-4 h-4')}</span>
          <input id="admin-search-input" type="text" value="${esc(f.search)}" placeholder="Search Tracking ID, citizen, landmark..." class="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg" />
        </div>
        <select id="admin-status-filter" class="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="ALL">All Statuses</option>
          ${CANONICAL_GRIEVANCE_STATUSES
            .map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${esc(GRIEVANCE_STATUS_LABELS[s] || s)}</option>`)
            .join('')}
        </select>
        <select id="admin-ward-filter" class="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="ALL">All Wards</option>
          ${ALL_WARDS.map((w) => `<option value="${w}" ${Number(f.ward) === w ? 'selected' : ''}>Ward ${w}</option>`).join('')}
        </select>
        <select id="admin-cat-filter" class="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="ALL">All Categories</option>
          ${GRIEVANCE_CATEGORIES.map((c) => `<option value="${esc(c)}" ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <select id="admin-priority-filter" class="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="ALL">All Priorities</option>
          ${PRIORITIES.map((p) => `<option value="${p}" ${f.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>

        <div class="sm:col-span-2 lg:col-span-6 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <label class="inline-flex items-center gap-2 text-xs font-semibold text-red-700 cursor-pointer">
            <input id="admin-sla-overdue" type="checkbox" ${f.slaOverdueOnly ? 'checked' : ''} class="w-4 h-4 rounded border-red-300 text-red-600" />
            <span>Show SLA Overdue Tickets Only</span>
          </label>
          <button type="button" id="btn-clear-admin-filters" class="text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer">Clear filters</button>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
        ${
          filtered.length === 0
            ? `<div class="p-10 text-center text-sm text-slate-600">No grievances match the current filters or ward jurisdiction.</div>`
            : `<div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr class="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th class="py-3 px-4">Tracking ID</th>
                      <th class="py-3 px-4">Citizen & Location</th>
                      <th class="py-3 px-4">Category & Priority</th>
                      <th class="py-3 px-4">Assigned Officer</th>
                      <th class="py-3 px-4">SLA</th>
                      <th class="py-3 px-4">Status</th>
                      <th class="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-200">
                    ${filtered
                      .map(
                        (t) => `
                      <tr data-open-grv="${esc(t.id)}" class="hover:bg-slate-50 cursor-pointer">
                        <td class="py-3 px-4">
                          <span class="font-mono text-xs font-bold text-[#1E3A8A]">${esc(t.id)}</span>
                          <p class="text-[11px] font-mono tabular-nums text-slate-500">${esc(formatShortDate(t.createdAt))}</p>
                        </td>
                        <td class="py-3 px-4 max-w-[260px]">
                          <p class="font-medium text-slate-900 truncate">${esc(t.citizenName)} · Ward ${t.ward}</p>
                          <p class="text-xs text-slate-500 truncate">${esc(t.landmark)}</p>
                        </td>
                        <td class="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                          <p>${esc(t.category)}</p>
                          <div class="mt-1">${renderPriorityBadge(t.priority)}</div>
                        </td>
                        <td class="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">${esc(t.assignedOfficerName || 'Unassigned')}</td>
                        <td class="py-3 px-4">${renderSlaBadge(t, t.slaLimitDays || slaLimit)}</td>
                        <td class="py-3 px-4">${renderStatusLabel(t.status)}</td>
                        <td class="py-3 px-4 text-right">
                          <button type="button" data-open-grv="${esc(t.id)}" class="px-3 py-1.5 text-xs font-semibold text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-md cursor-pointer">Manage</button>
                        </td>
                      </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    </div>
  `;
}

function renderServicesDesk(user, visibleServices) {
  const f = store.adminFilters;
  const filtered = visibleServices.filter((s) => {
    if (f.status !== 'ALL' && s.status !== f.status) return false;
    if (f.ward !== 'ALL' && s.ward !== Number(f.ward)) return false;
    if (f.search.trim()) {
      const hay = `${s.id} ${s.applicantName} ${s.serviceName} ${s.address}`.toLowerCase();
      if (!hay.includes(f.search.trim().toLowerCase())) return false;
    }
    return true;
  });

  return `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-bold text-slate-900">Citizen E-Service & Certificate Desk</h1>
          <p class="text-sm text-slate-600 mt-0.5">Verify citizen documents and issue statutory approvals (${filtered.length} visible).</p>
        </div>
        ${
          user.role === 'CSC_OPERATOR' || user.role === 'SUPER_ADMIN'
            ? `<button type="button" data-open-walkin="service" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg cursor-pointer">${ICONS.plus('w-4 h-4')}<span>Register Walk-in Service</span></button>`
            : ''
        }
      </div>

      <div class="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="relative">
          <span class="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">${ICONS.search('w-4 h-4')}</span>
          <input id="admin-search-input" type="text" value="${esc(f.search)}" placeholder="Search ID, applicant, certificate..." class="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg" />
        </div>
        <select id="admin-status-filter" class="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="ALL">All Stages</option>
          ${['Submitted', 'Pending Verification', 'Documents Verified', 'Correction Needed', 'Approved', 'Rejected']
            .map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
        <select id="admin-ward-filter" class="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="ALL">All Wards</option>
          ${ALL_WARDS.map((w) => `<option value="${w}" ${Number(f.ward) === w ? 'selected' : ''}>Ward ${w}</option>`).join('')}
        </select>
      </div>

      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
        ${
          filtered.length === 0
            ? `<div class="p-10 text-center text-sm text-slate-600">No service applications match your current scope or filter.</div>`
            : `<div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr class="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th class="py-3 px-4">Application ID</th>
                      <th class="py-3 px-4">Service</th>
                      <th class="py-3 px-4">Applicant & Ward</th>
                      <th class="py-3 px-4">Fee</th>
                      <th class="py-3 px-4">Status</th>
                      <th class="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-200">
                    ${filtered
                      .map(
                        (a) => `
                      <tr data-open-srv="${esc(a.id)}" class="hover:bg-slate-50 cursor-pointer">
                        <td class="py-3 px-4">
                          <span class="font-mono text-xs font-bold text-[#1E3A8A]">${esc(a.id)}</span>
                          <p class="text-[11px] font-mono tabular-nums text-slate-500">${esc(formatShortDate(a.createdAt))}</p>
                        </td>
                        <td class="py-3 px-4">
                          <p class="font-medium text-slate-900">${esc(a.serviceName)}</p>
                          <p class="text-xs text-slate-500">${esc(a.department)}</p>
                        </td>
                        <td class="py-3 px-4">
                          <p class="font-medium text-slate-900">${esc(a.applicantName)} · Ward ${a.ward}</p>
                          <p class="text-xs text-slate-500 truncate max-w-[240px]">${esc(a.address)}</p>
                        </td>
                        <td class="py-3 px-4 font-mono text-xs tabular-nums text-slate-700">${a.feeInr === 0 ? 'Free' : `₹${a.feeInr}`}</td>
                        <td class="py-3 px-4">${renderStatusLabel(a.status)}</td>
                        <td class="py-3 px-4 text-right">
                          <button type="button" data-open-srv="${esc(a.id)}" class="px-3 py-1.5 text-xs font-semibold text-[#059669] bg-emerald-50 hover:bg-emerald-100 rounded-md cursor-pointer">Review</button>
                        </td>
                      </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    </div>
  `;
}

function renderAccessControl(user, perms) {
  if (!perms.canManageUsers) {
    return `
      <div class="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto mt-8">
        <div class="text-red-600 flex justify-center mb-3">${ICONS.shield('w-10 h-10')}</div>
        <h2 class="font-display text-xl font-bold text-slate-900">Access Control Restricted</h2>
        <p class="mt-2 text-sm text-slate-600">Your current role (${esc(user.designation)}) does not have <code class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">canManageUsers</code> permission.</p>
      </div>`;
  }

  const staffList = store.staffDashboard.staff || [];
  return `
    <div class="space-y-8">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-bold text-slate-900">Access & Role Management</h1>
          <p class="text-sm text-slate-600 mt-0.5">Configure Panchayat staff accounts, ward jurisdiction (Ward 1–15), and granular RBAC permissions.</p>
        </div>
        <button type="button" id="btn-create-staff" class="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg whitespace-nowrap shrink-0 cursor-pointer">${ICONS.plus('w-4 h-4')}<span>Create Staff Role</span></button>
      </div>

      <div id="access-banner-error" role="alert" aria-live="polite" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>

      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="font-display text-base font-bold text-slate-900">Staff Directory (${staffList.length})</h2>
          <span class="text-xs text-slate-500">Salted scrypt credentials · C RBAC Enforced</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th class="py-3 px-4">Staff Member</th>
                <th class="py-3 px-4">Role & Designation</th>
                <th class="py-3 px-4">Department</th>
                <th class="py-3 px-4">Assigned Wards</th>
                <th class="py-3 px-4">Account State</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${staffList
                .map(
                  (s) => `
                <tr class="hover:bg-slate-50/70">
                  <td class="py-3.5 px-4">
                    <p class="font-semibold text-slate-900">${esc(s.name)} ${s.username ? `<span class="ml-1 text-[11px] font-mono text-[#1E3A8A] bg-indigo-50 px-1.5 py-0.5 rounded">${esc(s.username)}</span>` : ''}</p>
                    <p class="text-xs font-mono text-slate-500">${esc(s.email)}</p>
                  </td>
                  <td class="py-3.5 px-4">
                    <p class="font-medium text-slate-900">${esc(s.designation)}</p>
                    <p class="text-xs font-mono text-[#1E3A8A]">${esc(s.role)}</p>
                  </td>
                  <td class="py-3.5 px-4 text-slate-700">${esc(s.department)}</td>
                  <td class="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-700">${
                    (s.assignedWards || []).length === 15 ? 'All Wards (1–15)' : `Wards ${(s.assignedWards || []).join(', ')}`
                  }</td>
                  <td class="py-3.5 px-4">
                    <button type="button" data-toggle-staff="${esc(s.id)}" class="px-2.5 py-1 text-xs font-medium rounded-md border cursor-pointer ${
                    s.isActive
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                  }">${s.isActive ? 'Active' : 'Suspended'}</button>
                  </td>
                  <td class="py-3.5 px-4 text-right">
                    <button type="button" data-edit-staff="${esc(s.id)}" class="px-3 py-1.5 text-xs font-semibold text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-md cursor-pointer">Edit Role / Passcode</button>
                  </td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-200">
          <h2 class="font-display text-base font-bold text-slate-900">Live RBAC Permission Matrix</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="bg-[#F8FAFC] border-b border-slate-200 text-slate-600 font-semibold">
                <th class="py-3 px-4">Staff / Role</th>
                ${PERM_LIST.map((p) => `<th class="py-3 px-4 text-center whitespace-nowrap">${esc(p.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${staffList
                .map(
                  (s) => `
                <tr class="${!s.isActive ? 'opacity-50' : ''}">
                  <td class="py-3 px-4"><span class="font-semibold text-slate-900">${esc(s.name)}</span> · <span class="font-mono text-slate-500">${esc(s.role)}</span></td>
                  ${PERM_LIST.map((p) =>
                    s.permissions?.[p.key]
                      ? `<td class="py-3 px-4 text-center"><span class="inline-flex items-center justify-center w-6 h-6 rounded bg-emerald-50 text-[#059669] border border-emerald-200">${ICONS.check('w-3.5 h-3.5')}</span></td>`
                      : `<td class="py-3 px-4 text-center"><span class="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-50 text-slate-400 border border-slate-200">${ICONS.lock('w-3 h-3')}</span></td>`
                  ).join('')}
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="bg-white border border-red-200 rounded-xl p-6">
        <h2 class="font-display text-base font-bold text-red-900">Authorized Non-Production Maintenance Reset</h2>
        <p class="text-xs text-slate-600 mt-1">Re-initializes non-production seed records under Panchayat Secretary authorization and records an immutable audit event.</p>
        <div id="maint-reset-msg" role="alert" aria-live="polite" class="hidden mt-3 p-2.5 rounded-lg text-xs"></div>
        <form id="maintenance-reset-form" class="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label class="block text-xs font-medium text-slate-700 mb-1">Confirmation Phrase (<code class="font-mono">CONFIRM_PORTAL_RESET</code>)</label>
            <input name="confirmPhrase" type="text" required placeholder="CONFIRM_PORTAL_RESET" class="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-700 mb-1">Maintenance Key (if configured)</label>
            <input name="maintenanceKey" type="password" placeholder="Optional env key" class="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg" />
          </div>
          <button type="submit" class="px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg cursor-pointer">Execute Authorized Reset</button>
        </form>
      </div>
    </div>
  `;
}

function renderAuditLog(user) {
  const q = (store.adminFilters.auditSearch || '').trim().toLowerCase();
  const logs = (store.staffDashboard.auditLogs || []).filter((l) =>
    !q ? true : `${l.actorName} ${l.action} ${l.targetId} ${l.details}`.toLowerCase().includes(q)
  );
  const alerts = store.staffDashboard.securityAlerts || [];

  return `
    <div class="space-y-8">
      ${
        user.role === 'SUPER_ADMIN'
          ? `<div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 class="font-display text-base font-bold text-slate-900">Security Event Monitor (${alerts.length})</h2>
                  <p class="text-xs text-slate-500 mt-0.5">Append-only monitoring for lockouts, rate limits, and unauthorized access attempts.</p>
                </div>
              </div>
              ${
                alerts.length === 0
                  ? `<p class="p-6 text-xs text-slate-500">No security alerts recorded.</p>`
                  : `<div class="overflow-x-auto">
                      <table class="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr class="bg-[#F8FAFC] border-b border-slate-200 text-slate-600 font-semibold">
                            <th class="py-2.5 px-4">Timestamp</th>
                            <th class="py-2.5 px-4">Severity</th>
                            <th class="py-2.5 px-4">Event</th>
                            <th class="py-2.5 px-4">Target / Actor</th>
                            <th class="py-2.5 px-4">Details</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                          ${alerts
                            .slice(0, 20)
                            .map(
                              (al) => `
                            <tr>
                              <td class="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">${esc(formatDateTime(al.timestamp))}</td>
                              <td class="py-2.5 px-4 font-mono font-bold ${al.severity === 'CRITICAL' || al.severity === 'HIGH' ? 'text-red-700' : 'text-amber-700'}">${esc(al.severity)}</td>
                              <td class="py-2.5 px-4 font-mono text-slate-800 whitespace-nowrap">${esc(al.eventType)}</td>
                              <td class="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">${esc(al.actorHint)}</td>
                              <td class="py-2.5 px-4 text-slate-700">${esc(al.details)}</td>
                            </tr>`
                            )
                            .join('')}
                        </tbody>
                      </table>
                    </div>`
              }
            </div>`
          : ''
      }

      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="font-display text-2xl font-bold text-slate-900">Immutable System Audit Log</h1>
            <p class="text-sm text-slate-600 mt-0.5">
              Append-only database triggers prevent modification or deletion of audit history.
              ${store.staffDashboard.auditRetention ? `<span class="font-mono text-xs text-[#059669]">(${store.staffDashboard.auditRetention.totalRecords} records · ${store.staffDashboard.auditRetention.retentionDays}d retention)</span>` : ''}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2.5">
            ${
              user.role === 'SUPER_ADMIN'
                ? `<a href="/api/staff/audit/export?format=csv" download="panchayat_audit_logs.csv" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg">${ICONS.download('w-3.5 h-3.5')}<span>Export CSV</span></a>
                   <a href="/api/staff/audit/export?format=json" download="panchayat_audit_logs.json" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg">${ICONS.download('w-3.5 h-3.5')}<span>Export JSON</span></a>`
                : ''
            }
            <div class="relative w-full sm:w-64">
              <span class="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">${ICONS.search('w-4 h-4')}</span>
              <input id="audit-search-input" type="text" value="${esc(store.adminFilters.auditSearch)}" placeholder="Filter audit log..." class="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg" />
            </div>
          </div>
        </div>
        <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm">
              <thead>
                <tr class="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th class="py-3 px-4">Timestamp</th>
                  <th class="py-3 px-4">Actor & Session</th>
                  <th class="py-3 px-4">Action</th>
                  <th class="py-3 px-4">Target</th>
                  <th class="py-3 px-4">Event Details</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${logs
                  .map(
                    (l) => `
                  <tr class="hover:bg-slate-50/70">
                    <td class="py-3 px-4 font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">${esc(formatDateTime(l.timestamp))}</td>
                    <td class="py-3 px-4 whitespace-nowrap"><span class="font-medium text-slate-900">${esc(l.actorName)}</span> · <span class="font-mono text-xs text-slate-500">${esc(l.actorRole)} (${esc(l.sessionPrefix || 'sys')})</span></td>
                    <td class="py-3 px-4 font-mono text-xs font-semibold text-[#1E3A8A] whitespace-nowrap">${esc(l.action)}</td>
                    <td class="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">${esc(l.targetId)}</td>
                    <td class="py-3 px-4 text-xs text-slate-700">${esc(l.details)}</td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDetailDrawer(user, perms) {
  const grv = store.selectedGrievanceId
    ? (store.staffDashboard.grievances || []).find((g) => g.id === store.selectedGrievanceId)
    : null;
  const srv = store.selectedServiceId
    ? (store.staffDashboard.services || []).find((s) => s.id === store.selectedServiceId)
    : null;
  const record = grv || srv;
  if (!record) return '';

  const isGrv = Boolean(grv);
  const canAssign = perms.canAssignTickets || user.role === 'SUPER_ADMIN';
  const activeOfficers = (store.staffDashboard.staff || []).filter((s) => s.isActive);

  return `
    <div class="fixed inset-0 z-50 bg-slate-950/50 flex justify-end" role="dialog" aria-modal="true">
      <div class="w-full max-w-2xl bg-white h-full overflow-y-auto border-l border-slate-200 flex flex-col">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 sticky top-0 bg-white z-10">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm font-bold text-[#1E3A8A]">${esc(record.id)}</span>
              <span class="text-xs text-slate-400">·</span>
              <span class="text-xs font-medium text-slate-600">Ward ${record.ward} · ${esc(record.department)}</span>
            </div>
            <h2 class="font-display text-lg font-bold text-slate-900 mt-0.5">
              ${isGrv ? `${esc(record.category)} — ${esc(record.landmark)}` : esc(record.serviceName)}
            </h2>
          </div>
          <button type="button" id="btn-close-detail-drawer" class="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer">${ICONS.x('w-5 h-5')}</button>
        </div>

        <div class="p-6 space-y-6 flex-1">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              ${renderStatusLabel(record.status)}
              ${isGrv ? renderPriorityBadge(record.priority) : ''}
              ${isGrv && record.escalationLevel > 0 ? `<span class="px-2 py-0.5 text-[11px] font-mono font-semibold bg-red-50 text-red-800 border border-red-200 rounded">L${record.escalationLevel} Escalated</span>` : ''}
            </div>
            ${renderSlaBadge(record, record.slaLimitDays || store.staffDashboard.slaLimitDays)}
          </div>
          <div id="drawer-msg-box" role="alert" aria-live="polite" class="hidden p-3 rounded-lg text-sm"></div>

          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 text-sm">
            <div><dt class="text-xs text-slate-500">${isGrv ? 'Citizen Name' : 'Applicant Name'}</dt><dd class="font-semibold text-slate-900 mt-0.5">${esc(isGrv ? record.citizenName : record.applicantName)}</dd></div>
            <div><dt class="text-xs text-slate-500">Contact Number</dt><dd class="font-mono tabular-nums text-slate-900 mt-0.5">${esc(record.mobile)}</dd></div>
            <div><dt class="text-xs text-slate-500">Filed On</dt><dd class="font-mono tabular-nums text-slate-700 mt-0.5">${esc(formatDateTime(record.createdAt))}</dd></div>
            <div><dt class="text-xs text-slate-500">Current Assignee</dt><dd class="font-medium text-slate-900 mt-0.5">${esc(record.assignedOfficerName || 'Unassigned')}</dd></div>
            <div class="sm:col-span-2"><dt class="text-xs text-slate-500">${isGrv ? 'Description' : 'Address & Verified Docs'}</dt><dd class="text-slate-800 mt-0.5">${esc(isGrv ? record.description : `${record.address} · ${(record.checkedDocs || []).join(', ')}`)}</dd></div>
          </dl>

          ${
            isGrv
              ? `<form id="drawer-grv-form" data-id="${esc(record.id)}" class="space-y-4">
                  ${
                    record.beforePhotoUrl
                      ? `<div><p class="text-xs font-semibold text-slate-600 mb-1.5">Citizen Evidence Photo</p><img src="${esc(record.beforePhotoUrl)}" alt="Evidence" referrerpolicy="no-referrer" class="w-full max-h-52 object-cover rounded-lg border border-slate-200" /></div>`
                      : ''
                  }
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label class="block text-xs font-semibold text-slate-700 mb-1.5">Workflow Status</label>
                      <select name="status" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                        ${getAllowedNextStatuses(record.status, user.role)
                          .map((st) => `<option value="${st}" ${record.status === st ? 'selected' : ''}>${esc(GRIEVANCE_STATUS_LABELS[st] || st)}</option>`)
                          .join('')}
                      </select>
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-700 mb-1.5">Priority</label>
                      <select name="priority" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                        ${PRIORITIES.map((p) => `<option value="${p}" ${(record.priority || 'NORMAL') === p ? 'selected' : ''}>${p}</option>`).join('')}
                      </select>
                    </div>
                    <div>
                      <label class="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
                        <span>Assign Officer</span>
                        ${!canAssign ? `<span class="text-[11px] text-amber-700">Restricted</span>` : ''}
                      </label>
                      <select name="assignedOfficerId" ${!canAssign ? 'disabled' : ''} class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100">
                        <option value="">-- Unassigned --</option>
                        ${activeOfficers
                          .map(
                            (o) =>
                              `<option value="${esc(o.id)}" ${record.assignedOfficerId === o.id ? 'selected' : ''}>${esc(o.name)} (${esc(o.department)})</option>`
                          )
                          .join('')}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1">Official Public Remark</label>
                    <p class="text-[11px] text-slate-500 mb-1.5">Minimum 5 characters mandatory when moving to On Hold, Escalated, Resolved, or Rejected.</p>
                    <textarea name="publicRemark" rows="2" maxlength="1000" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg">${esc(record.publicRemark || '')}</textarea>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1.5">Internal Staff Note (Staff Only)</label>
                    <input name="internalRemark" type="text" maxlength="1000" value="${esc(record.internalRemark || '')}" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
                  </div>
                  <div>
                    <p class="text-xs font-semibold text-slate-700 mb-1.5">Resolution Proof Image</p>
                    <input id="drawer-after-photo-url" name="afterPhotoUrl" type="hidden" value="${esc(record.afterPhotoUrl || '')}" />
                    <div class="flex flex-wrap items-center gap-2">
                      <button type="button" data-attach-proof="${IMG_ROAD_AFTER}" class="px-2.5 py-1.5 text-xs font-medium text-[#059669] bg-emerald-50 hover:bg-emerald-100 rounded-lg cursor-pointer">Attach Sample Road Proof</button>
                      <button type="button" data-attach-proof="${IMG_STREETLIGHT_FIXED}" class="px-2.5 py-1.5 text-xs font-medium text-[#059669] bg-emerald-50 hover:bg-emerald-100 rounded-lg cursor-pointer">Attach Sample Streetlight Proof</button>
                    </div>
                    ${
                      record.afterPhotoUrl
                        ? `<img id="drawer-proof-preview" src="${esc(record.afterPhotoUrl)}" alt="Proof" referrerpolicy="no-referrer" class="mt-2.5 w-52 h-32 object-cover rounded-lg border border-emerald-200" />`
                        : `<img id="drawer-proof-preview" src="" alt="" class="hidden mt-2.5 w-52 h-32 object-cover rounded-lg border border-emerald-200" />`
                    }
                  </div>
                  <div class="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                    ${
                      perms.canDeleteRecords
                        ? `<button type="button" id="btn-delete-record" data-del-kind="grievance" data-del-id="${esc(record.id)}" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer">${ICONS.trash('w-3.5 h-3.5')}<span>Delete Ticket</span></button>`
                        : `<span class="text-xs text-slate-400">Delete restricted to Super Admin</span>`
                    }
                    <button type="submit" ${store.isSubmitting ? 'disabled' : ''} class="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] disabled:opacity-60 rounded-lg cursor-pointer">Save Ticket Update</button>
                  </div>
                </form>

                <div class="pt-4 border-t border-slate-200 space-y-3">
                  <h3 class="text-xs font-semibold text-slate-700">Case Notes &amp; Comments (${(record.comments || []).length})</h3>
                  <div id="comment-msg-box" aria-live="polite" class="hidden p-2.5 rounded-lg text-xs"></div>
                  ${
                    (record.comments || []).length > 0
                      ? `<div class="space-y-2">
                          ${(record.comments || [])
                            .map(
                              (c) => `
                            <div class="p-2.5 rounded-lg border text-xs ${c.isInternal ? 'bg-amber-50 border-amber-200' : 'bg-[#F8FAFC] border-slate-200'}">
                              <div class="flex items-center justify-between gap-2">
                                <span class="font-semibold text-slate-900">${esc(c.authorName)} ${c.isInternal ? '<span class="ml-1 px-1.5 py-0.5 text-[10px] font-mono bg-amber-200 text-amber-900 rounded">Internal</span>' : ''}</span>
                                <span class="font-mono text-slate-500">${esc(formatDateTime(c.createdAt))}</span>
                              </div>
                              <p class="text-slate-800 mt-1">${esc(c.body)}</p>
                            </div>`
                            )
                            .join('')}
                        </div>`
                      : `<p class="text-xs text-slate-500">No comments added yet.</p>`
                  }
                  <form id="drawer-comment-form" data-id="${esc(record.id)}" class="space-y-2">
                    <textarea name="body" rows="2" minlength="2" maxlength="1000" required placeholder="Add an official update or internal note..." class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"></textarea>
                    <div class="flex items-center justify-between gap-2">
                      <label class="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                        <input type="checkbox" name="isInternal" class="w-3.5 h-3.5 rounded border-slate-300 text-[#1E3A8A]" />
                        <span>Internal Staff Note Only</span>
                      </label>
                      <button type="submit" class="px-3.5 py-1.5 text-xs font-semibold text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer">Add Comment</button>
                    </div>
                  </form>
                </div>`
              : `<form id="drawer-srv-form" data-id="${esc(record.id)}" class="space-y-4">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-semibold text-slate-700 mb-1.5">Verification & Approval Stage</label>
                      <select name="status" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                        ${['Submitted', 'Pending Verification', 'Documents Verified', 'Correction Needed', 'Approved', 'Rejected']
                          .map((st) => {
                            const approveBlocked = st === 'Approved' && !perms.canApproveCertificates;
                            const verifyBlocked =
                              (st === 'Documents Verified' || st === 'Correction Needed') &&
                              !perms.canVerifyDocuments &&
                              user.role !== 'SUPER_ADMIN';
                            return `<option value="${st}" ${record.status === st ? 'selected' : ''} ${approveBlocked || verifyBlocked ? 'disabled' : ''}>${st}${approveBlocked ? ' (Requires Approval Authority)' : ''}</option>`;
                          })
                          .join('')}
                      </select>
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-700 mb-1.5">Assigned Officer</label>
                      <select name="assignedOfficerId" ${!canAssign ? 'disabled' : ''} class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100">
                        <option value="">-- Unassigned --</option>
                        ${activeOfficers
                          .map(
                            (o) =>
                              `<option value="${esc(o.id)}" ${record.assignedOfficerId === o.id ? 'selected' : ''}>${esc(o.name)} (${esc(o.department)})</option>`
                          )
                          .join('')}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1.5">Official Verification / Approval Remark</label>
                    <textarea name="officialRemark" rows="3" maxlength="1000" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg">${esc(record.officialRemark || '')}</textarea>
                  </div>
                  <div class="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                    ${
                      perms.canDeleteRecords
                        ? `<button type="button" id="btn-delete-record" data-del-kind="service" data-del-id="${esc(record.id)}" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer">${ICONS.trash('w-3.5 h-3.5')}<span>Delete Application</span></button>`
                        : `<span class="text-xs text-slate-400">Delete restricted to Super Admin</span>`
                    }
                    <button type="submit" class="px-5 py-2 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg cursor-pointer">Save Application Stage</button>
                  </div>
                </form>`
          }

          <div class="pt-4 border-t border-slate-200">
            <h3 class="text-xs font-semibold text-slate-600 mb-3">Action Audit Timeline</h3>
            <div class="space-y-3">
              ${(record.timeline || [])
                .map(
                  (ev) => `
                <div class="p-3 rounded-lg bg-[#F8FAFC] border border-slate-200 text-xs">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-semibold text-slate-900">${esc(ev.stepTitle)}</span>
                    <span class="font-mono tabular-nums text-slate-500">${esc(formatDateTime(ev.timestamp))}</span>
                  </div>
                  <p class="text-slate-600 mt-0.5">${esc(ev.actor)}</p>
                  <p class="text-slate-800 mt-1">${esc(ev.remark)}</p>
                </div>`
                )
                .join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderStaffModal() {
  if (!store.staffModalOpen) return '';
  const editing = store.editingStaffId
    ? (store.staffDashboard.staff || []).find((s) => s.id === store.editingStaffId)
    : null;
  const perms = editing ? editing.permissions : DEFAULT_ROLE_PERMISSIONS.WARD_OFFICER;
  const wards = store.staffModalWards;

  return `
    <div class="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div class="w-full max-w-2xl bg-white border border-slate-200 rounded-xl max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h3 class="font-display text-lg font-bold text-slate-900">${
            editing ? `Edit Staff Role: ${esc(editing.name)}` : 'Create New Staff Role'
          }</h3>
          <button type="button" id="btn-close-staff-modal" class="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer">${ICONS.x('w-5 h-5')}</button>
        </div>

        <form id="staff-role-form" class="p-6 space-y-5">
          <div id="staff-modal-error" role="alert" aria-live="polite" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label><input name="name" type="text" required value="${esc(editing?.name || '')}" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">User ID (Username)</label><input name="username" type="text" minlength="3" maxlength="48" placeholder="e.g. ward_officer_1" value="${esc(editing?.username || '')}" class="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" /></div>
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Official Email *</label><input name="email" type="email" required value="${esc(editing?.email || '')}" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Designation *</label><input name="designation" type="text" required value="${esc(editing?.designation || 'Ward Field Officer')}" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
            <div class="sm:col-span-2"><label class="block text-xs font-semibold text-slate-700 mb-1">${editing ? 'New Password / Passcode (leave blank to keep)' : 'Initial Password / Passcode (8+ chars) *'}</label><input name="passcode" type="password" ${editing ? '' : 'required minlength="8"'} maxlength="128" placeholder="${editing ? '•••••••• (unchanged)' : 'Set strong password'}" class="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" /></div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">RBAC Role</label>
              <select name="role" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="SUPER_ADMIN" ${editing?.role === 'SUPER_ADMIN' ? 'selected' : ''}>Super Admin (Secretary)</option>
                <option value="WARD_OFFICER" ${!editing || editing.role === 'WARD_OFFICER' ? 'selected' : ''}>Department / Ward Officer</option>
                <option value="CSC_OPERATOR" ${editing?.role === 'CSC_OPERATOR' ? 'selected' : ''}>CSC / Front-Desk Operator</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">Assigned Department</label>
              <select name="department" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                ${DEPARTMENTS.map((d) => `<option value="${esc(d)}" ${editing?.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-semibold text-slate-700">Assigned Wards (${wards.length} of 15 selected)</label>
              <div class="flex items-center gap-2 text-xs">
                <button type="button" id="btn-wards-all" class="text-[#1E3A8A] font-medium hover:underline cursor-pointer">Select All</button>
                <span class="text-slate-300">|</span>
                <button type="button" id="btn-wards-clear" class="text-slate-600 hover:underline cursor-pointer">Clear</button>
              </div>
            </div>
            <div class="grid grid-cols-5 sm:grid-cols-8 gap-2">
              ${ALL_WARDS.map((w) => {
                const sel = wards.includes(w);
                return `<button type="button" data-toggle-ward="${w}" class="py-1.5 text-xs font-mono rounded-md border cursor-pointer ${
                  sel ? 'bg-[#1E3A8A] text-white border-[#1E3A8A] font-semibold' : 'bg-white text-slate-700 border-slate-300'
                }">W${w}</button>`;
              }).join('')}
            </div>
          </div>

          <div class="bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 space-y-2.5">
            <p class="text-xs font-semibold text-slate-900">Granular RBAC Permission Flags</p>
            ${PERM_LIST.map(
              (p) => `
              <label class="flex items-start gap-2.5 text-sm cursor-pointer">
                <input type="checkbox" name="perm_${p.key}" ${perms[p.key] ? 'checked' : ''} class="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#1E3A8A]" />
                <div>
                  <p class="font-medium text-slate-900 text-xs">${esc(p.label)}</p>
                  <p class="text-[11px] text-slate-500">${esc(p.desc)}</p>
                </div>
              </label>`
            ).join('')}
          </div>

          <div class="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button type="button" id="btn-close-staff-modal-2" class="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
            <button type="submit" class="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">${editing ? 'Save Role Changes' : 'Create Staff Account'}</button>
          </div>
        </form>
        ${
          editing
            ? `<div class="px-6 pb-6">
                <div class="bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 space-y-3">
                  <p class="text-xs font-semibold text-slate-900">Force Password Reset &amp; Revoke Sessions</p>
                  <div id="staff-reset-pw-msg" role="alert" aria-live="polite" class="hidden p-2.5 rounded-lg text-xs"></div>
                  <form id="staff-reset-pw-form" data-staff-id="${esc(editing.id)}" class="flex flex-wrap items-center gap-2.5">
                    <input name="newPassword" type="password" minlength="8" maxlength="128" required placeholder="New strong password (8+ chars)" class="flex-1 min-w-[200px] px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg" />
                    <button type="submit" class="px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer">Reset Password</button>
                  </form>
                </div>
              </div>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderWalkInModal() {
  if (!store.walkInType) return '';
  const isGrv = store.walkInType === 'grievance';
  return `
    <div class="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div class="w-full max-w-lg bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 class="font-display text-lg font-bold text-slate-900">${isGrv ? 'Register Walk-in Grievance (CSC Desk)' : 'Register Walk-in E-Service (CSC Desk)'}</h3>
          <button type="button" id="btn-close-walkin" class="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer">${ICONS.x('w-5 h-5')}</button>
        </div>
        <form id="walkin-form" class="p-6 space-y-4">
          <div id="walkin-error" role="alert" aria-live="polite" class="hidden p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"></div>
          <div class="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button type="button" data-open-walkin="grievance" class="flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${isGrv ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}">Walk-in Grievance</button>
            <button type="button" data-open-walkin="service" class="flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${!isGrv ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}">Walk-in E-Service</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Citizen Name *</label><input name="name" type="text" maxlength="120" required class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">10-Digit Mobile *</label><input name="mobile" type="tel" maxlength="10" required class="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" /></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Ward *</label><select name="ward" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">${ALL_WARDS.map((w) => `<option value="${w}">Ward ${w}</option>`).join('')}</select></div>
            ${
              isGrv
                ? `<div><label class="block text-xs font-semibold text-slate-700 mb-1">Category *</label><select name="category" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">${GRIEVANCE_CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>`
                : `<div><label class="block text-xs font-semibold text-slate-700 mb-1">Service Type *</label><select name="serviceId" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">${SERVICE_CATALOG.map((s) => `<option value="${esc(s.id)}">${esc(s.titleEn)}</option>`).join('')}</select></div>`
            }
          </div>
          ${
            isGrv
              ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div><label class="block text-xs font-semibold text-slate-700 mb-1">Priority *</label><select name="priority" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">${PRIORITIES.map((p) => `<option value="${p}" ${p === 'NORMAL' ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
                   <div><label class="block text-xs font-semibold text-slate-700 mb-1">Landmark *</label><input name="landmark" type="text" maxlength="200" required class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
                 </div>
                 <div><label class="block text-xs font-semibold text-slate-700 mb-1">Description *</label><textarea name="description" rows="3" maxlength="2000" required class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"></textarea></div>`
              : `<div><label class="block text-xs font-semibold text-slate-700 mb-1">Residential Address *</label><input name="address" type="text" maxlength="300" required class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>`
          }
          <div class="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button type="button" id="btn-close-walkin-2" class="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
            <button type="submit" ${store.isSubmitting ? 'disabled' : ''} class="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] disabled:opacity-60 rounded-lg cursor-pointer">Create Record</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderAdminPortal() {
  const user = getCurrentUser();
  if (!user) return renderLoginScreen();

  const perms = getActivePermissions();
  const visibleGrievances = (store.staffDashboard.grievances || []).filter((g) => canViewGrievance(g));
  const visibleServices = (store.staffDashboard.services || []).filter((s) => canViewService(s));

  const navItems = [
    { key: 'overview', label: 'Executive Overview', icon: ICONS.dashboard('w-4 h-4') },
    { key: 'grievances', label: 'Grievance Desk', icon: ICONS.alert('w-4 h-4') },
    { key: 'services', label: 'Citizen E-Services', icon: ICONS.fileText('w-4 h-4') },
    { key: 'access-control', label: 'Access & Roles', icon: ICONS.shield('w-4 h-4'), restricted: !perms.canManageUsers },
    { key: 'audit-log', label: 'Audit & Security', icon: ICONS.history('w-4 h-4') },
  ];

  const sidebarHtml = `
    <div class="flex flex-col h-full justify-between p-4">
      <div>
        <div class="flex items-center gap-2.5 px-2 py-2">
          <span class="text-[#1E3A8A]">${ICONS.landmark('w-6 h-6')}</span>
          <div class="min-w-0">
            <p class="font-display text-sm font-bold text-[#1E3A8A] truncate">ABC Gram Panchayat</p>
            <p class="text-[11px] text-slate-500 truncate">Administrative Console</p>
          </div>
        </div>
        <nav class="mt-6 space-y-1">
          ${navItems
            .map((item) => {
              const active = store.adminView === item.key;
              return `<button type="button" data-anav="${item.key}" class="w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                active ? 'bg-[#1E3A8A] text-white' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }">
                <span class="flex items-center gap-2.5 truncate">${item.icon}<span class="truncate">${esc(item.label)}</span></span>
                ${item.restricted ? ICONS.lock(`w-3.5 h-3.5 ${active ? 'text-indigo-200' : 'text-slate-400'}`) : ''}
              </button>`;
            })
            .join('')}
        </nav>
      </div>
      <div class="pt-4 border-t border-slate-200 space-y-3">
        <div class="bg-[#F8FAFC] border border-slate-200 rounded-lg p-3">
          <p class="text-xs font-bold text-slate-900 truncate">${esc(user.name)}</p>
          <p class="text-[11px] text-slate-600 truncate">${esc(user.designation)}</p>
          <p class="mt-1.5 text-[11px] font-mono text-[#1E3A8A]">${
            user.assignedWards.length === 15 ? 'All Wards (1–15)' : `Wards: ${user.assignedWards.join(', ')}`
          }</p>
        </div>
        <button type="button" id="btn-admin-logout" class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer">
          ${ICONS.logout('w-3.5 h-3.5')}<span>Sign Out</span>
        </button>
      </div>
    </div>
  `;

  let mainHtml = '';
  if (store.adminView === 'overview') mainHtml = renderOverview(user, visibleGrievances, visibleServices);
  else if (store.adminView === 'grievances') mainHtml = renderGrievancesDesk(user, visibleGrievances);
  else if (store.adminView === 'services') mainHtml = renderServicesDesk(user, visibleServices);
  else if (store.adminView === 'access-control') mainHtml = renderAccessControl(user, perms);
  else mainHtml = renderAuditLog(user);

  return `
    <div class="min-h-[calc(100vh-44px)] bg-[#F8FAFC] flex">
      <aside class="hidden lg:block w-[260px] shrink-0 bg-white border-r border-slate-200">
        <div class="sticky top-0 h-[calc(100vh-44px)]">${sidebarHtml}</div>
      </aside>
      ${
        store.mobileSidebarOpen
          ? `<div class="fixed inset-0 z-40 lg:hidden flex">
              <div id="btn-close-mobile-sidebar" class="fixed inset-0 bg-slate-950/50"></div>
              <aside class="relative w-72 max-w-[85vw] bg-white h-full z-50 border-r border-slate-200">${sidebarHtml}</aside>
            </div>`
          : ''
      }
      <div class="flex-1 min-w-0 flex flex-col">
        <header class="bg-white border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <button type="button" id="btn-open-mobile-sidebar" aria-label="Open sidebar" class="lg:hidden p-2 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">${ICONS.menu('w-4 h-4')}</button>
            <div class="text-xs text-slate-500 flex items-center gap-2 truncate">
              <span class="font-medium text-slate-800">Admin Portal</span>
              <span>/</span>
              <span class="truncate font-semibold text-[#1E3A8A]">${esc(navItems.find((n) => n.key === store.adminView)?.label || '')}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${
              user.role === 'CSC_OPERATOR' || user.role === 'SUPER_ADMIN'
                ? `<button type="button" data-open-walkin="grievance" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg whitespace-nowrap shrink-0 cursor-pointer">${ICONS.plus('w-3.5 h-3.5')}<span>Walk-in Intake</span></button>`
                : ''
            }
          </div>
        </header>
        <main class="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1280px] w-full mx-auto">${mainHtml}</main>
      </div>
    </div>
    ${renderDetailDrawer(user, perms)}
    ${renderStaffModal()}
    ${renderWalkInModal()}
  `;
}

export function bindAdminEvents(root) {
  root.querySelector('#admin-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await loginWithCredentials(String(fd.get('identifier') || ''), String(fd.get('passcode') || ''));
    if (!res.ok) {
      const err = root.querySelector('#admin-login-error');
      if (err) {
        err.textContent = res.error;
        err.classList.remove('hidden');
      }
    }
  });

  root.querySelector('#bootstrap-claim-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const p1 = String(fd.get('passcode') || '');
    const p2 = String(fd.get('confirmPasscode') || '');
    const err = root.querySelector('#bootstrap-claim-error');
    if (p1 !== p2) {
      if (err) {
        err.textContent = 'Passcodes do not match.';
        err.classList.remove('hidden');
      }
      return;
    }
    const res = await bootstrapClaimSecretary(p1);
    if (!res.ok && err) {
      err.textContent = res.error || 'Setup failed.';
      err.classList.remove('hidden');
    }
  });

  root.querySelector('#btn-fb-signin')?.addEventListener('click', async () => {
    await connectFirebaseGoogle();
  });

  root.querySelector('#btn-fb-signout')?.addEventListener('click', async () => {
    await disconnectFirebaseGoogle();
  });

  root.querySelector('#btn-admin-logout')?.addEventListener('click', async () => {
    await logoutStaff();
  });

  root.querySelector('#btn-open-mobile-sidebar')?.addEventListener('click', () => {
    store.mobileSidebarOpen = true;
    notify();
  });
  root.querySelector('#btn-close-mobile-sidebar')?.addEventListener('click', () => {
    store.mobileSidebarOpen = false;
    notify();
  });

  root.querySelectorAll('[data-anav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-anav');
      store.adminView = next;
      store.adminFilters.status = 'ALL';
      store.adminFilters.search = '';
      store.adminFilters.slaOverdueOnly = false;
      store.mobileSidebarOpen = false;
      window.history.replaceState({}, '', next === 'access-control' ? '/admin/access-control' : '/admin');
      notify();
    });
  });

  root.querySelector('#btn-inspect-breached')?.addEventListener('click', () => {
    store.adminView = 'grievances';
    store.adminFilters.slaOverdueOnly = true;
    notify();
  });

  root.querySelector('#sla-config-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = Number(root.querySelector('#sla-days-input')?.value || 7);
    await updateSlaLimit(val);
  });

  root.querySelector('#self-password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const currPw = String(fd.get('currentPassword') || '');
    const newPw = String(fd.get('newPassword') || '');
    const res = await changeOwnPassword(currPw, newPw);
    const box = root.querySelector('#self-pw-msg');
    if (box) {
      box.className = `mb-3 p-2.5 rounded-lg text-xs border ${
        res.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
      }`;
      box.textContent = res.ok ? 'Password updated and prior sessions revoked.' : res.error || 'Password update failed.';
      box.classList.remove('hidden');
    }
    if (res.ok) e.target.reset();
  });

  root.querySelector('#btn-escalate-overdue')?.addEventListener('click', async () => {
    const res = await escalateOverdueGrievances();
    const box = root.querySelector('#desk-action-msg');
    if (box) {
      box.className = `p-3 rounded-lg text-xs border ${
        res.ok ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-red-50 border-red-200 text-red-800'
      }`;
      box.textContent = res.ok
        ? `Escalation sweep complete: ${res.count || 0} overdue grievance(s) escalated.`
        : res.error || 'Escalation sweep failed.';
      box.classList.remove('hidden');
    }
  });

  root.querySelector('#admin-search-input')?.addEventListener('input', (e) => {
    store.adminFilters.search = e.target.value;
    notify();
    const el = root.querySelector('#admin-search-input');
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  root.querySelector('#admin-status-filter')?.addEventListener('change', (e) => {
    store.adminFilters.status = e.target.value;
    notify();
  });
  root.querySelector('#admin-ward-filter')?.addEventListener('change', (e) => {
    store.adminFilters.ward = e.target.value;
    notify();
  });
  root.querySelector('#admin-cat-filter')?.addEventListener('change', (e) => {
    store.adminFilters.category = e.target.value;
    notify();
  });
  root.querySelector('#admin-priority-filter')?.addEventListener('change', (e) => {
    store.adminFilters.priority = e.target.value;
    notify();
  });
  root.querySelector('#admin-sla-overdue')?.addEventListener('change', (e) => {
    store.adminFilters.slaOverdueOnly = e.target.checked;
    notify();
  });
  root.querySelector('#btn-clear-admin-filters')?.addEventListener('click', () => {
    store.adminFilters = {
      ...store.adminFilters,
      search: '',
      status: 'ALL',
      ward: 'ALL',
      category: 'ALL',
      priority: 'ALL',
      slaOverdueOnly: false,
    };
    notify();
  });

  root.querySelector('#audit-search-input')?.addEventListener('input', (e) => {
    store.adminFilters.auditSearch = e.target.value;
    notify();
    const el = root.querySelector('#audit-search-input');
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  root.querySelectorAll('[data-open-grv]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      store.selectedGrievanceId = el.getAttribute('data-open-grv');
      store.selectedServiceId = null;
      notify();
    });
  });

  root.querySelectorAll('[data-open-srv]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      store.selectedServiceId = el.getAttribute('data-open-srv');
      store.selectedGrievanceId = null;
      notify();
    });
  });

  root.querySelector('#btn-close-detail-drawer')?.addEventListener('click', () => {
    store.selectedGrievanceId = null;
    store.selectedServiceId = null;
    notify();
  });

  root.querySelectorAll('[data-attach-proof]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-attach-proof') || '';
      const hidden = root.querySelector('#drawer-after-photo-url');
      const preview = root.querySelector('#drawer-proof-preview');
      if (hidden) hidden.value = url;
      if (preview) {
        preview.src = url;
        preview.classList.remove('hidden');
      }
    });
  });

  root.querySelector('#drawer-grv-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = e.target.getAttribute('data-id');
    const fd = new FormData(e.target);
    const patch = {
      status: String(fd.get('status') || ''),
      priority: String(fd.get('priority') || 'NORMAL').toUpperCase(),
      publicRemark: String(fd.get('publicRemark') || ''),
      internalRemark: String(fd.get('internalRemark') || ''),
    };
    const afterUrl = String(fd.get('afterPhotoUrl') || '');
    if (afterUrl) patch.afterPhotoUrl = afterUrl;
    const offEl = e.target.querySelector('[name="assignedOfficerId"]');
    if (offEl && !offEl.disabled) {
      patch.assignedOfficerId = offEl.value || null;
    }
    const res = await updateGrievance(id, patch);
    const msg = root.querySelector('#drawer-msg-box');
    if (msg) {
      msg.className = `p-3 rounded-lg text-sm border ${
        res.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
      }`;
      msg.textContent = res.ok ? 'Ticket updated and logged in immutable Audit Trail.' : res.error || 'Update failed.';
      msg.classList.remove('hidden');
    }
  });

  root.querySelector('#drawer-comment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = e.target.getAttribute('data-id');
    const fd = new FormData(e.target);
    const body = String(fd.get('body') || '').trim();
    const isInternal = fd.get('isInternal') === 'on';
    const res = await addGrievanceComment(id, body, isInternal);
    const box = root.querySelector('#comment-msg-box');
    if (box && !res.ok) {
      box.className = 'p-2.5 rounded-lg text-xs bg-red-50 border border-red-200 text-red-800';
      box.textContent = res.error || 'Could not add comment.';
      box.classList.remove('hidden');
    }
  });

  root.querySelector('#drawer-srv-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = e.target.getAttribute('data-id');
    const fd = new FormData(e.target);
    const patch = {
      status: String(fd.get('status') || ''),
      officialRemark: String(fd.get('officialRemark') || ''),
    };
    const offEl = e.target.querySelector('[name="assignedOfficerId"]');
    if (offEl && !offEl.disabled) {
      patch.assignedOfficerId = offEl.value || null;
    }
    const res = await updateServiceApplication(id, patch);
    const msg = root.querySelector('#drawer-msg-box');
    if (msg) {
      msg.className = `p-3 rounded-lg text-sm border ${
        res.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
      }`;
      msg.textContent = res.ok ? 'Application updated and logged in immutable Audit Trail.' : res.error || 'Update failed.';
      msg.classList.remove('hidden');
    }
  });

  root.querySelector('#btn-delete-record')?.addEventListener('click', async (e) => {
    const kind = e.currentTarget.getAttribute('data-del-kind');
    const id = e.currentTarget.getAttribute('data-del-id');
    const res = await deleteRecord(kind, id);
    if (res.ok) {
      store.selectedGrievanceId = null;
      store.selectedServiceId = null;
      notify();
    }
  });

  root.querySelectorAll('[data-toggle-staff]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await toggleStaffActive(btn.getAttribute('data-toggle-staff'));
      if (res && !res.ok) {
        const box = root.querySelector('#access-banner-error');
        if (box) {
          box.textContent = res.error;
          box.classList.remove('hidden');
        }
      }
    });
  });

  root.querySelector('#btn-create-staff')?.addEventListener('click', () => {
    store.editingStaffId = null;
    store.staffModalWards = [1, 2, 3, 4, 5];
    store.staffModalOpen = true;
    notify();
  });

  root.querySelectorAll('[data-edit-staff]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-staff');
      const st = (store.staffDashboard.staff || []).find((s) => s.id === id);
      store.editingStaffId = id;
      store.staffModalWards = st ? [...st.assignedWards] : [1];
      store.staffModalOpen = true;
      notify();
    });
  });

  const closeStaffModal = () => {
    store.staffModalOpen = false;
    notify();
  };
  root.querySelector('#btn-close-staff-modal')?.addEventListener('click', closeStaffModal);
  root.querySelector('#btn-close-staff-modal-2')?.addEventListener('click', closeStaffModal);

  root.querySelector('#btn-wards-all')?.addEventListener('click', () => {
    store.staffModalWards = [...ALL_WARDS];
    notify();
  });
  root.querySelector('#btn-wards-clear')?.addEventListener('click', () => {
    store.staffModalWards = [];
    notify();
  });
  root.querySelectorAll('[data-toggle-ward]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const w = Number(btn.getAttribute('data-toggle-ward'));
      if (store.staffModalWards.includes(w)) {
        store.staffModalWards = store.staffModalWards.filter((x) => x !== w);
      } else {
        store.staffModalWards = [...store.staffModalWards, w].sort((a, b) => a - b);
      }
      notify();
    });
  });

  root.querySelector('#staff-role-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (store.staffModalWards.length === 0) {
      const err = root.querySelector('#staff-modal-error');
      if (err) {
        err.textContent = 'Select at least one ward (Ward 1–15).';
        err.classList.remove('hidden');
      }
      return;
    }
    const uname = String(fd.get('username') || '').trim();
    const payload = {
      name: String(fd.get('name') || ''),
      ...(uname ? { username: uname } : {}),
      email: String(fd.get('email') || ''),
      designation: String(fd.get('designation') || ''),
      role: String(fd.get('role') || 'WARD_OFFICER'),
      department: String(fd.get('department') || 'Roads & Streetlights'),
      assignedWards: store.staffModalWards,
      isActive: true,
      permissions: {
        canApproveCertificates: fd.get('perm_canApproveCertificates') === 'on',
        canAssignTickets: fd.get('perm_canAssignTickets') === 'on',
        canVerifyDocuments: fd.get('perm_canVerifyDocuments') === 'on',
        canManageUsers: fd.get('perm_canManageUsers') === 'on',
        canDeleteRecords: fd.get('perm_canDeleteRecords') === 'on',
      },
    };
    const passcode = String(fd.get('passcode') || '').trim();
    if (passcode) payload.passcode = passcode;

    const res = await saveStaff(store.editingStaffId, payload);
    if (!res.ok) {
      const err = root.querySelector('#staff-modal-error');
      if (err) {
        err.textContent = res.error || 'Save failed.';
        err.classList.remove('hidden');
      }
      return;
    }
    store.staffModalOpen = false;
    notify();
  });

  root.querySelector('#staff-reset-pw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const staffId = e.target.getAttribute('data-staff-id');
    const fd = new FormData(e.target);
    const newPw = String(fd.get('newPassword') || '');
    const res = await resetStaffPassword(staffId, newPw);
    const box = root.querySelector('#staff-reset-pw-msg');
    if (box) {
      box.className = `p-2.5 rounded-lg text-xs border ${
        res.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
      }`;
      box.textContent = res.ok ? 'Staff password reset and active sessions invalidated.' : res.error || 'Reset failed.';
      box.classList.remove('hidden');
    }
    if (res.ok) e.target.reset();
  });

  root.querySelector('#maintenance-reset-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await maintenanceReset(
      String(fd.get('confirmPhrase') || ''),
      String(fd.get('maintenanceKey') || '')
    );
    const msg = root.querySelector('#maint-reset-msg');
    if (msg && !res.ok) {
      msg.className = 'mt-3 p-2.5 rounded-lg text-xs bg-red-50 border border-red-200 text-red-800';
      msg.textContent = res.error || 'Reset failed.';
      msg.classList.remove('hidden');
    }
  });

  root.querySelectorAll('[data-open-walkin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.walkInType = btn.getAttribute('data-open-walkin');
      notify();
    });
  });
  const closeWalkIn = () => {
    store.walkInType = null;
    notify();
  };
  root.querySelector('#btn-close-walkin')?.addEventListener('click', closeWalkIn);
  root.querySelector('#btn-close-walkin-2')?.addEventListener('click', closeWalkIn);

  root.querySelector('#walkin-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('name') || '').trim();
    const mobile = String(fd.get('mobile') || '').replace(/\D/g, '');
    const ward = Number(fd.get('ward') || 1);
    const errBox = root.querySelector('#walkin-error');
    if (!name || !/^\d{10}$/.test(mobile)) {
      if (errBox) {
        errBox.textContent = 'Enter a valid name and 10-digit mobile number.';
        errBox.classList.remove('hidden');
      }
      return;
    }

    if (store.walkInType === 'grievance') {
      const res = await submitGrievance(
        {
          citizenName: name,
          mobile,
          ward,
          category: String(fd.get('category') || 'Water Supply'),
          priority: String(fd.get('priority') || 'NORMAL').toUpperCase(),
          landmark: String(fd.get('landmark') || ''),
          description: String(fd.get('description') || ''),
          consentAccepted: true,
        },
        true
      );
      if (!res.ok) {
        if (errBox) {
          errBox.textContent = res.error || 'Could not register walk-in grievance.';
          errBox.classList.remove('hidden');
        }
        return;
      }
      if (res.ticket) store.selectedGrievanceId = res.ticket.id;
    } else {
      const serviceId = String(fd.get('serviceId') || 'residence');
      const cat = SERVICE_CATALOG.find((c) => c.id === serviceId) || SERVICE_CATALOG[0];
      const res = await submitServiceApplication(
        {
          serviceId,
          applicantName: name,
          mobile,
          ward,
          address: String(fd.get('address') || ''),
          checkedDocs: cat.requiredDocsEn,
          uploadedDocNames: ['walkin_physical_docs_verified.pdf'],
        },
        true
      );
      if (!res.ok) {
        if (errBox) {
          errBox.textContent = res.error || 'Could not register walk-in service.';
          errBox.classList.remove('hidden');
        }
        return;
      }
      if (res.application) store.selectedServiceId = res.application.id;
    }
    store.walkInType = null;
    notify();
  });
}
