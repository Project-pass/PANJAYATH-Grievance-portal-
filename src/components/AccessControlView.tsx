import React, { useState } from 'react';
import { Check, Edit3, Lock, Plus, ShieldAlert, UserCheck, UserX, X } from 'lucide-react';
import { useAuth } from '../context/PortalContext';
import { ALL_WARDS, DEFAULT_ROLE_PERMISSIONS, DEPARTMENTS } from '../data/seedData';
import { Department, RoleType, StaffAccount, StaffPermissions } from '../types/portal';

const PERMISSION_LABELS: { key: keyof StaffPermissions; label: string; desc: string }[] = [
  {
    key: 'canApproveCertificates',
    label: 'Approve Certificates',
    desc: 'Final digital sign-off authority for citizen service certificates',
  },
  {
    key: 'canAssignTickets',
    label: 'Assign Tickets',
    desc: 'Route or reassign grievances and applications across staff',
  },
  {
    key: 'canVerifyDocuments',
    label: 'Verify Documents',
    desc: 'Mark service documents verified or request citizen corrections',
  },
  {
    key: 'canManageUsers',
    label: 'Manage Users & RBAC',
    desc: 'Create staff accounts, assign wards, and edit role permissions',
  },
  {
    key: 'canDeleteRecords',
    label: 'Delete Records',
    desc: 'Permanently remove duplicate or invalid grievance/service records',
  },
];

export function AccessControlView() {
  const { portalState, currentUser, permissions, saveStaffMember, toggleStaffActive } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffAccount | null>(null);
  const [bannerError, setBannerError] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('1234');
  const [designation, setDesignation] = useState('');
  const [role, setRole] = useState<Exclude<RoleType, 'CITIZEN'>>('WARD_OFFICER');
  const [department, setDepartment] = useState<Department>('Roads & Streetlights');
  const [assignedWards, setAssignedWards] = useState<number[]>([1, 2, 3, 4]);
  const [isActive, setIsActive] = useState(true);
  const [staffPerms, setStaffPerms] = useState<StaffPermissions>({
    ...DEFAULT_ROLE_PERMISSIONS.WARD_OFFICER,
  });
  const [formError, setFormError] = useState('');

  if (!permissions.canManageUsers) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto mt-8">
        <ShieldAlert className="w-10 h-10 text-red-600 mx-auto mb-3" aria-hidden="true" />
        <h2 className="font-display text-xl font-bold text-slate-900">
          Access Control Restricted
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Your current role ({currentUser?.designation}) does not have{' '}
          <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
            canManageUsers
          </code>{' '}
          permission. Switch to Panchayat Secretary (Super Admin) to manage staff roles and ward
          permissions.
        </p>
      </div>
    );
  }

  function openCreateModal() {
    setEditingStaff(null);
    setName('');
    setEmail('');
    setPin('6006');
    setDesignation('Ward Field Officer');
    setRole('WARD_OFFICER');
    setDepartment('Roads & Streetlights');
    setAssignedWards([1, 2, 3, 4, 5]);
    setIsActive(true);
    setStaffPerms({ ...DEFAULT_ROLE_PERMISSIONS.WARD_OFFICER });
    setFormError('');
    setModalOpen(true);
  }

  function openEditModal(staff: StaffAccount) {
    setEditingStaff(staff);
    setName(staff.name);
    setEmail(staff.email);
    setPin(staff.pin);
    setDesignation(staff.designation);
    setRole(staff.role);
    setDepartment(staff.department);
    setAssignedWards(staff.assignedWards);
    setIsActive(staff.isActive);
    setStaffPerms({ ...staff.permissions });
    setFormError('');
    setModalOpen(true);
  }

  function handleRolePresetChange(nextRole: Exclude<RoleType, 'CITIZEN'>) {
    setRole(nextRole);
    setStaffPerms({ ...DEFAULT_ROLE_PERMISSIONS[nextRole] });
    if (nextRole === 'SUPER_ADMIN') {
      setAssignedWards(ALL_WARDS);
    }
  }

  function toggleWard(ward: number) {
    setAssignedWards((prev) =>
      prev.includes(ward) ? prev.filter((w) => w !== ward) : [...prev, ward].sort((a, b) => a - b)
    );
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !designation.trim()) {
      setFormError('Name, official email, and designation are required.');
      return;
    }
    if (assignedWards.length === 0) {
      setFormError('Assign at least one ward (Ward 1–15) to this staff member.');
      return;
    }
    const res = saveStaffMember({
      id: editingStaff?.id,
      name,
      email,
      pin,
      designation,
      role,
      department,
      assignedWards,
      isActive,
      permissions: staffPerms,
    });
    if (!res.ok) {
      setFormError(res.error || 'Could not save staff role.');
      return;
    }
    setModalOpen(false);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Access & Role Management
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Configure Panchayat staff accounts, ward jurisdiction (Ward 1–15), and granular RBAC
            permissions.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Create Staff Role</span>
        </button>
      </div>

      {bannerError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-center justify-between">
          <span>{bannerError}</span>
          <button
            type="button"
            onClick={() => setBannerError('')}
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Staff Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-slate-900">
            Staff Directory ({portalState.staff.length})
          </h2>
          <span className="text-xs text-slate-500">
            Changes persist immediately to RBAC store
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Role & Designation</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Assigned Wards</th>
                <th className="py-3 px-4">Account State</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {portalState.staff.map((staff) => (
                <tr key={staff.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-4">
                    <p className="font-semibold text-slate-900">{staff.name}</p>
                    <p className="text-xs font-mono text-slate-500">{staff.email}</p>
                  </td>
                  <td className="py-3.5 px-4">
                    <p className="font-medium text-slate-900">{staff.designation}</p>
                    <p className="text-xs font-mono text-[#1E3A8A]">{staff.role}</p>
                  </td>
                  <td className="py-3.5 px-4 text-slate-700">{staff.department}</td>
                  <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-700">
                    {staff.assignedWards.length === 15
                      ? 'All Wards (1–15)'
                      : `Wards ${staff.assignedWards.join(', ')}`}
                  </td>
                  <td className="py-3.5 px-4">
                    <button
                      type="button"
                      onClick={() => {
                        const res = toggleStaffActive(staff.id);
                        if (!res.ok) setBannerError(res.error || 'Action failed.');
                        else setBannerError('');
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border cursor-pointer ${
                        staff.isActive
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                      }`}
                    >
                      {staff.isActive ? (
                        <>
                          <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Active</span>
                        </>
                      ) : (
                        <>
                          <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Suspended</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => openEditModal(staff)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-md cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Edit Role</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Permission Matrix View */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-base font-bold text-slate-900">
            Live RBAC Permission Matrix
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time capability matrix reflecting custom per-officer permission overrides.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-3 px-4">Staff / Role</th>
                {PERMISSION_LABELS.map((perm) => (
                  <th key={perm.key} className="py-3 px-4 text-center whitespace-nowrap">
                    {perm.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {portalState.staff.map((staff) => (
                <tr key={staff.id} className={!staff.isActive ? 'opacity-50' : ''}>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-slate-900">{staff.name}</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="font-mono text-slate-500">{staff.role}</span>
                  </td>
                  {PERMISSION_LABELS.map((perm) => {
                    const allowed = staff.permissions[perm.key];
                    return (
                      <td key={perm.key} className="py-3 px-4 text-center">
                        {allowed ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-emerald-50 text-[#059669] border border-emerald-200">
                            <Check className="w-3.5 h-3.5" aria-label="Allowed" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-50 text-slate-400 border border-slate-200">
                            <Lock className="w-3 h-3" aria-label="Restricted" />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="py-3 px-4">
                  <span className="font-semibold text-slate-900">Public Citizen</span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="font-mono text-slate-500">CITIZEN</span>
                </td>
                {PERMISSION_LABELS.map((perm) => (
                  <td key={perm.key} className="py-3 px-4 text-center">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-50 text-slate-400 border border-slate-200">
                      <Lock className="w-3 h-3" aria-label="Restricted" />
                    </span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Staff Role Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Create or Edit Staff Role"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-display text-lg font-bold text-slate-900">
                {editingStaff ? `Edit Staff Role: ${editingStaff.name}` : 'Create New Staff Role'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 space-y-5">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Official Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Designation *
                  </label>
                  <input
                    type="text"
                    required
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Access PIN (4 digits)
                  </label>
                  <input
                    type="text"
                    maxLength={8}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    RBAC Role Preset
                  </label>
                  <select
                    value={role}
                    onChange={(e) =>
                      handleRolePresetChange(e.target.value as Exclude<RoleType, 'CITIZEN'>)
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="SUPER_ADMIN">Super Admin (Secretary)</option>
                    <option value="WARD_OFFICER">Department / Ward Officer</option>
                    <option value="CSC_OPERATOR">CSC / Front-Desk Operator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Assigned Department
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value as Department)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Multi-select Wards 1-15 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Assigned Wards ({assignedWards.length} of 15 selected)
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setAssignedWards(ALL_WARDS)}
                      className="text-[#1E3A8A] font-medium hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setAssignedWards([])}
                      className="text-slate-600 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
                  {ALL_WARDS.map((w) => {
                    const selected = assignedWards.includes(w);
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => toggleWard(w)}
                        className={`py-1.5 text-xs font-mono rounded-md border transition-colors cursor-pointer ${
                          selected
                            ? 'bg-[#1E3A8A] text-white border-[#1E3A8A] font-semibold'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        W{w}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Granular Permission Checkboxes */}
              <div className="bg-[#F8FAFC] border border-slate-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-slate-900 mb-3">
                  Granular RBAC Permission Flags
                </p>
                <div className="space-y-2.5">
                  {PERMISSION_LABELS.map((perm) => (
                    <label
                      key={perm.key}
                      className="flex items-start gap-2.5 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={staffPerms[perm.key]}
                        onChange={(e) =>
                          setStaffPerms((prev) => ({
                            ...prev,
                            [perm.key]: e.target.checked,
                          }))
                        }
                        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#1E3A8A]"
                      />
                      <div>
                        <p className="font-medium text-slate-900 text-xs">{perm.label}</p>
                        <p className="text-[11px] text-slate-500">{perm.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer"
                >
                  {editingStaff ? 'Save Role Changes' : 'Create Staff Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
