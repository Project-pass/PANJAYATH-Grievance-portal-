import React, { useState } from 'react';
import { Lock, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '../context/PortalContext';
import { IMG_ROAD_AFTER, IMG_STREETLIGHT_FIXED } from '../data/seedData';
import {
  GrievanceStatus,
  GrievanceTicket,
  ServiceApplication,
  ServiceStatus,
} from '../types/portal';
import { formatDateTime } from '../utils/sla';
import { SlaBadge, StatusLabel } from './StatusBadge';

type DetailModalProps =
  | { kind: 'grievance'; record: GrievanceTicket; onClose: () => void }
  | { kind: 'service'; record: ServiceApplication; onClose: () => void };

const GRIEVANCE_STATUSES: GrievanceStatus[] = [
  'Pending',
  'In Progress',
  'Field Inspection',
  'Resolved',
  'Rejected',
];

const SERVICE_STATUSES: ServiceStatus[] = [
  'Submitted',
  'Pending Verification',
  'Documents Verified',
  'Correction Needed',
  'Approved',
  'Rejected',
];

export function AdminTicketModal(props: DetailModalProps) {
  const {
    portalState,
    currentUser,
    permissions,
    updateGrievance,
    updateServiceApplication,
    deleteGrievance,
    deleteServiceApplication,
  } = useAuth();

  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');

  // Grievance editable fields
  const [gStatus, setGStatus] = useState<GrievanceStatus>(
    props.kind === 'grievance' ? props.record.status : 'Pending'
  );
  const [gOfficerId, setGOfficerId] = useState<string>(
    props.record.assignedOfficerId ?? ''
  );
  const [gPublicRemark, setGPublicRemark] = useState<string>(
    props.kind === 'grievance' ? props.record.publicRemark ?? '' : ''
  );
  const [gInternalRemark, setGInternalRemark] = useState<string>(
    props.kind === 'grievance' ? props.record.internalRemark ?? '' : ''
  );
  const [gAfterPhoto, setGAfterPhoto] = useState<string>(
    props.kind === 'grievance' ? props.record.afterPhotoUrl ?? '' : ''
  );

  // Service editable fields
  const [sStatus, setSStatus] = useState<ServiceStatus>(
    props.kind === 'service' ? props.record.status : 'Submitted'
  );
  const [sOfficerId, setSOfficerId] = useState<string>(
    props.record.assignedOfficerId ?? ''
  );
  const [sRemark, setSRemark] = useState<string>(
    props.kind === 'service' ? props.record.officialRemark ?? '' : ''
  );

  const canAssign = permissions.canAssignTickets || currentUser?.role === 'SUPER_ADMIN';
  const assignableOfficers = portalState.staff.filter((s) => s.isActive);

  function handleProofUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setGAfterPhoto(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleSaveGrievance(e: React.FormEvent) {
    e.preventDefault();
    if (props.kind !== 'grievance') return;
    const res = updateGrievance(props.record.id, {
      status: gStatus,
      assignedOfficerId: canAssign ? gOfficerId : props.record.assignedOfficerId,
      publicRemark: gPublicRemark,
      internalRemark: gInternalRemark,
      afterPhotoUrl: gAfterPhoto || undefined,
    });
    if (!res.ok) {
      setError(res.error || 'Could not save changes.');
      setSavedNotice('');
    } else {
      setError('');
      setSavedNotice('Grievance updated and logged in Audit Trail.');
    }
  }

  function handleSaveService(e: React.FormEvent) {
    e.preventDefault();
    if (props.kind !== 'service') return;
    const res = updateServiceApplication(props.record.id, {
      status: sStatus,
      assignedOfficerId: canAssign ? sOfficerId : props.record.assignedOfficerId,
      officialRemark: sRemark,
    });
    if (!res.ok) {
      setError(res.error || 'Could not update application.');
      setSavedNotice('');
    } else {
      setError('');
      setSavedNotice('Service application updated and logged in Audit Trail.');
    }
  }

  function handleDelete() {
    if (props.kind === 'grievance') {
      const res = deleteGrievance(props.record.id);
      if (res.ok) props.onClose();
      else setError(res.error || 'Delete failed.');
    } else {
      const res = deleteServiceApplication(props.record.id);
      if (res.ok) props.onClose();
      else setError(res.error || 'Delete failed.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Ticket detail workspace"
    >
      <div className="w-full max-w-2xl bg-white h-full overflow-y-auto border-l border-slate-200 flex flex-col">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 sticky top-0 bg-white z-10">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-[#1E3A8A]">
                {props.record.id}
              </span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs font-medium text-slate-600">
                Ward {props.record.ward} · {props.record.department}
              </span>
            </div>
            <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5">
              {props.kind === 'grievance'
                ? `${props.record.category} — ${props.record.landmark}`
                : props.record.serviceName}
            </h2>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close detail drawer"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="p-6 space-y-6 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusLabel status={props.record.status} />
            <SlaBadge
              createdAt={props.record.createdAt}
              status={props.record.status}
              slaLimitDays={portalState.slaLimitDays}
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              {error}
            </div>
          )}
          {savedNotice && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
              {savedNotice}
            </div>
          )}

          {/* Citizen / Applicant Metadata */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500">
                {props.kind === 'grievance' ? 'Citizen Name' : 'Applicant Name'}
              </dt>
              <dd className="font-semibold text-slate-900 mt-0.5">
                {props.kind === 'grievance'
                  ? props.record.citizenName
                  : props.record.applicantName}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Mobile Number</dt>
              <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                {props.record.mobile}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Filed On</dt>
              <dd className="font-mono tabular-nums text-slate-700 mt-0.5">
                {formatDateTime(props.record.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Current Assignee</dt>
              <dd className="font-medium text-slate-900 mt-0.5">
                {props.record.assignedOfficerName || 'Unassigned'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">
                {props.kind === 'grievance' ? 'Detailed Description' : 'Address & Documents'}
              </dt>
              <dd className="text-slate-800 mt-0.5">
                {props.kind === 'grievance'
                  ? props.record.description
                  : `${props.record.address} · Docs verified by citizen: ${props.record.checkedDocs.join(', ')}`}
              </dd>
            </div>
          </dl>

          {/* Grievance Action Form */}
          {props.kind === 'grievance' && (
            <form onSubmit={handleSaveGrievance} className="space-y-4">
              {props.record.beforePhotoUrl && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1.5">
                    Citizen Attached Evidence Photo
                  </p>
                  <img
                    src={props.record.beforePhotoUrl}
                    alt="Reported grievance evidence"
                    referrerPolicy="no-referrer"
                    className="w-full max-h-52 object-cover rounded-lg border border-slate-200"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="modal-grv-status"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Workflow Status
                  </label>
                  <select
                    id="modal-grv-status"
                    value={gStatus}
                    onChange={(e) => setGStatus(e.target.value as GrievanceStatus)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  >
                    {GRIEVANCE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="modal-grv-officer"
                    className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    <span>Assign / Reassign Officer</span>
                    {!canAssign && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                        <Lock className="w-3 h-3" /> Restricted
                      </span>
                    )}
                  </label>
                  <select
                    id="modal-grv-officer"
                    disabled={!canAssign}
                    value={gOfficerId}
                    onChange={(e) => setGOfficerId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  >
                    <option value="">-- Unassigned --</option>
                    {assignableOfficers.map((off) => (
                      <option key={off.id} value={off.id}>
                        {off.name} ({off.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="modal-grv-public-remark"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Official Public Remark (Visible to Citizen on Tracker)
                </label>
                <textarea
                  id="modal-grv-public-remark"
                  rows={2}
                  value={gPublicRemark}
                  onChange={(e) => setGPublicRemark(e.target.value)}
                  placeholder="Enter inspection findings or resolution summary..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                />
              </div>

              <div>
                <label
                  htmlFor="modal-grv-internal-remark"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Internal Staff Note (Admin Only)
                </label>
                <input
                  id="modal-grv-internal-remark"
                  type="text"
                  value={gInternalRemark}
                  onChange={(e) => setGInternalRemark(e.target.value)}
                  placeholder="Budget head, contractor ref, or internal coordination note..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1.5">
                  Resolution Proof Image (After Work Photo)
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer">
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Upload Proof</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleProofUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setGAfterPhoto(IMG_ROAD_AFTER)}
                    className="px-2.5 py-1.5 text-xs font-medium text-[#059669] bg-emerald-50 hover:bg-emerald-100 rounded-lg cursor-pointer"
                  >
                    Attach Sample Road Proof
                  </button>
                  <button
                    type="button"
                    onClick={() => setGAfterPhoto(IMG_STREETLIGHT_FIXED)}
                    className="px-2.5 py-1.5 text-xs font-medium text-[#059669] bg-emerald-50 hover:bg-emerald-100 rounded-lg cursor-pointer"
                  >
                    Attach Sample Streetlight Proof
                  </button>
                </div>
                {gAfterPhoto && (
                  <div className="mt-2.5 relative inline-block">
                    <img
                      src={gAfterPhoto}
                      alt="Resolution proof preview"
                      referrerPolicy="no-referrer"
                      className="w-52 h-32 object-cover rounded-lg border border-emerald-200"
                    />
                    <button
                      type="button"
                      onClick={() => setGAfterPhoto('')}
                      className="absolute -top-2 -right-2 p-1 bg-slate-900 text-white rounded-full cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                {permissions.canDeleteRecords ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Delete Ticket</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">Delete restricted to Super Admin</span>
                )}

                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer"
                >
                  Save Ticket Update
                </button>
              </div>
            </form>
          )}

          {/* Service Application Action Form */}
          {props.kind === 'service' && (
            <form onSubmit={handleSaveService} className="space-y-4">
              {props.record.uploadedDocNames.length > 0 && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <span className="font-semibold text-slate-800">Uploaded Files: </span>
                  <span className="font-mono">{props.record.uploadedDocNames.join(', ')}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="modal-srv-status"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Verification & Approval Stage
                  </label>
                  <select
                    id="modal-srv-status"
                    value={sStatus}
                    onChange={(e) => setSStatus(e.target.value as ServiceStatus)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  >
                    {SERVICE_STATUSES.map((st) => {
                      const approveBlocked =
                        st === 'Approved' && !permissions.canApproveCertificates;
                      const verifyBlocked =
                        (st === 'Documents Verified' || st === 'Correction Needed') &&
                        !permissions.canVerifyDocuments &&
                        currentUser?.role !== 'SUPER_ADMIN';
                      return (
                        <option key={st} value={st} disabled={approveBlocked || verifyBlocked}>
                          {st}
                          {approveBlocked ? ' (Requires Approval Authority)' : ''}
                          {verifyBlocked ? ' (Requires Verify Permission)' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {!permissions.canApproveCertificates && (
                    <p className="mt-1 text-[11px] text-amber-700 flex items-center gap-1">
                      <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>Final Certificate Approval is guarded by RBAC.</span>
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="modal-srv-officer"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Assigned Officer
                  </label>
                  <select
                    id="modal-srv-officer"
                    disabled={!canAssign}
                    value={sOfficerId}
                    onChange={(e) => setSOfficerId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  >
                    <option value="">-- Unassigned --</option>
                    {assignableOfficers.map((off) => (
                      <option key={off.id} value={off.id}>
                        {off.name} ({off.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="modal-srv-remark"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Official Verification / Approval Remark
                </label>
                <textarea
                  id="modal-srv-remark"
                  rows={3}
                  value={sRemark}
                  onChange={(e) => setSRemark(e.target.value)}
                  placeholder="Enter document verification notes or approval order number..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                {permissions.canDeleteRecords ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Delete Application</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">Delete restricted to Super Admin</span>
                )}

                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg cursor-pointer"
                >
                  Save Application Update
                </button>
              </div>
            </form>
          )}

          {/* Chronological Timeline Log */}
          <div className="pt-5 border-t border-slate-200">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Action History ({props.record.timeline.length})
            </h3>
            <div className="space-y-3">
              {props.record.timeline.map((ev) => (
                <div
                  key={ev.id}
                  className="text-xs border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{ev.stepTitle}</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {formatDateTime(ev.timestamp)}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-0.5">{ev.actor}</p>
                  <p className="text-slate-800 mt-1">{ev.remark}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
