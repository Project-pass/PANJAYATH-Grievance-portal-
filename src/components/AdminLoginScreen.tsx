import React, { useState } from 'react';
import { KeyRound, Landmark, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { useAuth } from '../context/PortalContext';

export function AdminLoginScreen() {
  const { portalState, loginWithCredentials, setPortalMode } = useAuth();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const demoAccounts = portalState.staff.filter((s) =>
    ['stf-secretary', 'stf-rahul', 'stf-anitha', 'stf-deepak'].includes(s.id)
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = loginWithCredentials(email, pin);
    if (!res.ok) {
      setError(res.error || 'Authentication failed.');
    } else {
      setError('');
    }
  }

  function handleAutofill(staffEmail: string, staffPin: string) {
    setEmail(staffEmail);
    setPin(staffPin);
    setError('');
  }

  return (
    <div className="min-h-[calc(100vh-44px)] bg-[#F8FAFC] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[960px] grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Left Official Login Form */}
        <div className="lg:col-span-6 p-6 sm:p-8 lg:p-10">
          <div className="flex items-center gap-2.5 text-[#1E3A8A]">
            <Landmark className="w-6 h-6" aria-hidden="true" />
            <span className="font-display text-lg font-bold">ABC Gram Panchayat</span>
          </div>

          <h1 className="mt-6 font-display text-2xl font-bold text-slate-900">
            Official Staff & Admin Sign In
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Authorized access for Panchayat Secretary, Ward Officers, and CSC Front-Desk Operators.
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Official Government Email
              </label>
              <input
                id="admin-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer@abcpanchayat.gov.in"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              />
            </div>

            <div>
              <label htmlFor="admin-pin" className="block text-sm font-medium text-slate-700 mb-1.5">
                4-Digit Staff Access PIN
              </label>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="admin-pin"
                  type="password"
                  maxLength={8}
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              <span>Sign In to Admin Workspace</span>
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Protected by Role-Based Access Control</span>
            <button
              type="button"
              onClick={() => {
                setPortalMode('citizen');
                window.history.replaceState({}, '', '/');
              }}
              className="text-[#1E3A8A] font-semibold hover:underline cursor-pointer"
            >
              Return to Citizen Portal
            </button>
          </div>
        </div>

        {/* Right Demo-Credential Autofill Panel */}
        <div className="lg:col-span-6 bg-[#F8FAFC] border-t lg:border-t-0 lg:border-l border-slate-200 p-6 sm:p-8 lg:p-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#059669]">
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              <span>Quick Demo-Credential Autofill</span>
            </div>
            <h2 className="mt-2 font-display text-lg font-bold text-slate-900">
              Test RBAC Roles Instantly
            </h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Click any official profile below to autofill credentials, or sign in directly to test
              ward filtering, certificate approval guards, and permission management.
            </p>

            <div className="mt-5 space-y-2.5">
              {demoAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="bg-white border border-slate-200 rounded-lg p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">{acc.name}</p>
                      <span className="text-[11px] font-mono text-slate-500">PIN: {acc.pin}</span>
                    </div>
                    <p className="text-xs text-slate-600 truncate">
                      {acc.designation} ·{' '}
                      {acc.assignedWards.length === 15
                        ? 'All Wards'
                        : `Wards ${acc.assignedWards[0]}–${acc.assignedWards[acc.assignedWards.length - 1]}`}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                      {acc.email}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAutofill(acc.email, acc.pin)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap cursor-pointer"
                    >
                      Autofill
                    </button>
                    <button
                      type="button"
                      onClick={() => loginWithCredentials(acc.email, acc.pin)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-md whitespace-nowrap cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Sign In</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-6 text-[11px] text-slate-500">
            Note: Suspended accounts are blocked from signing in. You can test account suspension
            and ward reassignment inside Access Control as Panchayat Secretary.
          </p>
        </div>
      </div>
    </div>
  );
}
