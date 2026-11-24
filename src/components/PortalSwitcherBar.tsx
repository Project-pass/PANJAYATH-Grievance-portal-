import { RotateCcw, Shield, Users } from 'lucide-react';
import { useAuth } from '../context/PortalContext';
import { AdminView } from '../types/portal';

interface PortalSwitcherBarProps {
  onNavigateAdminView?: (view: AdminView) => void;
}

export function PortalSwitcherBar({ onNavigateAdminView }: PortalSwitcherBarProps) {
  const {
    portalState,
    currentUser,
    portalMode,
    setPortalMode,
    switchActiveUser,
    resetDemoData,
  } = useAuth();

  function handlePortalSwitch(mode: 'citizen' | 'admin') {
    setPortalMode(mode);
    const nextPath = mode === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.replaceState({}, '', nextPath);
    }
  }

  function handleRoleChange(value: string) {
    switchActiveUser(value);
    if (value !== 'CITIZEN') {
      setPortalMode('admin');
      if (!window.location.pathname.startsWith('/admin')) {
        window.history.replaceState({}, '', '/admin');
      }
      onNavigateAdminView?.('overview');
    }
  }

  const activeStaffOptions = portalState.staff.filter((s) => s.isActive);

  return (
    <div className="no-print bg-slate-900 text-slate-100 border-b border-slate-800">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-11 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="hidden md:inline text-slate-400 font-medium whitespace-nowrap">
            Preview Switcher:
          </span>
          <div className="flex items-center gap-1 p-0.5 bg-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => handlePortalSwitch('citizen')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                portalMode === 'citizen'
                  ? 'bg-white text-slate-900'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Citizen Portal (/)</span>
            </button>
            <button
              type="button"
              onClick={() => handlePortalSwitch('admin')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                portalMode === 'admin'
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Admin Portal (/admin)</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <label htmlFor="role-switcher-select" className="hidden sm:inline text-slate-400">
            Active Role:
          </label>
          <select
            id="role-switcher-select"
            value={currentUser ? currentUser.id : 'CITIZEN'}
            onChange={(e) => handleRoleChange(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-400 max-w-[200px] sm:max-w-[260px]"
          >
            <option value="CITIZEN">Citizen (Public User)</option>
            {activeStaffOptions.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name} · {staff.role === 'SUPER_ADMIN' ? 'Secretary (Super Admin)' : staff.role === 'WARD_OFFICER' ? `Ward Officer (${staff.department})` : 'CSC Operator'}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              resetDemoData();
              handlePortalSwitch('citizen');
            }}
            title="Reset sample data in localStorage"
            className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-slate-300 hover:text-white border border-slate-700 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>
      </div>
    </div>
  );
}
