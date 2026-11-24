import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  SearchCheck,
  XCircle,
} from 'lucide-react';
import { STATUS_ML } from '../data/i18n';
import { Language } from '../types/portal';
import { getSlaInfo } from '../utils/sla';

export function StatusLabel({
  status,
  lang = 'en',
}: {
  status: string;
  lang?: Language;
}) {
  const display = lang === 'ml' && STATUS_ML[status] ? STATUS_ML[status] : status;

  let tone = 'bg-slate-100 text-slate-700 border-slate-200';
  let Icon = Clock;

  if (status === 'Resolved' || status === 'Approved') {
    tone = 'bg-emerald-50 text-emerald-800 border-emerald-200';
    Icon = CheckCircle2;
  } else if (status === 'Documents Verified') {
    tone = 'bg-teal-50 text-teal-800 border-teal-200';
    Icon = FileCheck2;
  } else if (status === 'In Progress' || status === 'Field Inspection') {
    tone = 'bg-indigo-50 text-indigo-800 border-indigo-200';
    Icon = SearchCheck;
  } else if (status === 'Pending' || status === 'Pending Verification' || status === 'Submitted') {
    tone = 'bg-amber-50 text-amber-800 border-amber-200';
    Icon = Clock;
  } else if (status === 'Correction Needed' || status === 'Rejected') {
    tone = 'bg-red-50 text-red-800 border-red-200';
    Icon = XCircle;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-md whitespace-nowrap shrink-0 ${tone}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{display}</span>
    </span>
  );
}

export function SlaBadge({
  createdAt,
  status,
  slaLimitDays,
}: {
  createdAt: string;
  status: string;
  slaLimitDays: number;
}) {
  const info = getSlaInfo(createdAt, status, slaLimitDays);

  if (info.isClosed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
        {info.label}
      </span>
    );
  }

  if (info.isBreached) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold font-mono tabular-nums bg-red-600 text-white rounded whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{info.label}</span>
      </span>
    );
  }

  const urgent = info.remainingDays <= 2;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono tabular-nums border rounded whitespace-nowrap shrink-0 ${
        urgent
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-slate-50 text-slate-700 border-slate-200'
      }`}
    >
      <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>{info.label}</span>
    </span>
  );
}
