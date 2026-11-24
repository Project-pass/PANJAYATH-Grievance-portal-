export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const REFERENCE_MIN_NOW = new Date('2026-11-23T23:59:00.000Z').getTime();

export function getTicketAgeDays(createdAtIso) {
  const createdMs = new Date(createdAtIso).getTime();
  const nowMs = Math.max(Date.now(), REFERENCE_MIN_NOW);
  return Math.max(0, Math.floor((nowMs - createdMs) / 86400000));
}

export function getSlaInfo(record, slaLimitDays) {
  if (record.sla && typeof record.sla.label === 'string') {
    return record.sla;
  }
  const ageDays = getTicketAgeDays(record.createdAt);
  const isClosed =
    record.status === 'Resolved' ||
    record.status === 'Rejected' ||
    record.status === 'Approved';
  const remainingDays = slaLimitDays - ageDays;
  const isBreached = !isClosed && ageDays > slaLimitDays;

  let label = `${remainingDays}d left`;
  if (isClosed) label = `Closed (${ageDays}d)`;
  else if (isBreached) label = `SLA BREACHED (${ageDays}d)`;
  else if (remainingDays === 0) label = 'Due Today';

  return { ageDays, remainingDays, isBreached, isClosed, label };
}

export function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function downloadReceipt(kind, data, trackingToken = '') {
  const mobileDisplay = data.mobileLast4
    ? `******${data.mobileLast4}`
    : data.mobile
      ? `******${String(data.mobile).slice(-4)}`
      : 'Verified';

  const lines =
    kind === 'grievance'
      ? [
          'ABC GRAM PANCHAYAT — OFFICIAL GRIEVANCE ACKNOWLEDGEMENT',
          '=======================================================',
          `Tracking ID        : ${data.id}`,
          `Verification Token : ${trackingToken || 'Issued at submission'}`,
          `Citizen Name       : ${data.citizenName || data.citizenDisplay || 'Citizen'}`,
          `Registered Mobile  : ${mobileDisplay}`,
          `Ward               : Ward ${data.ward}`,
          `Category           : ${data.category}`,
          `Department         : ${data.department}`,
          `Landmark           : ${data.landmark}`,
          `Current Status     : ${data.status}`,
          `Filed Timestamp    : ${formatDateTime(data.createdAt)}`,
          '',
          'Description:',
          data.description,
          '',
          'Keep both your Tracking ID and Verification Token to track live status online.',
        ]
      : [
          'ABC GRAM PANCHAYAT — E-SERVICE APPLICATION ACKNOWLEDGEMENT',
          '===========================================================',
          `Tracking ID        : ${data.id}`,
          `Verification Token : ${trackingToken || 'Issued at submission'}`,
          `Service Name       : ${data.serviceName}`,
          `Applicant Name     : ${data.applicantName || data.applicantDisplay || 'Applicant'}`,
          `Registered Mobile  : ${mobileDisplay}`,
          `Ward               : Ward ${data.ward}`,
          `Statutory Fee      : ${data.feeInr === 0 ? 'Free of Cost' : `INR ${data.feeInr}`}`,
          `Current Status     : ${data.status}`,
          `Filed Timestamp    : ${formatDateTime(data.createdAt)}`,
          '',
          `Verified Checklist Items (${(data.checkedDocs || []).length}):`,
          ...(data.checkedDocs || []).map((doc, idx) => `  ${idx + 1}. ${doc}`),
          '',
          'Keep both your Tracking ID and Verification Token to track live status online.',
        ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.id}_acknowledgement.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const SVG_BASE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export const ICONS = {
  landmark: (cls = 'w-5 h-5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>`,
  users: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  shield: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
  globe: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
  menu: (cls = 'w-5 h-5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
  x: (cls = 'w-5 h-5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  arrowRight: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
  search: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  phone: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  alert: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
  triangleAlert: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  checkCircle: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`,
  clock: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  fileText: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
  printer: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>`,
  download: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  upload: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`,
  star: (cls = 'w-5 h-5', filled = false) =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  lock: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  dashboard: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
  history: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`,
  plus: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  logout: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`,
  trash: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  reset: (cls = 'w-3 h-3') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
  check: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" ${SVG_BASE}><path d="M20 6 9 17l-5-5"/></svg>`,
};

export function renderStatusLabel(status, lang = 'en', statusMap = {}) {
  const display = lang === 'ml' && statusMap[status] ? statusMap[status] : status;
  let tone = 'bg-slate-100 text-slate-700 border-slate-200';
  let iconHtml = ICONS.clock('w-3.5 h-3.5 shrink-0');

  if (status === 'Resolved' || status === 'Approved') {
    tone = 'bg-emerald-50 text-emerald-800 border-emerald-200';
    iconHtml = ICONS.checkCircle('w-3.5 h-3.5 shrink-0');
  } else if (status === 'Documents Verified') {
    tone = 'bg-teal-50 text-teal-800 border-teal-200';
    iconHtml = ICONS.checkCircle('w-3.5 h-3.5 shrink-0');
  } else if (status === 'In Progress' || status === 'Field Inspection') {
    tone = 'bg-indigo-50 text-indigo-800 border-indigo-200';
    iconHtml = ICONS.search('w-3.5 h-3.5 shrink-0');
  } else if (status === 'Correction Needed' || status === 'Rejected') {
    tone = 'bg-red-50 text-red-800 border-red-200';
    iconHtml = ICONS.alert('w-3.5 h-3.5 shrink-0');
  } else if (status === 'Pending' || status === 'Pending Verification' || status === 'Submitted') {
    tone = 'bg-amber-50 text-amber-800 border-amber-200';
  }

  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-md whitespace-nowrap shrink-0 ${tone}">${iconHtml}<span>${esc(display)}</span></span>`;
}

export function renderSlaBadge(record, slaLimitDays) {
  const info = getSlaInfo(record, slaLimitDays);
  if (info.isClosed) {
    return `<span class="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">${esc(info.label)}</span>`;
  }
  if (info.isBreached) {
    return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold font-mono tabular-nums bg-red-600 text-white rounded whitespace-nowrap shrink-0">${ICONS.triangleAlert('w-3.5 h-3.5 shrink-0')}<span>${esc(info.label)}</span></span>`;
  }
  const urgent = info.remainingDays <= 2;
  const cls = urgent
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-slate-50 text-slate-700 border-slate-200';
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono tabular-nums border rounded whitespace-nowrap shrink-0 ${cls}">${ICONS.clock('w-3 h-3 shrink-0')}<span>${esc(info.label)}</span></span>`;
}
