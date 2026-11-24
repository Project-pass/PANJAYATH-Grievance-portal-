import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ROLE_PERMISSIONS,
  INITIAL_PORTAL_STATE,
  SERVICE_CATALOG,
  getDepartmentForCategory,
} from '../data/seedData';
import {
  AuditLogEntry,
  GrievanceCategory,
  GrievanceStatus,
  GrievanceTicket,
  Language,
  PortalMode,
  PortalState,
  RoleType,
  ServiceApplication,
  ServiceStatus,
  ServiceTypeId,
  StaffAccount,
  StaffPermissions,
} from '../types/portal';

const STORAGE_KEY = 'abc_gram_panchayat_portal_v1';
const AUTH_SESSION_KEY = 'abc_gram_panchayat_session_v1';

const CITIZEN_PERMISSIONS: StaffPermissions = {
  canApproveCertificates: false,
  canAssignTickets: false,
  canManageUsers: false,
  canDeleteRecords: false,
  canVerifyDocuments: false,
};

interface NewGrievanceInput {
  citizenName: string;
  mobile: string;
  ward: number;
  category: GrievanceCategory;
  landmark: string;
  description: string;
  beforePhotoUrl?: string;
}

interface NewServiceInput {
  serviceId: ServiceTypeId;
  applicantName: string;
  mobile: string;
  ward: number;
  address: string;
  checkedDocs: string[];
  uploadedDocNames: string[];
}

interface UpdateGrievanceInput {
  status?: GrievanceStatus;
  assignedOfficerId?: string;
  publicRemark?: string;
  internalRemark?: string;
  afterPhotoUrl?: string;
}

interface UpdateServiceInput {
  status?: ServiceStatus;
  assignedOfficerId?: string;
  officialRemark?: string;
}

interface SaveStaffInput {
  id?: string;
  name: string;
  email: string;
  pin: string;
  designation: string;
  role: Exclude<RoleType, 'CITIZEN'>;
  department: StaffAccount['department'];
  assignedWards: number[];
  isActive: boolean;
  permissions: StaffPermissions;
}

interface AuthContextValue {
  portalState: PortalState;
  currentUser: StaffAccount | null;
  activeRole: RoleType;
  permissions: StaffPermissions;
  language: Language;
  setLanguage: (lang: Language) => void;
  portalMode: PortalMode;
  setPortalMode: (mode: PortalMode) => void;
  loginWithCredentials: (email: string, pin: string) => { ok: boolean; error?: string };
  switchActiveUser: (staffIdOrCitizen: string) => void;
  logout: () => void;
  canViewGrievance: (ticket: GrievanceTicket) => boolean;
  canViewService: (app: ServiceApplication) => boolean;
  submitGrievance: (input: NewGrievanceInput) => GrievanceTicket;
  submitServiceApplication: (input: NewServiceInput) => ServiceApplication;
  submitGrievanceFeedback: (ticketId: string, rating: number, comment: string) => void;
  updateGrievance: (ticketId: string, patch: UpdateGrievanceInput) => { ok: boolean; error?: string };
  updateServiceApplication: (
    appId: string,
    patch: UpdateServiceInput
  ) => { ok: boolean; error?: string };
  deleteGrievance: (ticketId: string) => { ok: boolean; error?: string };
  deleteServiceApplication: (appId: string) => { ok: boolean; error?: string };
  saveStaffMember: (input: SaveStaffInput) => { ok: boolean; error?: string };
  toggleStaffActive: (staffId: string) => { ok: boolean; error?: string };
  updateSlaLimit: (days: number) => { ok: boolean; error?: string };
  resetDemoData: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredPortalState(): PortalState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_PORTAL_STATE;
    const parsed = JSON.parse(raw) as Partial<PortalState>;
    if (
      !Array.isArray(parsed.staff) ||
      !Array.isArray(parsed.grievances) ||
      !Array.isArray(parsed.services) ||
      !Array.isArray(parsed.auditLogs)
    ) {
      return INITIAL_PORTAL_STATE;
    }
    return {
      staff: parsed.staff,
      grievances: parsed.grievances,
      services: parsed.services,
      auditLogs: parsed.auditLogs,
      slaLimitDays: typeof parsed.slaLimitDays === 'number' ? parsed.slaLimitDays : 7,
    };
  } catch {
    return INITIAL_PORTAL_STATE;
  }
}

function loadStoredSessionId(): string | null {
  try {
    return localStorage.getItem(AUTH_SESSION_KEY);
  } catch {
    return null;
  }
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [portalState, setPortalState] = useState<PortalState>(() => loadStoredPortalState());
  const [sessionStaffId, setSessionStaffId] = useState<string | null>(() => loadStoredSessionId());
  const [language, setLanguage] = useState<Language>('en');
  const [portalMode, setPortalMode] = useState<PortalMode>(() =>
    window.location.pathname.startsWith('/admin') ? 'admin' : 'citizen'
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(portalState));
    } catch {
      // Ignore quota errors in restricted sandboxes
    }
  }, [portalState]);

  useEffect(() => {
    try {
      if (sessionStaffId) {
        localStorage.setItem(AUTH_SESSION_KEY, sessionStaffId);
      } else {
        localStorage.removeItem(AUTH_SESSION_KEY);
      }
    } catch {
      // Ignore storage error
    }
  }, [sessionStaffId]);

  const currentUser = useMemo(() => {
    if (!sessionStaffId) return null;
    const found = portalState.staff.find((s) => s.id === sessionStaffId);
    if (!found || !found.isActive) return null;
    return found;
  }, [portalState.staff, sessionStaffId]);

  const activeRole: RoleType = currentUser ? currentUser.role : 'CITIZEN';
  const permissions: StaffPermissions = currentUser
    ? currentUser.permissions
    : CITIZEN_PERMISSIONS;

  function makeAudit(
    actorName: string,
    actorRole: string,
    action: string,
    targetId: string,
    details: string
  ): AuditLogEntry {
    return {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      actorName,
      actorRole,
      action,
      targetId,
      details,
    };
  }

  function loginWithCredentials(email: string, pin: string): { ok: boolean; error?: string } {
    const cleanEmail = email.trim().toLowerCase();
    const found = portalState.staff.find((s) => s.email.toLowerCase() === cleanEmail);
    if (!found || found.pin !== pin.trim()) {
      return { ok: false, error: 'Invalid official email or 4-digit access PIN.' };
    }
    if (!found.isActive) {
      return {
        ok: false,
        error: 'This staff account is currently suspended. Contact the Panchayat Secretary.',
      };
    }
    setSessionStaffId(found.id);
    setPortalState((prev) => ({
      ...prev,
      auditLogs: [
        makeAudit(
          found.name,
          found.role,
          'STAFF_LOGIN',
          found.id,
          `${found.name} (${found.designation}) signed into the Admin & Staff Portal.`
        ),
        ...prev.auditLogs,
      ],
    }));
    return { ok: true };
  }

  function switchActiveUser(staffIdOrCitizen: string) {
    if (staffIdOrCitizen === 'CITIZEN') {
      setSessionStaffId(null);
      return;
    }
    const found = portalState.staff.find((s) => s.id === staffIdOrCitizen && s.isActive);
    if (found) {
      setSessionStaffId(found.id);
    }
  }

  function logout() {
    if (currentUser) {
      setPortalState((prev) => ({
        ...prev,
        auditLogs: [
          makeAudit(
            currentUser.name,
            currentUser.role,
            'STAFF_LOGOUT',
            currentUser.id,
            `${currentUser.name} signed out of the Admin Portal.`
          ),
          ...prev.auditLogs,
        ],
      }));
    }
    setSessionStaffId(null);
  }

  function canViewGrievance(ticket: GrievanceTicket): boolean {
    if (!currentUser) return false;
    if (currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'CSC_OPERATOR') {
      return true;
    }
    // WARD_OFFICER: restricted to assigned wards and matching department or direct assignment
    const inWard = currentUser.assignedWards.includes(ticket.ward);
    const matchesDept = ticket.department === currentUser.department;
    const directlyAssigned = ticket.assignedOfficerId === currentUser.id;
    return inWard && (matchesDept || directlyAssigned);
  }

  function canViewService(app: ServiceApplication): boolean {
    if (!currentUser) return false;
    if (currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'CSC_OPERATOR') {
      return true;
    }
    const inWard = currentUser.assignedWards.includes(app.ward);
    const matchesDept = app.department === currentUser.department;
    const directlyAssigned = app.assignedOfficerId === currentUser.id;
    return inWard && (matchesDept || directlyAssigned);
  }

  function submitGrievance(input: NewGrievanceInput): GrievanceTicket {
    const existingNums = portalState.grievances
      .map((g) => Number(g.id.split('-').pop() || '100'))
      .filter((n) => !Number.isNaN(n));
    const nextNum = Math.max(108, ...existingNums) + 1;
    const id = `ABC-GRV-2026-${nextNum}`;
    const now = new Date().toISOString();
    const department = getDepartmentForCategory(input.category);

    // Auto-route to matching active Ward Officer if available
    const autoOfficer = portalState.staff.find(
      (s) =>
        s.isActive &&
        s.role === 'WARD_OFFICER' &&
        s.department === department &&
        s.assignedWards.includes(input.ward)
    );

    const actorLabel = currentUser
      ? `${currentUser.name} (${currentUser.role === 'CSC_OPERATOR' ? 'CSC Operator' : currentUser.designation})`
      : `${input.citizenName} (Citizen)`;

    const newTicket: GrievanceTicket = {
      id,
      citizenName: input.citizenName.trim(),
      mobile: input.mobile.trim(),
      ward: input.ward,
      category: input.category,
      department,
      landmark: input.landmark.trim(),
      description: input.description.trim(),
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
      assignedOfficerId: autoOfficer?.id,
      assignedOfficerName: autoOfficer?.name,
      filedByRole: activeRole,
      beforePhotoUrl: input.beforePhotoUrl,
      publicRemark: autoOfficer
        ? `Auto-routed to ${autoOfficer.name} (${department}).`
        : 'Queued at Panchayat Grievance Desk for officer assignment.',
      timeline: [
        {
          id: `tl-${Date.now()}`,
          timestamp: now,
          stepTitle: currentUser ? 'Walk-in Grievance Registered' : 'Grievance Registered',
          actor: actorLabel,
          remark: `Filed for Ward ${input.ward} (${input.category}).`,
          statusLabel: 'Pending',
        },
      ],
    };

    setPortalState((prev) => ({
      ...prev,
      grievances: [newTicket, ...prev.grievances],
      auditLogs: [
        makeAudit(
          currentUser ? currentUser.name : input.citizenName,
          activeRole,
          'GRIEVANCE_SUBMITTED',
          id,
          `New grievance ${id} registered for Ward ${input.ward} (${input.category}).`
        ),
        ...prev.auditLogs,
      ],
    }));

    return newTicket;
  }

  function submitServiceApplication(input: NewServiceInput): ServiceApplication {
    const existingNums = portalState.services
      .map((s) => Number(s.id.split('-').pop() || '200'))
      .filter((n) => !Number.isNaN(n));
    const nextNum = Math.max(205, ...existingNums) + 1;
    const id = `ABC-SRV-2026-${nextNum}`;
    const now = new Date().toISOString();
    const catalogItem =
      SERVICE_CATALOG.find((c) => c.id === input.serviceId) ?? SERVICE_CATALOG[0];

    const actorLabel = currentUser
      ? `${currentUser.name} (${currentUser.role === 'CSC_OPERATOR' ? 'CSC Operator' : currentUser.designation})`
      : `${input.applicantName} (Citizen)`;

    const newApp: ServiceApplication = {
      id,
      serviceId: catalogItem.id,
      serviceName: catalogItem.titleEn,
      applicantName: input.applicantName.trim(),
      mobile: input.mobile.trim(),
      ward: input.ward,
      address: input.address.trim(),
      department: catalogItem.department,
      feeInr: catalogItem.feeInr,
      status: 'Submitted',
      createdAt: now,
      updatedAt: now,
      checkedDocs: input.checkedDocs,
      uploadedDocNames: input.uploadedDocNames,
      filedByRole: activeRole,
      officialRemark: 'Application received. Pending initial CSC document verification.',
      timeline: [
        {
          id: `srv-tl-${Date.now()}`,
          timestamp: now,
          stepTitle: currentUser ? 'Walk-in Application Submitted' : 'Application Submitted',
          actor: actorLabel,
          remark: `${catalogItem.titleEn} application filed for Ward ${input.ward}.`,
          statusLabel: 'Submitted',
        },
      ],
    };

    setPortalState((prev) => ({
      ...prev,
      services: [newApp, ...prev.services],
      auditLogs: [
        makeAudit(
          currentUser ? currentUser.name : input.applicantName,
          activeRole,
          'SERVICE_APPLIED',
          id,
          `Application ${id} submitted for ${catalogItem.titleEn} (Ward ${input.ward}).`
        ),
        ...prev.auditLogs,
      ],
    }));

    return newApp;
  }

  function submitGrievanceFeedback(ticketId: string, rating: number, comment: string) {
    setPortalState((prev) => ({
      ...prev,
      grievances: prev.grievances.map((g) =>
        g.id === ticketId
          ? {
              ...g,
              rating,
              feedbackComment: comment.trim() || undefined,
              updatedAt: new Date().toISOString(),
            }
          : g
      ),
      auditLogs: [
        makeAudit(
          'Citizen Feedback',
          'CITIZEN',
          'FEEDBACK_SUBMITTED',
          ticketId,
          `Citizen rated resolution ${rating}/5 stars on ${ticketId}.`
        ),
        ...prev.auditLogs,
      ],
    }));
  }

  function updateGrievance(
    ticketId: string,
    patch: UpdateGrievanceInput
  ): { ok: boolean; error?: string } {
    if (!currentUser) {
      return { ok: false, error: 'Authentication required to update grievances.' };
    }
    const target = portalState.grievances.find((g) => g.id === ticketId);
    if (!target) return { ok: false, error: 'Ticket not found.' };

    if (!canViewGrievance(target)) {
      return { ok: false, error: 'Access denied: Ticket is outside your assigned ward/department.' };
    }

    if (
      patch.assignedOfficerId !== undefined &&
      patch.assignedOfficerId !== target.assignedOfficerId &&
      !permissions.canAssignTickets &&
      currentUser.role !== 'SUPER_ADMIN'
    ) {
      return { ok: false, error: 'Permission denied: You do not have ticket assignment rights.' };
    }

    const now = new Date().toISOString();
    const assignedOfficer = patch.assignedOfficerId
      ? portalState.staff.find((s) => s.id === patch.assignedOfficerId)
      : undefined;

    const nextStatus = patch.status ?? target.status;
    const statusChanged = nextStatus !== target.status;
    const officerChanged =
      patch.assignedOfficerId !== undefined &&
      patch.assignedOfficerId !== target.assignedOfficerId;

    const stepTitle = statusChanged
      ? `Status updated to ${nextStatus}`
      : officerChanged && assignedOfficer
        ? `Assigned to ${assignedOfficer.name}`
        : 'Official Remark Updated';

    const remarkText =
      patch.publicRemark?.trim() ||
      (officerChanged && assignedOfficer
        ? `Assigned to ${assignedOfficer.name} (${assignedOfficer.department}).`
        : `Ticket updated by ${currentUser.name}.`);

    const timelineEntry = {
      id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: now,
      stepTitle,
      actor: `${currentUser.name} (${currentUser.designation})`,
      remark: remarkText,
      statusLabel: nextStatus,
    };

    setPortalState((prev) => ({
      ...prev,
      grievances: prev.grievances.map((g) => {
        if (g.id !== ticketId) return g;
        return {
          ...g,
          status: nextStatus,
          updatedAt: now,
          resolvedAt: nextStatus === 'Resolved' ? g.resolvedAt ?? now : g.resolvedAt,
          assignedOfficerId:
            patch.assignedOfficerId !== undefined ? patch.assignedOfficerId || undefined : g.assignedOfficerId,
          assignedOfficerName:
            patch.assignedOfficerId !== undefined ? assignedOfficer?.name : g.assignedOfficerName,
          publicRemark: patch.publicRemark !== undefined ? patch.publicRemark : g.publicRemark,
          internalRemark: patch.internalRemark !== undefined ? patch.internalRemark : g.internalRemark,
          afterPhotoUrl: patch.afterPhotoUrl !== undefined ? patch.afterPhotoUrl : g.afterPhotoUrl,
          timeline: [...g.timeline, timelineEntry],
        };
      }),
      auditLogs: [
        makeAudit(
          currentUser.name,
          currentUser.role,
          nextStatus === 'Resolved' ? 'TICKET_RESOLVED' : 'TICKET_UPDATED',
          ticketId,
          `Ticket ${ticketId} updated (${stepTitle}) by ${currentUser.name}.`
        ),
        ...prev.auditLogs,
      ],
    }));

    return { ok: true };
  }

  function updateServiceApplication(
    appId: string,
    patch: UpdateServiceInput
  ): { ok: boolean; error?: string } {
    if (!currentUser) {
      return { ok: false, error: 'Authentication required.' };
    }
    const target = portalState.services.find((s) => s.id === appId);
    if (!target) return { ok: false, error: 'Application not found.' };

    if (!canViewService(target)) {
      return { ok: false, error: 'Access denied: Application is outside your assigned scope.' };
    }

    const nextStatus = patch.status ?? target.status;

    if (nextStatus === 'Approved' && !permissions.canApproveCertificates) {
      return {
        ok: false,
        error:
          'Permission denied: Certificate approval requires "Approve Certificates" authority.',
      };
    }

    if (
      (nextStatus === 'Documents Verified' || nextStatus === 'Correction Needed') &&
      !permissions.canVerifyDocuments &&
      currentUser.role !== 'SUPER_ADMIN'
    ) {
      return {
        ok: false,
        error: 'Permission denied: Document verification permission required.',
      };
    }

    if (
      patch.assignedOfficerId !== undefined &&
      patch.assignedOfficerId !== target.assignedOfficerId &&
      !permissions.canAssignTickets &&
      currentUser.role !== 'SUPER_ADMIN'
    ) {
      return { ok: false, error: 'Permission denied: Ticket assignment permission required.' };
    }

    const now = new Date().toISOString();
    const assignedOfficer = patch.assignedOfficerId
      ? portalState.staff.find((s) => s.id === patch.assignedOfficerId)
      : undefined;

    const statusChanged = nextStatus !== target.status;
    const stepTitle = statusChanged ? `Status: ${nextStatus}` : 'Application Updated';
    const remarkText =
      patch.officialRemark?.trim() || `Updated to ${nextStatus} by ${currentUser.name}.`;

    setPortalState((prev) => ({
      ...prev,
      services: prev.services.map((s) => {
        if (s.id !== appId) return s;
        return {
          ...s,
          status: nextStatus,
          updatedAt: now,
          assignedOfficerId:
            patch.assignedOfficerId !== undefined ? patch.assignedOfficerId || undefined : s.assignedOfficerId,
          assignedOfficerName:
            patch.assignedOfficerId !== undefined ? assignedOfficer?.name : s.assignedOfficerName,
          officialRemark: patch.officialRemark !== undefined ? patch.officialRemark : s.officialRemark,
          timeline: [
            ...s.timeline,
            {
              id: `srv-tl-${Date.now()}`,
              timestamp: now,
              stepTitle,
              actor: `${currentUser.name} (${currentUser.designation})`,
              remark: remarkText,
              statusLabel: nextStatus,
            },
          ],
        };
      }),
      auditLogs: [
        makeAudit(
          currentUser.name,
          currentUser.role,
          nextStatus === 'Approved' ? 'CERTIFICATE_APPROVED' : 'SERVICE_UPDATED',
          appId,
          `Service ${appId} (${target.serviceName}) updated to ${nextStatus} by ${currentUser.name}.`
        ),
        ...prev.auditLogs,
      ],
    }));

    return { ok: true };
  }

  function deleteGrievance(ticketId: string): { ok: boolean; error?: string } {
    if (!currentUser || !permissions.canDeleteRecords) {
      return { ok: false, error: 'Permission denied: Delete Records permission required.' };
    }
    setPortalState((prev) => ({
      ...prev,
      grievances: prev.grievances.filter((g) => g.id !== ticketId),
      auditLogs: [
        makeAudit(
          currentUser.name,
          currentUser.role,
          'RECORD_DELETED',
          ticketId,
          `Deleted grievance record ${ticketId}.`
        ),
        ...prev.auditLogs,
      ],
    }));
    return { ok: true };
  }

  function deleteServiceApplication(appId: string): { ok: boolean; error?: string } {
    if (!currentUser || !permissions.canDeleteRecords) {
      return { ok: false, error: 'Permission denied: Delete Records permission required.' };
    }
    setPortalState((prev) => ({
      ...prev,
      services: prev.services.filter((s) => s.id !== appId),
      auditLogs: [
        makeAudit(
          currentUser.name,
          currentUser.role,
          'RECORD_DELETED',
          appId,
          `Deleted service application ${appId}.`
        ),
        ...prev.auditLogs,
      ],
    }));
    return { ok: true };
  }

  function saveStaffMember(input: SaveStaffInput): { ok: boolean; error?: string } {
    if (!currentUser || !permissions.canManageUsers) {
      return { ok: false, error: 'Permission denied: Manage Users permission required.' };
    }
    const cleanEmail = input.email.trim().toLowerCase();
    const duplicate = portalState.staff.find(
      (s) => s.email.toLowerCase() === cleanEmail && s.id !== input.id
    );
    if (duplicate) {
      return { ok: false, error: 'Another staff account already uses this email address.' };
    }

    if (input.id) {
      const staffId = input.id;
      setPortalState((prev) => ({
        ...prev,
        staff: prev.staff.map((s) =>
          s.id === staffId
            ? {
                ...s,
                name: input.name.trim(),
                email: cleanEmail,
                pin: input.pin.trim() || s.pin,
                designation: input.designation.trim(),
                role: input.role,
                department: input.department,
                assignedWards: input.assignedWards,
                isActive: input.isActive,
                permissions: input.permissions,
              }
            : s
        ),
        auditLogs: [
          makeAudit(
            currentUser.name,
            currentUser.role,
            'ROLE_UPDATED',
            staffId,
            `Updated staff role & permissions for ${input.name} (${input.role}, Wards: ${input.assignedWards.length}).`
          ),
          ...prev.auditLogs,
        ],
      }));
    } else {
      const newId = `stf-${Date.now()}`;
      const newStaff: StaffAccount = {
        id: newId,
        name: input.name.trim(),
        email: cleanEmail,
        pin: input.pin.trim() || '1234',
        designation: input.designation.trim(),
        role: input.role,
        department: input.department,
        assignedWards: input.assignedWards,
        isActive: input.isActive,
        permissions: input.permissions ?? { ...DEFAULT_ROLE_PERMISSIONS[input.role] },
      };
      setPortalState((prev) => ({
        ...prev,
        staff: [...prev.staff, newStaff],
        auditLogs: [
          makeAudit(
            currentUser.name,
            currentUser.role,
            'STAFF_CREATED',
            newId,
            `Created staff account ${input.name} as ${input.role} (${input.department}).`
          ),
          ...prev.auditLogs,
        ],
      }));
    }
    return { ok: true };
  }

  function toggleStaffActive(staffId: string): { ok: boolean; error?: string } {
    if (!currentUser || !permissions.canManageUsers) {
      return { ok: false, error: 'Permission denied: Manage Users permission required.' };
    }
    if (staffId === currentUser.id) {
      return { ok: false, error: 'You cannot suspend your own active session account.' };
    }
    const target = portalState.staff.find((s) => s.id === staffId);
    if (!target) return { ok: false, error: 'Staff member not found.' };

    const nextActive = !target.isActive;
    setPortalState((prev) => ({
      ...prev,
      staff: prev.staff.map((s) => (s.id === staffId ? { ...s, isActive: nextActive } : s)),
      auditLogs: [
        makeAudit(
          currentUser.name,
          currentUser.role,
          nextActive ? 'STAFF_ACTIVATED' : 'STAFF_SUSPENDED',
          staffId,
          `${nextActive ? 'Activated' : 'Suspended'} staff account for ${target.name}.`
        ),
        ...prev.auditLogs,
      ],
    }));
    return { ok: true };
  }

  function updateSlaLimit(days: number): { ok: boolean; error?: string } {
    if (!currentUser || currentUser.role !== 'SUPER_ADMIN') {
      return { ok: false, error: 'Only Panchayat Secretary (Super Admin) can modify SLA policy.' };
    }
    const clamped = Math.min(30, Math.max(1, Math.round(days)));
    setPortalState((prev) => ({
      ...prev,
      slaLimitDays: clamped,
      auditLogs: [
        makeAudit(
          currentUser.name,
          currentUser.role,
          'SLA_POLICY_UPDATED',
          'SLA_CONFIG',
          `Updated Panchayat grievance SLA threshold to ${clamped} days.`
        ),
        ...prev.auditLogs,
      ],
    }));
    return { ok: true };
  }

  function resetDemoData() {
    setPortalState(INITIAL_PORTAL_STATE);
    setSessionStaffId(null);
  }

  return (
    <AuthContext.Provider
      value={{
        portalState,
        currentUser,
        activeRole,
        permissions,
        language,
        setLanguage,
        portalMode,
        setPortalMode,
        loginWithCredentials,
        switchActiveUser,
        logout,
        canViewGrievance,
        canViewService,
        submitGrievance,
        submitServiceApplication,
        submitGrievanceFeedback,
        updateGrievance,
        updateServiceApplication,
        deleteGrievance,
        deleteServiceApplication,
        saveStaffMember,
        toggleStaffActive,
        updateSlaLimit,
        resetDemoData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside PortalProvider');
  return ctx;
}
