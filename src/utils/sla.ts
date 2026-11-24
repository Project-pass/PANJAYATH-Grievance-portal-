import { GrievanceTicket, ServiceApplication } from '../types/portal';

const REFERENCE_MIN_NOW = new Date('2026-11-23T23:59:00.000Z').getTime();

export function getEffectiveNow(): number {
  return Math.max(Date.now(), REFERENCE_MIN_NOW);
}

export function getTicketAgeDays(createdAtIso: string): number {
  const createdMs = new Date(createdAtIso).getTime();
  const diffMs = Math.max(0, getEffectiveNow() - createdMs);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getSlaInfo(
  createdAtIso: string,
  status: string,
  slaLimitDays: number
): {
  ageDays: number;
  remainingDays: number;
  isBreached: boolean;
  isClosed: boolean;
  label: string;
} {
  const ageDays = getTicketAgeDays(createdAtIso);
  const isClosed = status === 'Resolved' || status === 'Rejected' || status === 'Approved';
  const remainingDays = slaLimitDays - ageDays;
  const isBreached = !isClosed && ageDays > slaLimitDays;

  if (isClosed) {
    return {
      ageDays,
      remainingDays,
      isBreached: false,
      isClosed: true,
      label: `Closed (${ageDays}d)`,
    };
  }

  if (isBreached) {
    return {
      ageDays,
      remainingDays,
      isBreached: true,
      isClosed: false,
      label: `SLA BREACHED (${ageDays}d)`,
    };
  }

  return {
    ageDays,
    remainingDays,
    isBreached: false,
    isClosed: false,
    label: remainingDays === 0 ? 'Due Today' : `${remainingDays}d left`,
  };
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function downloadAcknowledgementReceipt(
  record:
    | { kind: 'grievance'; data: GrievanceTicket }
    | { kind: 'service'; data: ServiceApplication }
) {
  const lines =
    record.kind === 'grievance'
      ? [
          'ABC GRAM PANCHAYAT — OFFICIAL GRIEVANCE ACKNOWLEDGEMENT',
          '=======================================================',
          `Tracking ID      : ${record.data.id}`,
          `Citizen Name     : ${record.data.citizenName}`,
          `Mobile Number    : ${record.data.mobile}`,
          `Ward             : Ward ${record.data.ward}`,
          `Category         : ${record.data.category}`,
          `Department       : ${record.data.department}`,
          `Landmark         : ${record.data.landmark}`,
          `Current Status   : ${record.data.status}`,
          `Filed Timestamp  : ${formatDateTime(record.data.createdAt)}`,
          '',
          'Description:',
          record.data.description,
          '',
          'Track live status online at the ABC Gram Panchayat Citizen Portal.',
        ]
      : [
          'ABC GRAM PANCHAYAT — E-SERVICE APPLICATION ACKNOWLEDGEMENT',
          '===========================================================',
          `Tracking ID      : ${record.data.id}`,
          `Service Name     : ${record.data.serviceName}`,
          `Applicant Name   : ${record.data.applicantName}`,
          `Mobile Number    : ${record.data.mobile}`,
          `Ward             : Ward ${record.data.ward}`,
          `Address          : ${record.data.address}`,
          `Statutory Fee    : ${record.data.feeInr === 0 ? 'Free of Cost' : `INR ${record.data.feeInr}`}`,
          `Current Status   : ${record.data.status}`,
          `Filed Timestamp  : ${formatDateTime(record.data.createdAt)}`,
          '',
          `Verified Checklist Items (${record.data.checkedDocs.length}):`,
          ...record.data.checkedDocs.map((doc, idx) => `  ${idx + 1}. ${doc}`),
          '',
          'Track live status online at the ABC Gram Panchayat Citizen Portal.',
        ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${record.data.id}_acknowledgement.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
