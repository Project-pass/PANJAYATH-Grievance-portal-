import { useState } from 'react';
import { AdminPortal } from './components/AdminPortal';
import { CitizenPortal } from './components/CitizenPortal';
import { PortalSwitcherBar } from './components/PortalSwitcherBar';
import { PortalProvider, useAuth } from './context/PortalContext';
import { AdminView } from './types/portal';

function PortalShell() {
  const { portalMode } = useAuth();
  const [adminView, setAdminView] = useState<AdminView>(() =>
    window.location.pathname.includes('access-control') ? 'access-control' : 'overview'
  );

  return (
    <div className="min-h-screen flex flex-col">
      <PortalSwitcherBar onNavigateAdminView={setAdminView} />
      {portalMode === 'citizen' ? (
        <CitizenPortal />
      ) : (
        <AdminPortal activeView={adminView} setActiveView={setAdminView} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <PortalProvider>
      <PortalShell />
    </PortalProvider>
  );
}
