import {
  ALL_WARDS,
  DEFAULT_ROLE_PERMISSIONS,
  DEPARTMENTS,
  GRIEVANCE_CATEGORIES,
  IMG_ROAD_AFTER,
  IMG_STREETLIGHT_FIXED,
  SERVICE_CATALOG,
} from './i18n.js';
import {
  ICONS,
  esc,
  formatDateTime,
  formatShortDate,
  getSlaInfo,
  renderSlaBadge,
  renderStatusLabel,
} from './icons.js';
import {
  canViewGrievance,
  canViewService,
  deleteRecord,
  getActivePermissions,
  getCurrentUser,
  loginWithCredentials,
  logoutStaff,
  notify,
  saveStaff,
  store,
  submitGrievance,
  submitServiceApplication,
  toggleStaffActive,
  updateGrievance,
  updateServiceApplication,
  updateSlaLimit,
} from './store.js';

const PERM_LIST = [
  { key: 'canApproveCertificates', label: 'Approve Certificates', desc: 'Final digital sign-off authority for citizen service certificates' },
  { key: 'canAssignTickets', label: 'Assign Tickets', desc: 'Route or reassign grievances and applications across staff' },
  { key: 'canVerifyDocuments', label: 'Verify Documents', desc: 'Mark service documents verified or request citizen corrections' },
  { key: 'canManageUsers', label: 'Manage Users & RBAC', desc: 'Create staff accounts, assign wards, and edit role permissions' },
  { key: 'canDeleteRecords', label: 'Delete Records', desc: 'Permanently remove duplicate or invalid records' },
];

function renderLoginScreen() {
  const demo = (store.portalState.staff || []).filter((s) =>
    ['stf-secretary', 'stf-rahul', 'stf-anitha', 'stf-deepak'].includes(s.id)
  );

  return `
    <div class="min-h-[calc(100vh-44px)] bg-[#F8FAFC] flex items-center justify-center px-4 py-10">
      <div class="w-full max-w-[960px] grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div class="lg:col-span-6 p-6 sm:p-8 lg:p-10">
          <div class="flex items-center gap-2.5 text-[#1E3A8A]">
            ${ICONS.landmark('w-6 h-6')}
            <span class="font-display text-lg font-bold">ABC Gram Panchayat</span>
          </div>
          <h1 class="mt-6 font-display text-2xl font-bold text-slate-900">Official Staff & Admin Sign In</h1>
          <p class="mt-1.5 text-sm text-slate-600">Authorized access for Panchayat Secretary, Ward Officers, and CSC Front-Desk Operators.</p>
          <div id="admin-login-error" class="hidden mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>

          <form id="admin-login-form" class="mt-6 space-y-4">
            <div>
              <label for="admin-email" class="block text-sm font-medium text-slate-700 mb-1.5">Official Government Email</label>
              <input id="admin-email" name="email" type="email" required placeholder="officer@abcpanchayat.gov.in" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
            </div>
            <div>
              <label for="admin-pin" class="block text-sm font-medium text-slate-700 mb-1.5">4-Digit Staff Access PIN</label>
              <input id="admin-pin" name="pin" type="password" maxlength="8" required placeholder="••••" class="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
            </div>
            <button type="submit" class="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer">
              ${ICONS.shield('w-4 h-4')}
              <span>Sign In to Admin Workspace</span>
            </button>
          </form>

          <div class="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Protected by C + Python RBAC Engine</span>
            <button type="button" data-portal-switch="citizen" class="text-[#1E3A8A] font-semibold hover:underline cursor-pointer">Return to Citizen Portal</button>
          </div>
        </div>

        <div class="lg:col-span-6 bg-[#F8FAFC] border-t lg:border-t-0 lg:border-l border-slate-200 p-6 sm:p-8 lg:p-10 flex flex-col justify-between">
          <div>
            <p class="text-xs font-semibold text-[#059669]">Quick Demo-Credential Autofill</p>
            <h2 class="mt-2 font-display text-lg font-bold text-slate-900">Test RBAC Roles Instantly</h2>
            <p class="mt-1 text-xs text-slate-600 leading-relaxed">Autofill credentials or sign in directly to verify ward jurisdiction filtering, certificate approval guards, and access control.</p>

            <div class="mt-5 space-y-2.5">
              ${demo
                .map(
                  (acc) => `
                  <div class="bg-white border border-slate-200 rounded-lg p-3.5 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-semibold text-slate-900 truncate">${esc(acc.name)}</p>
                        <span class="text-[11px] font-mono text-slate-500">PIN: ${esc(acc.pin)}</span>
                      </div>
                      <p class="text-xs text-slate-600 truncate">${esc(acc.designation)} · ${
                    acc.assignedWards.length === 15
                      ? 'All Wards'
                      : `Wards ${acc.assignedWards[0]}–${acc.assignedWards[acc.assignedWards.length - 1]}`
                  }</p>
                      <p class="text-[11px] font-mono text-slate-500 truncate mt-0.5">${esc(acc.email)}</p>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <button type="button" data-autofill-email="${esc(acc.email)}" data-autofill-pin="${esc(acc.pin)}" class="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap cursor-pointer">Autofill</button>
                      <button type="button" data-instant-login-email="${esc(acc.email)}" data-instant-login-pin="${esc(acc.pin)}" class="px-2.5 py-1.5 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-md whitespace-nowrap cursor-pointer">Sign In</button>
                    </div>
                  </div>`
                )
                .join('')}
            </div>
          </div>
          <p class="mt-6 text-[11px] text-slate-500">Suspended accounts are blocked from signing in by the RBAC engine.</p>
        </div>
      </div>
    </div>
  `;
}

function renderOverview(user, visibleGrievances, visibleServices) {
  const slaLimit = store.portalState.slaLimitDays || 7;
  const open = visibleGrievances.filter((g) => g.status !== 'Resolved' && g.status !== 'Rejected');
  const breached = open.filter((g) => getSlaInfo(g, slaLimit).isBreached);
  const resolved = visibleGrievances.filter((g) => g.status === 'Resolved').length;
  const rate = visibleGrievances.length > 0 ? Math.round((resolved / visibleGrievances.length) * 100) : 0;
  const pendingSrv = visibleServices.filter((s) => s.status !== 'Approved' && s.status !== 'Rejected');

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
          <p class="mt-1 text-xs text-slate-500">Out of ${visibleGrievances.length} assigned tickets</p>
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
          <p class="text-xs text-slate-600 mt-1">Open tickets older than ${slaLimit} days are flagged as <span class="font-semibold text-red-700">SLA BREACHED</span>.</p>
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
    </div>
  `;
}

function renderGrievancesDesk(user, visibleGrievances) {
  const f = store.adminFilters;
  const slaLimit = store.portalState.slaLimitDays || 7;
  const filtered = visibleGrievances.filter((g) => {
    if (f.status !== 'ALL' && g.status !== f.status) return false;
    if (f.ward !== 'ALL' && g.ward !== Number(f.ward)) return false;
    if (f.category !== 'ALL' && g.category !== f.category) return false;
    if (f.slaOverdueOnly && !getSlaInfo(g, slaLimit).isBreached) return false;
    if (f.search.trim()) {
      const hay = `${g.id} ${g.citizenName} ${g.landmark} ${g.description} ${g.mobile}`.toLowerCase();
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
        ${
          user.role === 'CSC_OPERATOR' || user.role === 'SUPER_ADMIN'
            ? `<button type="button" data-open-walkin="grievance" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">${ICONS.plus('w-4 h-4')}<span>Register Walk-in Grievance</span></button>`
            : ''
        }
      </div>

      <div class="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div class="relative lg:col-span-2">
          <span class="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">${ICONS.search('w-4 h-4')}</span>
          <input id="admin-search-input" type="text" value="${esc(f.search)}" placeholder="Search Tracking ID, citizen, landmark..." class="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg" />
        </div>
        <select id="admin-status-filter" class="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="ALL">All Statuses</option>
          ${['Pending', 'In Progress', 'Field Inspection', 'Resolved', 'Rejected']
            .map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`)
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

        <div class="sm:col-span-2 lg:col-span-5 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <label class="inline-flex items-center gap-2 text-xs font-semibold text-red-700 cursor-pointer">
            <input id="admin-sla-overdue" type="checkbox" ${f.slaOverdueOnly ? 'checked' : ''} class="w-4 h-4 rounded border-red-300 text-red-600" />
            <span>Show SLA Overdue Tickets Only (&gt;${slaLimit} days)</span>
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
                      <th class="py-3 px-4">Category</th>
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
                        <td class="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">${esc(t.category)}</td>
                        <td class="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">${esc(t.assignedOfficerName || 'Unassigned')}</td>
                        <td class="py-3 px-4">${renderSlaBadge(t, slaLimit)}</td>
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
        <p class="mt-2 text-sm text-slate-600">Your current role (${esc(user.designation)}) does not have <code class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">canManageUsers</code> permission. Switch to Panchayat Secretary (Super Admin) to manage staff roles.</p>
      </div>`;
  }

  const staffList = store.portalState.staff || [];
  return `
    <div class="space-y-8">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-bold text-slate-900">Access & Role Management</h1>
          <p class="text-sm text-slate-600 mt-0.5">Configure Panchayat staff accounts, ward jurisdiction (Ward 1–15), and granular RBAC permissions.</p>
        </div>
        <button type="button" id="btn-create-staff" class="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg whitespace-nowrap shrink-0 cursor-pointer">${ICONS.plus('w-4 h-4')}<span>Create Staff Role</span></button>
      </div>

      <div id="access-banner-error" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>

      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="font-display text-base font-bold text-slate-900">Staff Directory (${staffList.length})</h2>
          <span class="text-xs text-slate-500">Persisted via Python + C RBAC engine</span>
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
                    <p class="font-semibold text-slate-900">${esc(s.name)}</p>
                    <p class="text-xs font-mono text-slate-500">${esc(s.email)}</p>
                  </td>
                  <td class="py-3.5 px-4">
                    <p class="font-medium text-slate-900">${esc(s.designation)}</p>
                    <p class="text-xs font-mono text-[#1E3A8A]">${esc(s.role)}</p>
                  </td>
                  <td class="py-3.5 px-4 text-slate-700">${esc(s.department)}</td>
                  <td class="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-700">${
                    s.assignedWards.length === 15 ? 'All Wards (1–15)' : `Wards ${s.assignedWards.join(', ')}`
                  }</td>
                  <td class="py-3.5 px-4">
                    <button type="button" data-toggle-staff="${esc(s.id)}" class="px-2.5 py-1 text-xs font-medium rounded-md border cursor-pointer ${
                    s.isActive
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                  }">${s.isActive ? 'Active' : 'Suspended'}</button>
                  </td>
                  <td class="py-3.5 px-4 text-right">
                    <button type="button" data-edit-staff="${esc(s.id)}" class="px-3 py-1.5 text-xs font-semibold text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-md cursor-pointer">Edit Role</button>
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
                    s.permissions[p.key]
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
    </div>
  `;
}

function renderAuditLog() {
  const q = (store.adminFilters.auditSearch || '').trim().toLowerCase();
  const logs = (store.portalState.auditLogs || []).filter((l) =>
    !q ? true : `${l.actorName} ${l.action} ${l.targetId} ${l.details}`.toLowerCase().includes(q)
  );

  return `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-bold text-slate-900">System Audit Log</h1>
          <p class="text-sm text-slate-600 mt-0.5">Immutable chronological record of all administrative and RBAC events.</p>
        </div>
        <div class="relative w-full sm:w-72">
          <span class="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">${ICONS.search('w-4 h-4')}</span>
          <input id="audit-search-input" type="text" value="${esc(store.adminFilters.auditSearch)}" placeholder="Filter audit log..." class="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg" />
        </div>
      </div>
      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th class="py-3 px-4">Timestamp</th>
                <th class="py-3 px-4">Actor & Role</th>
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
                  <td class="py-3 px-4 whitespace-nowrap"><span class="font-medium text-slate-900">${esc(l.actorName)}</span> · <span class="font-mono text-xs text-slate-500">${esc(l.actorRole)}</span></td>
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
  `;
}

function renderDetailDrawer(user, perms) {
  const grv = store.selectedGrievanceId
    ? (store.portalState.grievances || []).find((g) => g.id === store.selectedGrievanceId)
    : null;
  const srv = store.selectedServiceId
    ? (store.portalState.services || []).find((s) => s.id === store.selectedServiceId)
    : null;
  const record = grv || srv;
  if (!record) return '';

  const isGrv = Boolean(grv);
  const canAssign = perms.canAssignTickets || user.role === 'SUPER_ADMIN';
  const activeOfficers = (store.portalState.staff || []).filter((s) => s.isActive);

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
            ${renderStatusLabel(record.status)}
            ${renderSlaBadge(record, store.portalState.slaLimitDays)}
          </div>
          <div id="drawer-msg-box" class="hidden p-3 rounded-lg text-sm"></div>

          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 text-sm">
            <div><dt class="text-xs text-slate-500">${isGrv ? 'Citizen Name' : 'Applicant Name'}</dt><dd class="font-semibold text-slate-900 mt-0.5">${esc(isGrv ? record.citizenName : record.applicantName)}</dd></div>
            <div><dt class="text-xs text-slate-500">Mobile Number</dt><dd class="font-mono tabular-nums text-slate-900 mt-0.5">${esc(record.mobile)}</dd></div>
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
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-semibold text-slate-700 mb-1.5">Workflow Status</label>
                      <select name="status" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                        ${['Pending', 'In Progress', 'Field Inspection', 'Resolved', 'Rejected']
                          .map((st) => `<option value="${st}" ${record.status === st ? 'selected' : ''}>${st}</option>`)
                          .join('')}
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
                    <label class="block text-xs font-semibold text-slate-700 mb-1.5">Official Public Remark</label>
                    <textarea name="publicRemark" rows="2" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg">${esc(record.publicRemark || '')}</textarea>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1.5">Internal Staff Note</label>
                    <input name="internalRemark" type="text" value="${esc(record.internalRemark || '')}" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
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
                    <button type="submit" class="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">Save Ticket Update</button>
                  </div>
                </form>`
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
                      ${
                        !perms.canApproveCertificates
                          ? `<p class="mt-1 text-[11px] text-amber-700">Final Certificate Approval guarded by C RBAC engine.</p>`
                          : ''
                      }
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
                    <textarea name="officialRemark" rows="3" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg">${esc(record.officialRemark || '')}</textarea>
                  </div>
                  <div class="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                    ${
                      perms.canDeleteRecords
                        ? `<button type="button" id="btn-delete-record" data-del-kind="service" data-del-id="${esc(record.id)}" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer">${ICONS.trash('w-3.5 h-3.5')}<span>Delete Application</span></button>`
                        : `<span class="text-xs text-slate-400">Delete restricted to Super Admin</span>`
                    }
                    <button type="submit" class="px-5 py-2 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg cursor-pointer">Save Application Update</button>
                  </div>
                </form>`
          }

          <div class="pt-5 border-t border-slate-200">
            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Action History (${(record.timeline || []).length})</h3>
            <div class="space-y-3">
              ${(record.timeline || [])
                .map(
                  (ev) => `
                <div class="text-xs border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
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
    ? (store.portalState.staff || []).find((s) => s.id === store.editingStaffId)
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
          <div id="staff-modal-error" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label><input name="name" type="text" required value="${esc(editing?.name || '')}" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Official Email *</label><input name="email" type="email" required value="${esc(editing?.email || '')}" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Designation *</label><input name="designation" type="text" required value="${esc(editing?.designation || 'Ward Field Officer')}" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Access PIN</label><input name="pin" type="text" maxlength="8" value="${esc(editing?.pin || '6006')}" class="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" /></div>
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
          <div class="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button type="button" data-open-walkin="grievance" class="flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${isGrv ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}">Walk-in Grievance</button>
            <button type="button" data-open-walkin="service" class="flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${!isGrv ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}">Walk-in E-Service</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label class="block text-xs font-semibold text-slate-700 mb-1">Citizen Name *</label><input name="name" type="text" required class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
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
              ? `<div><label class="block text-xs font-semibold text-slate-700 mb-1">Landmark *</label><input name="landmark" type="text" required class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>
                 <div><label class="block text-xs font-semibold text-slate-700 mb-1">Description *</label><textarea name="description" rows="3" required class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"></textarea></div>`
              : `<div><label class="block text-xs font-semibold text-slate-700 mb-1">Residential Address *</label><input name="address" type="text" required class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" /></div>`
          }
          <div class="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button type="button" id="btn-close-walkin-2" class="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
            <button type="submit" class="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">Create Record</button>
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
  const visibleGrievances = (store.portalState.grievances || []).filter((g) => canViewGrievance(g));
  const visibleServices = (store.portalState.services || []).filter((s) => canViewService(s));

  const navItems = [
    { key: 'overview', label: 'Executive Overview', icon: ICONS.dashboard('w-4 h-4') },
    { key: 'grievances', label: 'Grievance Desk', icon: ICONS.alert('w-4 h-4') },
    { key: 'services', label: 'Citizen E-Services', icon: ICONS.fileText('w-4 h-4') },
    { key: 'access-control', label: 'Access & Roles', icon: ICONS.shield('w-4 h-4'), restricted: !perms.canManageUsers },
    { key: 'audit-log', label: 'System Audit Log', icon: ICONS.history('w-4 h-4') },
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
  else mainHtml = renderAuditLog();

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
  root.querySelectorAll('[data-autofill-email]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emailEl = root.querySelector('#admin-email');
      const pinEl = root.querySelector('#admin-pin');
      if (emailEl) emailEl.value = btn.getAttribute('data-autofill-email') || '';
      if (pinEl) pinEl.value = btn.getAttribute('data-autofill-pin') || '';
    });
  });

  root.querySelectorAll('[data-instant-login-email]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await loginWithCredentials(
        btn.getAttribute('data-instant-login-email') || '',
        btn.getAttribute('data-instant-login-pin') || ''
      );
      if (!res.ok) {
        const err = root.querySelector('#admin-login-error');
        if (err) {
          err.textContent = res.error;
          err.classList.remove('hidden');
        }
      }
    });
  });

  root.querySelector('#admin-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await loginWithCredentials(String(fd.get('email') || ''), String(fd.get('pin') || ''));
    if (!res.ok) {
      const err = root.querySelector('#admin-login-error');
      if (err) {
        err.textContent = res.error;
        err.classList.remove('hidden');
      }
    }
  });

  root.querySelector('#btn-admin-logout')?.addEventListener('click', () => logoutStaff());
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
  root.querySelector('#admin-sla-overdue')?.addEventListener('change', (e) => {
    store.adminFilters.slaOverdueOnly = e.target.checked;
    notify();
  });
  root.querySelector('#btn-clear-admin-filters')?.addEventListener('click', () => {
    store.adminFilters = { ...store.adminFilters, search: '', status: 'ALL', ward: 'ALL', category: 'ALL', slaOverdueOnly: false };
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
      publicRemark: String(fd.get('publicRemark') || ''),
      internalRemark: String(fd.get('internalRemark') || ''),
      afterPhotoUrl: String(fd.get('afterPhotoUrl') || '') || undefined,
    };
    const offEl = e.target.querySelector('[name="assignedOfficerId"]');
    if (offEl && !offEl.disabled) {
      patch.assignedOfficerId = offEl.value;
    }
    const res = await updateGrievance(id, patch);
    const msg = root.querySelector('#drawer-msg-box');
    if (msg) {
      msg.className = `p-3 rounded-lg text-sm border ${
        res.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
      }`;
      msg.textContent = res.ok ? 'Ticket updated and logged in Audit Trail.' : res.error || 'Update failed.';
      msg.classList.remove('hidden');
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
      patch.assignedOfficerId = offEl.value;
    }
    const res = await updateServiceApplication(id, patch);
    const msg = root.querySelector('#drawer-msg-box');
    if (msg) {
      msg.className = `p-3 rounded-lg text-sm border ${
        res.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
      }`;
      msg.textContent = res.ok ? 'Application updated and logged in Audit Trail.' : res.error || 'Update failed.';
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
      const st = (store.portalState.staff || []).find((s) => s.id === id);
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
    const payload = {
      name: String(fd.get('name') || ''),
      email: String(fd.get('email') || ''),
      pin: String(fd.get('pin') || '6006'),
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
    if (!name || !/^\d{10}$/.test(mobile)) return;

    if (store.walkInType === 'grievance') {
      const created = await submitGrievance({
        citizenName: name,
        mobile,
        ward,
        category: String(fd.get('category') || 'Water Supply'),
        landmark: String(fd.get('landmark') || ''),
        description: String(fd.get('description') || ''),
      });
      if (created) store.selectedGrievanceId = created.id;
    } else {
      const serviceId = String(fd.get('serviceId') || 'residence');
      const cat = SERVICE_CATALOG.find((c) => c.id === serviceId) || SERVICE_CATALOG[0];
      const created = await submitServiceApplication({
        serviceId,
        applicantName: name,
        mobile,
        ward,
        address: String(fd.get('address') || ''),
        checkedDocs: cat.requiredDocsEn,
        uploadedDocNames: ['walkin_physical_docs_verified.pdf'],
      });
      if (created) store.selectedServiceId = created.id;
    }
    store.walkInType = null;
    notify();
  });
}
