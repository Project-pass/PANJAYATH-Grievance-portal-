import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Filter,
  History,
  Landmark,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useAuth } from '../context/PortalContext';
import { ALL_WARDS, GRIEVANCE_CATEGORIES, SERVICE_CATALOG } from '../data/seedData';
import {
  AdminView,
  GrievanceCategory,
  GrievanceTicket,
  ServiceApplication,
  ServiceTypeId,
} from '../types/portal';
import { formatDateTime, formatShortDate, getSlaInfo } from '../utils/sla';
import { AccessControlView } from './AccessControlView';
import { AdminLoginScreen } from './AdminLoginScreen';
import { AdminTicketModal } from './AdminTicketModal';
import { SlaBadge, StatusLabel } from './StatusBadge';

interface AdminPortalProps {
  activeView: AdminView;
  setActiveView: (v: AdminView) => void;
}

export function AdminPortal({ activeView, setActiveView }: AdminPortalProps) {
  const {
    portalState,
    currentUser,
    permissions,
    logout,
    canViewGrievance,
    canViewService,
    submitGrievance,
    submitServiceApplication,
    updateSlaLimit,
  } = useAuth();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [wardFilter, setWardFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [slaOverdueOnly, setSlaOverdueOnly] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');

  // Detail Drawer State
  const [selectedGrievanceId, setSelectedGrievanceId] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  // SLA setting input
  const [slaDraft, setSlaDraft] = useState<number>(portalState.slaLimitDays);
  const [slaMsg, setSlaMsg] = useState('');

  // Walk-in Modal State (for CSC Operator / Admin)
  const [walkInType, setWalkInType] = useState<'grievance' | 'service' | null>(null);
  const [wName, setWName] = useState('');
  const [wMobile, setWMobile] = useState('');
  const [wWard, setWWard] = useState<number>(1);
  const [wCategory, setWCategory] = useState<GrievanceCategory>('Water Supply');
  const [wLandmark, setWLandmark] = useState('');
  const [wDesc, setWDesc] = useState('');
  const [wServiceId, setWServiceId] = useState<ServiceTypeId>('residence');
  const [wAddress, setWAddress] = useState('');

  const visibleGrievances = useMemo(
    () => portalState.grievances.filter((g) => canViewGrievance(g)),
    [portalState.grievances, currentUser]
  );

  const visibleServices = useMemo(
    () => portalState.services.filter((s) => canViewService(s)),
    [portalState.services, currentUser]
  );

  // KPI Metrics computed from visible scope
  const kpis = useMemo(() => {
    const openGrievances = visibleGrievances.filter(
      (g) => g.status !== 'Resolved' && g.status !== 'Rejected'
    );
    const breachedGrievances = openGrievances.filter(
      (g) => getSlaInfo(g.createdAt, g.status, portalState.slaLimitDays).isBreached
    );
    const resolvedCount = visibleGrievances.filter((g) => g.status === 'Resolved').length;
    const resolutionRate =
      visibleGrievances.length > 0
        ? Math.round((resolvedCount / visibleGrievances.length) * 100)
        : 0;
    const pendingServices = visibleServices.filter(
      (s) => s.status !== 'Approved' && s.status !== 'Rejected'
    );

    return {
      openCount: openGrievances.length,
      pendingServicesCount: pendingServices.length,
      breachedCount: breachedGrievances.length,
      resolutionRate,
    };
  }, [visibleGrievances, visibleServices, portalState.slaLimitDays]);

  // Ward-wise & Category-wise breakdown bars
  const wardBreakdown = useMemo(() => {
    const counts = ALL_WARDS.map((ward) => ({
      ward,
      count: visibleGrievances.filter((g) => g.ward === ward).length,
    })).filter((w) => w.count > 0 || currentUser?.assignedWards.includes(w.ward));
    const maxCount = Math.max(1, ...counts.map((c) => c.count));
    return { counts: counts.slice(0, 10), maxCount };
  }, [visibleGrievances, currentUser]);

  const categoryBreakdown = useMemo(() => {
    const counts = GRIEVANCE_CATEGORIES.map((category) => ({
      category,
      count: visibleGrievances.filter((g) => g.category === category).length,
    }));
    const maxCount = Math.max(1, ...counts.map((c) => c.count));
    return { counts, maxCount };
  }, [visibleGrievances]);

  // Filtered Grievances
  const filteredGrievances = useMemo(() => {
    return visibleGrievances.filter((g) => {
      if (statusFilter !== 'ALL' && g.status !== statusFilter) return false;
      if (wardFilter !== 'ALL' && g.ward !== Number(wardFilter)) return false;
      if (categoryFilter !== 'ALL' && g.category !== categoryFilter) return false;
      if (slaOverdueOnly && !getSlaInfo(g.createdAt, g.status, portalState.slaLimitDays).isBreached) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${g.id} ${g.citizenName} ${g.landmark} ${g.description} ${g.mobile}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    visibleGrievances,
    statusFilter,
    wardFilter,
    categoryFilter,
    slaOverdueOnly,
    searchQuery,
    portalState.slaLimitDays,
  ]);

  // Filtered Services
  const filteredServices = useMemo(() => {
    return visibleServices.filter((s) => {
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (wardFilter !== 'ALL' && s.ward !== Number(wardFilter)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${s.id} ${s.applicantName} ${s.serviceName} ${s.address} ${s.mobile}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleServices, statusFilter, wardFilter, searchQuery]);

  // Filtered Audit Logs
  const filteredAudits = useMemo(() => {
    if (!auditSearch.trim()) return portalState.auditLogs;
    const q = auditSearch.trim().toLowerCase();
    return portalState.auditLogs.filter((a) =>
      `${a.actorName} ${a.action} ${a.targetId} ${a.details}`.toLowerCase().includes(q)
    );
  }, [portalState.auditLogs, auditSearch]);

  if (!currentUser) {
    return <AdminLoginScreen />;
  }

  const activeGrievance: GrievanceTicket | undefined = selectedGrievanceId
    ? portalState.grievances.find((g) => g.id === selectedGrievanceId)
    : undefined;
  const activeService: ServiceApplication | undefined = selectedServiceId
    ? portalState.services.find((s) => s.id === selectedServiceId)
    : undefined;

  function navigateAdmin(view: AdminView) {
    setActiveView(view);
    setStatusFilter('ALL');
    setSearchQuery('');
    setSlaOverdueOnly(false);
    setMobileSidebarOpen(false);
    const nextPath = view === 'access-control' ? '/admin/access-control' : '/admin';
    window.history.replaceState({}, '', nextPath);
  }

  function handleWalkInSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!wName.trim() || !/^\d{10}$/.test(wMobile.trim())) return;
    if (walkInType === 'grievance') {
      const created = submitGrievance({
        citizenName: wName,
        mobile: wMobile,
        ward: wWard,
        category: wCategory,
        landmark: wLandmark || 'CSC Front Desk Submission',
        description: wDesc || 'Registered via Walk-in Citizen Helpdesk.',
      });
      setSelectedGrievanceId(created.id);
    } else if (walkInType === 'service') {
      const cat = SERVICE_CATALOG.find((c) => c.id === wServiceId) ?? SERVICE_CATALOG[0];
      const created = submitServiceApplication({
        serviceId: wServiceId,
        applicantName: wName,
        mobile: wMobile,
        ward: wWard,
        address: wAddress || `Ward ${wWard}, ABC Gram Panchayat`,
        checkedDocs: cat.requiredDocsEn,
        uploadedDocNames: ['walkin_physical_docs_verified.pdf'],
      });
      setSelectedServiceId(created.id);
    }
    setWalkInType(null);
    setWName('');
    setWMobile('');
    setWLandmark('');
    setWDesc('');
    setWAddress('');
  }

  const navItems: {
    key: AdminView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    restricted?: boolean;
  }[] = [
    { key: 'overview', label: 'Executive Overview', icon: LayoutDashboard },
    { key: 'grievances', label: 'Grievance Desk', icon: AlertTriangle },
    { key: 'services', label: 'Citizen E-Services', icon: FileText },
    {
      key: 'access-control',
      label: 'Access & Roles',
      icon: Shield,
      restricted: !permissions.canManageUsers,
    },
    { key: 'audit-log', label: 'System Audit Log', icon: History },
  ];

  const SidebarContent = (
    <div className="flex flex-col h-full justify-between p-4">
      <div>
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Landmark className="w-6 h-6 text-[#1E3A8A] shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-[#1E3A8A] truncate">
              ABC Gram Panchayat
            </p>
            <p className="text-[11px] text-slate-500 truncate">Administrative Console</p>
          </div>
        </div>

        <nav className="mt-6 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigateAdmin(item.key)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#1E3A8A] text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.restricted && (
                  <Lock
                    className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-indigo-200' : 'text-slate-400'}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Staff Session Card */}
      <div className="pt-4 border-t border-slate-200 space-y-3">
        <div className="bg-[#F8FAFC] border border-slate-200 rounded-lg p-3">
          <p className="text-xs font-bold text-slate-900 truncate">{currentUser.name}</p>
          <p className="text-[11px] text-slate-600 truncate">{currentUser.designation}</p>
          <p className="mt-1.5 text-[11px] font-mono text-[#1E3A8A]">
            {currentUser.assignedWards.length === 15
              ? 'All Wards (1–15)'
              : `Wards: ${currentUser.assignedWards.join(', ')}`}
          </p>
        </div>

        <button
          type="button"
          onClick={logout}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-44px)] bg-[#F8FAFC] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0 bg-white border-r border-slate-200">
        <div className="sticky top-0 h-[calc(100vh-44px)]">{SidebarContent}</div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-white h-full z-50 border-r border-slate-200">
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main Workspace Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Breadcrumb Bar */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open admin sidebar"
              className="lg:hidden p-2 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
              <span className="font-medium text-slate-800">Admin Portal</span>
              <span>/</span>
              <span className="truncate font-semibold text-[#1E3A8A]">
                {navItems.find((n) => n.key === activeView)?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {(currentUser.role === 'CSC_OPERATOR' || currentUser.role === 'SUPER_ADMIN') && (
              <button
                type="button"
                onClick={() => setWalkInType('grievance')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Walk-in Intake</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1280px] w-full mx-auto">
          {/* OVERVIEW DASHBOARD */}
          {activeView === 'overview' && (
            <div className="space-y-8">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Executive Governance Dashboard
                </h1>
                <p className="text-sm text-slate-600 mt-0.5">
                  Scoped view for <strong>{currentUser.name}</strong> ({currentUser.department} ·{' '}
                  {currentUser.assignedWards.length === 15
                    ? 'All 15 Wards'
                    : `Wards ${currentUser.assignedWards.join(', ')}`}
                  )
                </p>
              </div>

              {/* 4 KPI Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs font-medium text-slate-500">Total Open Grievances</p>
                  <p className="mt-2 text-3xl font-bold font-mono tabular-nums text-[#1E3A8A]">
                    {kpis.openCount}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Out of {visibleGrievances.length} assigned tickets
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs font-medium text-slate-500">Pending Service Approvals</p>
                  <p className="mt-2 text-3xl font-bold font-mono tabular-nums text-slate-900">
                    {kpis.pendingServicesCount}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Across {visibleServices.length} visible applications
                  </p>
                </div>

                <div
                  className={`border rounded-xl p-5 ${
                    kpis.breachedCount > 0
                      ? 'bg-red-50 border-red-200'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <p
                    className={`text-xs font-semibold ${
                      kpis.breachedCount > 0 ? 'text-red-800' : 'text-slate-500'
                    }`}
                  >
                    SLA Breached Tickets (&gt;{portalState.slaLimitDays}d)
                  </p>
                  <p
                    className={`mt-2 text-3xl font-bold font-mono tabular-nums ${
                      kpis.breachedCount > 0 ? 'text-red-700' : 'text-slate-900'
                    }`}
                  >
                    {kpis.breachedCount}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      navigateAdmin('grievances');
                      setSlaOverdueOnly(true);
                    }}
                    className="mt-1 text-xs font-semibold text-red-700 hover:underline cursor-pointer"
                  >
                    Inspect overdue tickets
                  </button>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs font-medium text-slate-500">Resolution Rate</p>
                  <p className="mt-2 text-3xl font-bold font-mono tabular-nums text-[#059669]">
                    {kpis.resolutionRate}%
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Completed vs total visible</p>
                </div>
              </div>

              {/* Ward-wise & Category-wise Visual Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Ward-wise Grievance Distribution
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5 mb-5">
                    Ticket volume across assigned Panchayat wards
                  </p>

                  <div className="space-y-3">
                    {wardBreakdown.counts.map((item) => {
                      const pct = Math.round((item.count / wardBreakdown.maxCount) * 100);
                      return (
                        <div key={item.ward} className="flex items-center gap-3 text-xs">
                          <span className="w-16 font-mono font-medium text-slate-700 shrink-0">
                            Ward {item.ward}
                          </span>
                          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#1E3A8A] rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-8 text-right font-mono font-semibold tabular-nums text-slate-900">
                            {item.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Category-wise Civic Workload
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5 mb-5">
                    Breakdown by infrastructure & public health sector
                  </p>

                  <div className="space-y-3.5">
                    {categoryBreakdown.counts.map((item) => {
                      const pct = Math.round((item.count / categoryBreakdown.maxCount) * 100);
                      return (
                        <div key={item.category} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-700">{item.category}</span>
                            <span className="font-mono font-semibold tabular-nums text-slate-900">
                              {item.count}
                            </span>
                          </div>
                          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#059669] rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* SLA Policy Configuration (Super Admin Control) */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-[#1E3A8A]" aria-hidden="true" />
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Grievance SLA Policy Threshold
                    </h2>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    Open tickets older than {portalState.slaLimitDays} days are flagged as{' '}
                    <span className="font-semibold text-red-700">SLA BREACHED</span> across Citizen
                    and Admin views.
                  </p>
                  {slaMsg && <p className="text-xs text-[#059669] mt-1 font-medium">{slaMsg}</p>}
                </div>

                {currentUser.role === 'SUPER_ADMIN' ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <label htmlFor="sla-days-input" className="text-xs font-medium text-slate-600">
                      Days:
                    </label>
                    <input
                      id="sla-days-input"
                      type="number"
                      min={1}
                      max={30}
                      value={slaDraft}
                      onChange={(e) => setSlaDraft(Number(e.target.value))}
                      className="w-20 px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const res = updateSlaLimit(slaDraft);
                        setSlaMsg(res.ok ? `SLA threshold updated to ${slaDraft} days.` : res.error || '');
                      }}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer"
                    >
                      Save SLA
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-slate-500 font-mono">
                    Managed by Panchayat Secretary
                  </span>
                )}
              </div>
            </div>
          )}

          {/* GRIEVANCE MANAGEMENT DESK */}
          {activeView === 'grievances' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-900">
                    Grievance Redressal Desk
                  </h1>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Showing {filteredGrievances.length} of {visibleGrievances.length} authorized
                    tickets.
                  </p>
                </div>
                {(currentUser.role === 'CSC_OPERATOR' || currentUser.role === 'SUPER_ADMIN') && (
                  <button
                    type="button"
                    onClick={() => setWalkInType('grievance')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Register Walk-in Grievance</span>
                  </button>
                )}
              </div>

              {/* Multi-Filter Toolbar */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="relative lg:col-span-2">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Tracking ID, citizen, landmark..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="Pending">Pending</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Field Inspection">Field Inspection</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Rejected">Rejected</option>
                </select>

                <select
                  value={wardFilter}
                  onChange={(e) => setWardFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Wards</option>
                  {ALL_WARDS.map((w) => (
                    <option key={w} value={w}>
                      Ward {w}
                    </option>
                  ))}
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Categories</option>
                  {GRIEVANCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <div className="sm:col-span-2 lg:col-span-5 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-red-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={slaOverdueOnly}
                      onChange={(e) => setSlaOverdueOnly(e.target.checked)}
                      className="w-4 h-4 rounded border-red-300 text-red-600"
                    />
                    <Filter className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Show SLA Overdue Tickets Only (&gt;{portalState.slaLimitDays} days)</span>
                  </label>

                  {(statusFilter !== 'ALL' ||
                    wardFilter !== 'ALL' ||
                    categoryFilter !== 'ALL' ||
                    slaOverdueOnly ||
                    searchQuery) && (
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter('ALL');
                        setWardFilter('ALL');
                        setCategoryFilter('ALL');
                        setSlaOverdueOnly(false);
                        setSearchQuery('');
                      }}
                      className="text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                    >
                      Clear all filters
                    </button>
                  )}
                </div>
              </div>

              {/* Data Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {filteredGrievances.length === 0 ? (
                  <div className="p-10 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      No grievances match the current filters or ward jurisdiction.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Tracking ID</th>
                          <th className="py-3 px-4">Citizen & Location</th>
                          <th className="py-3 px-4">Category</th>
                          <th className="py-3 px-4">Assigned Officer</th>
                          <th className="py-3 px-4">SLA</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {filteredGrievances.map((ticket) => (
                          <tr
                            key={ticket.id}
                            onClick={() => setSelectedGrievanceId(ticket.id)}
                            className="hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-3 px-4">
                              <span className="font-mono text-xs font-bold text-[#1E3A8A]">
                                {ticket.id}
                              </span>
                              <p className="text-[11px] font-mono tabular-nums text-slate-500">
                                {formatShortDate(ticket.createdAt)}
                              </p>
                            </td>
                            <td className="py-3 px-4 max-w-[260px]">
                              <p className="font-medium text-slate-900 truncate">
                                {ticket.citizenName} · Ward {ticket.ward}
                              </p>
                              <p className="text-xs text-slate-500 truncate">{ticket.landmark}</p>
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                              {ticket.category}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                              {ticket.assignedOfficerName || 'Unassigned'}
                            </td>
                            <td className="py-3 px-4">
                              <SlaBadge
                                createdAt={ticket.createdAt}
                                status={ticket.status}
                                slaLimitDays={portalState.slaLimitDays}
                              />
                            </td>
                            <td className="py-3 px-4">
                              <StatusLabel status={ticket.status} />
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedGrievanceId(ticket.id);
                                }}
                                className="px-3 py-1.5 text-xs font-semibold text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-md cursor-pointer"
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* E-SERVICES MANAGEMENT DESK */}
          {activeView === 'services' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-900">
                    Citizen E-Service & Certificate Desk
                  </h1>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Verify citizen documents and issue statutory approvals ({filteredServices.length}{' '}
                    visible).
                  </p>
                </div>
                {(currentUser.role === 'CSC_OPERATOR' || currentUser.role === 'SUPER_ADMIN') && (
                  <button
                    type="button"
                    onClick={() => setWalkInType('service')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg cursor-pointer"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Register Walk-in Service</span>
                  </button>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="relative">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search ID, applicant, certificate..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Stages</option>
                  <option value="Submitted">Submitted</option>
                  <option value="Pending Verification">Pending Verification</option>
                  <option value="Documents Verified">Documents Verified</option>
                  <option value="Correction Needed">Correction Needed</option>
                  <option value="Approved">Approved</option>
                  <option value="Rejected">Rejected</option>
                </select>
                <select
                  value={wardFilter}
                  onChange={(e) => setWardFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Wards</option>
                  {ALL_WARDS.map((w) => (
                    <option key={w} value={w}>
                      Ward {w}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {filteredServices.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-600">
                    No service applications match your current role scope or filter.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Application ID</th>
                          <th className="py-3 px-4">Service</th>
                          <th className="py-3 px-4">Applicant & Ward</th>
                          <th className="py-3 px-4">Fee</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {filteredServices.map((app) => (
                          <tr
                            key={app.id}
                            onClick={() => setSelectedServiceId(app.id)}
                            className="hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-3 px-4">
                              <span className="font-mono text-xs font-bold text-[#1E3A8A]">
                                {app.id}
                              </span>
                              <p className="text-[11px] font-mono tabular-nums text-slate-500">
                                {formatShortDate(app.createdAt)}
                              </p>
                            </td>
                            <td className="py-3 px-4">
                              <p className="font-medium text-slate-900">{app.serviceName}</p>
                              <p className="text-xs text-slate-500">{app.department}</p>
                            </td>
                            <td className="py-3 px-4">
                              <p className="font-medium text-slate-900">
                                {app.applicantName} · Ward {app.ward}
                              </p>
                              <p className="text-xs text-slate-500 truncate max-w-[240px]">
                                {app.address}
                              </p>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700">
                              {app.feeInr === 0 ? 'Free' : `₹${app.feeInr}`}
                            </td>
                            <td className="py-3 px-4">
                              <StatusLabel status={app.status} />
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedServiceId(app.id);
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#059669] bg-emerald-50 hover:bg-emerald-100 rounded-md cursor-pointer"
                              >
                                <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Review</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ACCESS CONTROL */}
          {activeView === 'access-control' && <AccessControlView />}

          {/* SYSTEM AUDIT LOG */}
          {activeView === 'audit-log' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-900">
                    System Audit Log
                  </h1>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Immutable chronological record of all administrative and RBAC events.
                  </p>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Filter audit log..."
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Timestamp</th>
                        <th className="py-3 px-4">Actor & Role</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">Target</th>
                        <th className="py-3 px-4">Event Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredAudits.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
                            {formatDateTime(log.timestamp)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="font-medium text-slate-900">{log.actorName}</span>
                            <span className="text-slate-400 mx-1.5">·</span>
                            <span className="font-mono text-xs text-slate-500">{log.actorRole}</span>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-[#1E3A8A] whitespace-nowrap">
                            {log.action}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                            {log.targetId}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700">{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Detail Drawers */}
      {activeGrievance && (
        <AdminTicketModal
          kind="grievance"
          record={activeGrievance}
          onClose={() => setSelectedGrievanceId(null)}
        />
      )}
      {activeService && (
        <AdminTicketModal
          kind="service"
          record={activeService}
          onClose={() => setSelectedServiceId(null)}
        />
      )}

      {/* CSC / Admin Walk-in Intake Modal */}
      {walkInType && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Walk-in Front Desk Intake"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-slate-900">
                {walkInType === 'grievance'
                  ? 'Register Walk-in Grievance (CSC Desk)'
                  : 'Register Walk-in E-Service (CSC Desk)'}
              </h3>
              <button
                type="button"
                onClick={() => setWalkInType(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleWalkInSubmit} className="p-6 space-y-4">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setWalkInType('grievance')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    walkInType === 'grievance'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Walk-in Grievance
                </button>
                <button
                  type="button"
                  onClick={() => setWalkInType('service')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    walkInType === 'service'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Walk-in E-Service
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Citizen / Applicant Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={wName}
                    onChange={(e) => setWName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    10-Digit Mobile *
                  </label>
                  <input
                    type="tel"
                    maxLength={10}
                    required
                    value={wMobile}
                    onChange={(e) => setWMobile(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ward *</label>
                  <select
                    value={wWard}
                    onChange={(e) => setWWard(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {ALL_WARDS.map((w) => (
                      <option key={w} value={w}>
                        Ward {w}
                      </option>
                    ))}
                  </select>
                </div>

                {walkInType === 'grievance' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Category *
                    </label>
                    <select
                      value={wCategory}
                      onChange={(e) => setWCategory(e.target.value as GrievanceCategory)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {GRIEVANCE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Service Type *
                    </label>
                    <select
                      value={wServiceId}
                      onChange={(e) => setWServiceId(e.target.value as ServiceTypeId)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {SERVICE_CATALOG.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.titleEn}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {walkInType === 'grievance' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Landmark *
                    </label>
                    <input
                      type="text"
                      required
                      value={wLandmark}
                      onChange={(e) => setWLandmark(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Description *
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={wDesc}
                      onChange={(e) => setWDesc(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Residential Address & Door No. *
                  </label>
                  <input
                    type="text"
                    required
                    value={wAddress}
                    onChange={(e) => setWAddress(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setWalkInType(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer"
                >
                  Create Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
