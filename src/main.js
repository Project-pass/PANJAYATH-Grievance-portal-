import './index.css';
import { bindAdminEvents, renderAdminPortal } from './adminPortal.js';
import { bindCitizenEvents, renderCitizenPortal } from './citizenPortal.js';
import { ICONS, esc } from './icons.js';
import {
  getCurrentUser,
  logoutStaff,
  notify,
  refreshPublicOverview,
  store,
  subscribe,
} from './store.js';

function renderPortalSwitcherBar() {
  const user = getCurrentUser();

  return `
    <div class="no-print bg-slate-900 text-slate-100 border-b border-slate-800">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 h-11 flex items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <span class="hidden md:inline text-slate-400 font-medium whitespace-nowrap">Portal Navigation:</span>
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
          ${
            user
              ? `<span class="hidden sm:inline text-emerald-300 font-medium truncate max-w-[240px]">${esc(user.name)} · ${esc(user.role)}</span>
                 <button type="button" id="btn-top-logout" class="inline-flex items-center gap-1 px-2.5 py-1 text-slate-200 hover:text-white border border-slate-700 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer">
                   ${ICONS.logout('w-3 h-3')}
                   <span>Sign Out</span>
                 </button>`
              : `<span class="text-slate-400">${store.portalMode === 'admin' ? 'Official Authentication Required' : 'Public Citizen Session'}</span>`
          }
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
      const mode = btn.getAttribute('data-portal-switch') === 'admin' ? 'admin' : 'citizen';
      store.portalMode = mode;
      window.history.replaceState({}, '', mode === 'admin' ? '/admin' : '/');
      notify();
    });
  });

  root.querySelector('#btn-top-logout')?.addEventListener('click', async () => {
    await logoutStaff();
  });

  if (store.portalMode === 'citizen') {
    bindCitizenEvents(root);
  } else {
    bindAdminEvents(root);
  }
}

subscribe(renderApp);
renderApp();
refreshPublicOverview();

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  let changed = false;
  if (store.selectedGrievanceId || store.selectedServiceId) {
    store.selectedGrievanceId = null;
    store.selectedServiceId = null;
    changed = true;
  }
  if (store.staffModalOpen) {
    store.staffModalOpen = false;
    changed = true;
  }
  if (store.walkInType) {
    store.walkInType = null;
    changed = true;
  }
  if (store.mobileMenuOpen || store.mobileSidebarOpen) {
    store.mobileMenuOpen = false;
    store.mobileSidebarOpen = false;
    changed = true;
  }
  if (changed) notify();
});
