import './index.css';
import { bindAdminEvents, renderAdminPortal } from './adminPortal.js';
import { bindCitizenEvents, renderCitizenPortal } from './citizenPortal.js';
import { ICONS, esc } from './icons.js';
import {
  getCurrentUser,
  notify,
  refreshState,
  resetDemoData,
  store,
  subscribe,
  switchActiveRole,
} from './store.js';

function renderPortalSwitcherBar() {
  const user = getCurrentUser();
  const activeStaff = (store.portalState.staff || []).filter((s) => s.isActive);

  return `
    <div class="no-print bg-slate-900 text-slate-100 border-b border-slate-800">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 h-11 flex items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <span class="hidden md:inline text-slate-400 font-medium whitespace-nowrap">Preview Switcher:</span>
          <div class="flex items-center gap-1 p-0.5 bg-slate-800 rounded-md">
            <button type="button" data-portal-switch="citizen" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              store.portalMode === 'citizen' ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'
            }">
              ${ICONS.users('w-3.5 h-3.5')}
              <span>Citizen Portal (/)</span>
            </button>
            <button type="button" data-portal-switch="admin" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              store.portalMode === 'admin' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
            }">
              ${ICONS.shield('w-3.5 h-3.5')}
              <span>Admin Portal (/admin)</span>
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2.5 shrink-0">
          <label for="role-switcher-select" class="hidden sm:inline text-slate-400">Active Role:</label>
          <select id="role-switcher-select" class="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-md px-2.5 py-1 max-w-[200px] sm:max-w-[260px]">
            <option value="CITIZEN" ${!user ? 'selected' : ''}>Citizen (Public User)</option>
            ${activeStaff
              .map((s) => {
                const roleLabel =
                  s.role === 'SUPER_ADMIN'
                    ? 'Secretary (Super Admin)'
                    : s.role === 'WARD_OFFICER'
                      ? `Ward Officer (${s.department})`
                      : 'CSC Operator';
                return `<option value="${esc(s.id)}" ${user?.id === s.id ? 'selected' : ''}>${esc(s.name)} · ${esc(roleLabel)}</option>`;
              })
              .join('')}
          </select>
          <button type="button" id="btn-reset-demo" title="Reset seed data" class="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-slate-300 hover:text-white border border-slate-700 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer">
            ${ICONS.reset('w-3 h-3')}
            <span>Reset</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderApp() {
  const root = document.getElementById('app');
  if (!root) return;

  root.innerHTML = `
    <div class="min-h-screen flex flex-col">
      ${renderPortalSwitcherBar()}
      ${store.portalMode === 'citizen' ? renderCitizenPortal() : renderAdminPortal()}
    </div>
  `;

  root.querySelectorAll('[data-portal-switch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-portal-switch');
      store.portalMode = mode;
      window.history.replaceState({}, '', mode === 'admin' ? '/admin' : '/');
      notify();
    });
  });

  root.querySelector('#role-switcher-select')?.addEventListener('change', (e) => {
    switchActiveRole(e.target.value);
  });

  root.querySelector('#btn-reset-demo')?.addEventListener('click', async () => {
    await resetDemoData();
  });

  if (store.portalMode === 'citizen') {
    bindCitizenEvents(root);
  } else {
    bindAdminEvents(root);
  }
}

subscribe(renderApp);
renderApp();
refreshState();
