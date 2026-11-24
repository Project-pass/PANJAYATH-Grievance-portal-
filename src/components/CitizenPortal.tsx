import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Award,
  Building2,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  Globe,
  Landmark,
  MapPin,
  Menu,
  Phone,
  Printer,
  Search,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/PortalContext';
import { CATEGORY_ML, t } from '../data/i18n';
import {
  ALL_WARDS,
  GRIEVANCE_CATEGORIES,
  IMG_HERO,
  IMG_ROAD_BEFORE,
  IMG_WATER_LEAK,
  SERVICE_CATALOG,
} from '../data/seedData';
import {
  CitizenView,
  GrievanceCategory,
  GrievanceTicket,
  ServiceApplication,
  ServiceCatalogItem,
} from '../types/portal';
import { downloadAcknowledgementReceipt, formatDateTime, formatShortDate } from '../utils/sla';
import { SlaBadge, StatusLabel } from './StatusBadge';

export function CitizenPortal() {
  const {
    portalState,
    language,
    setLanguage,
    submitGrievance,
    submitServiceApplication,
    submitGrievanceFeedback,
    setPortalMode,
  } = useAuth();

  const copy = t(language);
  const [activeView, setActiveView] = useState<CitizenView>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Grievance Form State
  const [gName, setGName] = useState('');
  const [gMobile, setGMobile] = useState('');
  const [gWard, setGWard] = useState<number>(1);
  const [gCategory, setGCategory] = useState<GrievanceCategory>('Water Supply');
  const [gLandmark, setGLandmark] = useState('');
  const [gDescription, setGDescription] = useState('');
  const [gPhotoUrl, setGPhotoUrl] = useState<string>('');
  const [gError, setGError] = useState('');
  const [submittedGrievance, setSubmittedGrievance] = useState<GrievanceTicket | null>(null);

  // E-Services State
  const [selectedService, setSelectedService] = useState<ServiceCatalogItem | null>(null);
  const [sName, setSName] = useState('');
  const [sMobile, setSMobile] = useState('');
  const [sWard, setSWard] = useState<number>(1);
  const [sAddress, setSAddress] = useState('');
  const [sCheckedDocs, setSCheckedDocs] = useState<string[]>([]);
  const [sUploadedFiles, setSUploadedFiles] = useState<string[]>([]);
  const [sError, setSError] = useState('');
  const [submittedService, setSubmittedService] = useState<ServiceApplication | null>(null);

  // Live Tracker State
  const [trackQuery, setTrackQuery] = useState('ABC-GRV-2026-101');
  const [ratingValue, setRatingValue] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState('');

  // Transparency Counters computed live
  const stats = useMemo(() => {
    const resolved = portalState.grievances.filter((g) => g.status === 'Resolved');
    const totalAvgDays = resolved.reduce((acc, g) => {
      if (!g.resolvedAt) return acc + 3;
      const diff =
        (new Date(g.resolvedAt).getTime() - new Date(g.createdAt).getTime()) /
        (1000 * 60 * 60 * 24);
      return acc + Math.max(1, diff);
    }, 0);
    const avgDays = resolved.length > 0 ? (totalAvgDays / resolved.length).toFixed(1) : '3.2';

    const rated = portalState.grievances.filter((g) => typeof g.rating === 'number');
    const avgRating =
      rated.length > 0
        ? (rated.reduce((sum, g) => sum + (g.rating ?? 0), 0) / rated.length).toFixed(1)
        : '4.6';

    return {
      resolvedCount: resolved.length + 142, // historical baseline + live resolved
      avgDays,
      activeServicesCount: SERVICE_CATALOG.length,
      avgRating,
    };
  }, [portalState.grievances]);

  const trackedRecord = useMemo(() => {
    const q = trackQuery.trim().toUpperCase();
    if (!q) return null;
    const grv = portalState.grievances.find((g) => g.id.toUpperCase() === q);
    if (grv) return { kind: 'grievance' as const, data: grv };
    const srv = portalState.services.find((s) => s.id.toUpperCase() === q);
    if (srv) return { kind: 'service' as const, data: srv };
    return null;
  }, [trackQuery, portalState.grievances, portalState.services]);

  function navigateTo(view: CitizenView) {
    setActiveView(view);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openTrackerFor(id: string) {
    setTrackQuery(id);
    navigateTo('track');
  }

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setGPhotoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleGrievanceSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gName.trim() || !/^\d{10}$/.test(gMobile.trim()) || !gLandmark.trim() || !gDescription.trim()) {
      setGError('Please enter valid full name, 10-digit mobile number, landmark, and description.');
      return;
    }
    setGError('');
    const created = submitGrievance({
      citizenName: gName,
      mobile: gMobile,
      ward: gWard,
      category: gCategory,
      landmark: gLandmark,
      description: gDescription,
      beforePhotoUrl: gPhotoUrl || undefined,
    });
    setSubmittedGrievance(created);
    setGName('');
    setGMobile('');
    setGLandmark('');
    setGDescription('');
    setGPhotoUrl('');
  }

  function handleSelectService(item: ServiceCatalogItem) {
    setSelectedService(item);
    setSubmittedService(null);
    setSCheckedDocs([]);
    setSUploadedFiles([]);
    setSError('');
  }

  function handleServiceDocToggle(doc: string) {
    setSCheckedDocs((prev) =>
      prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc]
    );
  }

  function handleServiceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const names = Array.from(files).map((f) => f.name);
    setSUploadedFiles((prev) => [...prev, ...names]);
  }

  function handleServiceSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedService) return;
    if (!sName.trim() || !/^\d{10}$/.test(sMobile.trim()) || !sAddress.trim()) {
      setSError('Please complete applicant name, 10-digit mobile number, and residential address.');
      return;
    }
    if (sCheckedDocs.length === 0) {
      setSError('Please confirm at least one required document in the checklist.');
      return;
    }
    setSError('');
    const created = submitServiceApplication({
      serviceId: selectedService.id,
      applicantName: sName,
      mobile: sMobile,
      ward: sWard,
      address: sAddress,
      checkedDocs: sCheckedDocs,
      uploadedDocNames: sUploadedFiles,
    });
    setSubmittedService(created);
    setSName('');
    setSMobile('');
    setSAddress('');
    setSCheckedDocs([]);
    setSUploadedFiles([]);
  }

  const sampleTrackerIds = [
    ...portalState.grievances.slice(0, 3).map((g) => g.id),
    ...portalState.services.slice(0, 2).map((s) => s.id),
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Three-Zone Top Bar Contract */}
      <header className="no-print bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark only */}
          <button
            type="button"
            onClick={() => navigateTo('home')}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A] rounded"
          >
            <Landmark className="w-6 h-6 text-[#1E3A8A] shrink-0" aria-hidden="true" />
            <span className="font-display text-lg font-bold tracking-tight text-[#1E3A8A]">
              {copy.brandName}
            </span>
          </button>

          {/* Zone 2: 4 single-line text nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => navigateTo('home')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeView === 'home'
                  ? 'text-[#1E3A8A] border-[#1E3A8A] font-semibold'
                  : 'border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {copy.navHome}
            </button>
            <button
              type="button"
              onClick={() => {
                setSubmittedGrievance(null);
                navigateTo('grievance');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeView === 'grievance'
                  ? 'text-[#1E3A8A] border-[#1E3A8A] font-semibold'
                  : 'border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {copy.navGrievance}
            </button>
            <button
              type="button"
              onClick={() => {
                setSubmittedService(null);
                navigateTo('services');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeView === 'services'
                  ? 'text-[#1E3A8A] border-[#1E3A8A] font-semibold'
                  : 'border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {copy.navServices}
            </button>
            <button
              type="button"
              onClick={() => navigateTo('track')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeView === 'track'
                  ? 'text-[#1E3A8A] border-[#1E3A8A] font-semibold'
                  : 'border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {copy.navTrack}
            </button>
          </nav>

          {/* Zone 3: 1 primary action (EN / Malayalam toggle) + Mobile drawer trigger */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setLanguage(language === 'en' ? 'ml' : 'en')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1E3A8A]"
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{copy.langToggle}</span>
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle citizen navigation menu"
              className="md:hidden p-2.5 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
            {(
              [
                ['home', copy.navHome],
                ['grievance', copy.navGrievance],
                ['services', copy.navServices],
                ['track', copy.navTrack],
              ] as [CitizenView, string][]
            ).map(([viewKey, label]) => (
              <button
                key={viewKey}
                type="button"
                onClick={() => navigateTo(viewKey)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
                  activeView === viewKey
                    ? 'bg-indigo-50 text-[#1E3A8A] font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Live Notice Ticker */}
      <div className="no-print bg-[#1E3A8A] text-white border-b border-indigo-900 overflow-hidden">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-9 flex items-center gap-4">
          <span className="text-xs font-semibold tracking-wide text-emerald-300 whitespace-nowrap shrink-0">
            {copy.tickerLabel}:
          </span>
          <div className="overflow-hidden flex-1">
            <div className="animate-ticker text-xs text-slate-100 flex items-center gap-12">
              {[...copy.notices, ...copy.notices].map((notice, idx) => (
                <span key={idx} className="whitespace-nowrap">
                  {notice}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Viewport */}
      <main className="flex-1">
        {activeView === 'home' && (
          <div>
            {/* Hero Section */}
            <section className="bg-white border-b border-slate-200">
              <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 lg:py-14">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
                  {/* Left Hero Copy */}
                  <div className="lg:col-span-7 flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-semibold text-[#059669] mb-2">
                        {copy.heroKicker}
                      </p>
                      <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.6rem] font-bold text-slate-900 leading-[1.15] tracking-tight text-balance">
                        {copy.heroTitle}
                      </h1>
                      <p className="mt-4 text-base text-slate-600 leading-relaxed max-w-2xl">
                        {copy.heroDesc}
                      </p>

                      <div className="mt-7 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSubmittedGrievance(null);
                            navigateTo('grievance');
                          }}
                          className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <span>{copy.heroCtaPrimary}</span>
                          <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigateTo('track')}
                          className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-[#1E3A8A] bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Search className="w-4 h-4" aria-hidden="true" />
                          <span>{copy.heroCtaSecondary}</span>
                        </button>
                      </div>
                    </div>

                    {/* Emergency Helpline Ribbon */}
                    <div className="mt-8 pt-6 border-t border-slate-200">
                      <p className="text-xs font-semibold text-slate-500 mb-2.5">
                        {copy.emergencyTitle}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-700 font-mono tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-[#059669]" aria-hidden="true" />
                          Panchayat Helpdesk: <strong className="text-slate-900">0484-245-1900</strong>
                        </span>
                        <span>·</span>
                        <span>
                          Water Emergency: <strong className="text-slate-900">1916</strong>
                        </span>
                        <span>·</span>
                        <span>
                          Police: <strong className="text-slate-900">100</strong>
                        </span>
                        <span>·</span>
                        <span>
                          Ambulance: <strong className="text-slate-900">108</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right Hero Civic Architecture Image */}
                  <div className="lg:col-span-5 flex flex-col">
                    <div className="relative flex-1 min-h-[260px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                      <img
                        src={IMG_HERO}
                        alt="ABC Gram Panchayat Office Building and Civic Courtyard"
                        referrerPolicy="no-referrer"
                        className="w-full h-full lg:h-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/45 to-transparent p-4 text-white">
                        <p className="text-xs font-medium text-emerald-300">
                          {copy.brandSubtitle}
                        </p>
                        <p className="text-sm font-semibold mt-0.5">
                          ABC Gram Panchayat Bhavan · Office Hours 10:00 AM – 5:00 PM
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Full-width 4-Column Transparency Counters */}
                <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-5">
                    <p className="text-xs font-medium text-slate-500">{copy.statsResolved}</p>
                    <p className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#1E3A8A]">
                      {stats.resolvedCount}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">FY 2026–27 across 15 wards</p>
                  </div>
                  <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-5">
                    <p className="text-xs font-medium text-slate-500">{copy.statsAvgTime}</p>
                    <p className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#059669]">
                      {stats.avgDays} {copy.daysUnit}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Against {portalState.slaLimitDays}-day SLA mandate
                    </p>
                  </div>
                  <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-5">
                    <p className="text-xs font-medium text-slate-500">{copy.statsActiveServices}</p>
                    <p className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900">
                      {stats.activeServicesCount}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Certificates & Permits online</p>
                  </div>
                  <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-5">
                    <p className="text-xs font-medium text-slate-500">{copy.statsSatisfaction}</p>
                    <p className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900">
                      {stats.avgRating} / 5.0
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Verified citizen feedback</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Quick-Action Cards */}
            <section className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
              <div className="mb-8">
                <h2 className="font-display text-2xl font-bold text-slate-900 text-balance">
                  {copy.quickActionsTitle}
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
                  {copy.quickActionsSubtitle}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
                  <div>
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 text-[#1E3A8A] flex items-center justify-center mb-4">
                      <AlertCircle className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <h3 className="font-display text-lg font-semibold text-slate-900">
                      {copy.qaGrievanceTitle}
                    </h3>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                      {copy.qaGrievanceDesc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSubmittedGrievance(null);
                      navigateTo('grievance');
                    }}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer"
                  >
                    <span>{copy.qaGrievanceBtn}</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
                  <div>
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 text-[#059669] flex items-center justify-center mb-4">
                      <FileText className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <h3 className="font-display text-lg font-semibold text-slate-900">
                      {copy.qaServiceTitle}
                    </h3>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                      {copy.qaServiceDesc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSubmittedService(null);
                      navigateTo('services');
                    }}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors cursor-pointer"
                  >
                    <span>{copy.qaServiceBtn}</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
                  <div>
                    <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center mb-4">
                      <Search className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <h3 className="font-display text-lg font-semibold text-slate-900">
                      {copy.qaTrackTitle}
                    </h3>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                      {copy.qaTrackDesc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateTo('track')}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <span>{copy.qaTrackBtn}</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </section>

            {/* Public Transparency Spotlight */}
            <section className="max-w-[1200px] mx-auto px-4 sm:px-6 pb-14">
              <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">
                      Recent Civic Redressal Log
                    </h2>
                    <p className="text-sm text-slate-600 mt-0.5">
                      Inspect live field action across Wards 1–15 by clicking any tracking ID.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateTo('track')}
                    className="text-sm font-semibold text-[#1E3A8A] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    View all in Status Tracker
                  </button>
                </div>

                <div className="divide-y divide-slate-200">
                  {portalState.grievances.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <button
                            type="button"
                            onClick={() => openTrackerFor(item.id)}
                            className="font-mono font-semibold text-[#1E3A8A] hover:underline cursor-pointer"
                          >
                            {item.id}
                          </button>
                          <span aria-hidden="true">·</span>
                          <span>Ward {item.ward}</span>
                          <span aria-hidden="true">·</span>
                          <span>{language === 'ml' ? CATEGORY_ML[item.category] : item.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatShortDate(item.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-900 truncate">
                          {item.landmark} — {item.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <SlaBadge
                          createdAt={item.createdAt}
                          status={item.status}
                          slaLimitDays={portalState.slaLimitDays}
                        />
                        <StatusLabel status={item.status} lang={language} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* VIEW 2: LODGE GRIEVANCE */}
        {activeView === 'grievance' && (
          <section className="max-w-[900px] mx-auto px-4 sm:px-6 py-10">
            {submittedGrievance ? (
              <div className="print-only-slip bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-slate-200">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 text-[#059669] flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="font-display text-xl font-bold text-slate-900">
                        {copy.ackTitle}
                      </h2>
                      <p className="text-sm text-slate-600 mt-0.5">{copy.ackSub}</p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-slate-500">Tracking ID</p>
                    <p className="font-mono text-xl font-bold text-[#1E3A8A] tabular-nums">
                      {submittedGrievance.id}
                    </p>
                  </div>
                </div>

                <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Citizen Name</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {submittedGrievance.citizenName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Mobile Number</dt>
                    <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                      {submittedGrievance.mobile}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Ward & Category</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      Ward {submittedGrievance.ward} · {submittedGrievance.category}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Routed Department</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {submittedGrievance.department}
                      {submittedGrievance.assignedOfficerName
                        ? ` (${submittedGrievance.assignedOfficerName})`
                        : ''}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-slate-500">Landmark & Description</dt>
                    <dd className="text-slate-800 mt-0.5">
                      <strong>{submittedGrievance.landmark}:</strong> {submittedGrievance.description}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Registered At</dt>
                    <dd className="font-mono tabular-nums text-slate-700 mt-0.5">
                      {formatDateTime(submittedGrievance.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">SLA Deadline</dt>
                    <dd className="font-mono tabular-nums text-slate-700 mt-0.5">
                      Within {portalState.slaLimitDays} Days
                    </dd>
                  </div>
                </dl>

                <div className="no-print mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer"
                  >
                    <Printer className="w-4 h-4" aria-hidden="true" />
                    <span>{copy.printSlip}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadAcknowledgementReceipt({ kind: 'grievance', data: submittedGrievance })
                    }
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    <span>{copy.downloadSlip}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openTrackerFor(submittedGrievance.id)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#059669] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                  >
                    <Search className="w-4 h-4" aria-hidden="true" />
                    <span>{copy.trackThisNow}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmittedGrievance(null)}
                    className="ml-auto text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    {copy.submitAnother}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  {copy.formGrievanceTitle}
                </h1>
                <p className="mt-1.5 text-sm text-slate-600">{copy.formGrievanceSub}</p>

                {gError && (
                  <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                    {gError}
                  </div>
                )}

                <form onSubmit={handleGrievanceSubmit} className="mt-6 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="grv-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                        {copy.citizenName} *
                      </label>
                      <input
                        id="grv-name"
                        type="text"
                        required
                        value={gName}
                        onChange={(e) => setGName(e.target.value)}
                        placeholder="e.g. Suresh Nair"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                    <div>
                      <label htmlFor="grv-mobile" className="block text-sm font-medium text-slate-700 mb-1.5">
                        {copy.mobileNumber} *
                      </label>
                      <input
                        id="grv-mobile"
                        type="tel"
                        maxLength={10}
                        required
                        value={gMobile}
                        onChange={(e) => setGMobile(e.target.value.replace(/\D/g, ''))}
                        placeholder="9847000000"
                        className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="grv-ward" className="block text-sm font-medium text-slate-700 mb-1.5">
                        {copy.wardSelection} *
                      </label>
                      <select
                        id="grv-ward"
                        value={gWard}
                        onChange={(e) => setGWard(Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      >
                        {ALL_WARDS.map((w) => (
                          <option key={w} value={w}>
                            Ward {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="grv-category" className="block text-sm font-medium text-slate-700 mb-1.5">
                        {copy.categoryLabel} *
                      </label>
                      <select
                        id="grv-category"
                        value={gCategory}
                        onChange={(e) => setGCategory(e.target.value as GrievanceCategory)}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      >
                        {GRIEVANCE_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {language === 'ml' ? `${cat} (${CATEGORY_ML[cat]})` : cat}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="grv-landmark" className="block text-sm font-medium text-slate-700 mb-1.5">
                      {copy.landmarkLabel} *
                    </label>
                    <input
                      id="grv-landmark"
                      type="text"
                      required
                      value={gLandmark}
                      onChange={(e) => setGLandmark(e.target.value)}
                      placeholder="e.g. Near Anganwadi No. 2, Main Cross Road"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                  </div>

                  <div>
                    <label htmlFor="grv-desc" className="block text-sm font-medium text-slate-700 mb-1.5">
                      {copy.descriptionLabel} *
                    </label>
                    <textarea
                      id="grv-desc"
                      rows={4}
                      required
                      value={gDescription}
                      onChange={(e) => setGDescription(e.target.value)}
                      placeholder="Describe the exact problem, duration, and impact..."
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      {copy.photoLabel}
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer">
                        <Upload className="w-4 h-4" aria-hidden="true" />
                        <span>Upload Photo File</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoUpload}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setGPhotoUrl(IMG_ROAD_BEFORE)}
                        className="px-3 py-2 text-xs font-medium text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer"
                      >
                        Use Sample Road Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => setGPhotoUrl(IMG_WATER_LEAK)}
                        className="px-3 py-2 text-xs font-medium text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer"
                      >
                        Use Sample Pipe Leak Photo
                      </button>
                    </div>
                    {gPhotoUrl && (
                      <div className="mt-3 relative inline-block">
                        <img
                          src={gPhotoUrl}
                          alt="Uploaded grievance evidence preview"
                          referrerPolicy="no-referrer"
                          className="w-56 h-36 object-cover rounded-lg border border-slate-200"
                        />
                        <button
                          type="button"
                          onClick={() => setGPhotoUrl('')}
                          aria-label="Remove attached photo"
                          className="absolute -top-2 -right-2 p-1 bg-slate-900 text-white rounded-full cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => navigateTo('home')}
                      className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer"
                    >
                      {copy.submitGrievanceBtn}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </section>
        )}

        {/* VIEW 3: CITIZEN E-SERVICES & CERTIFICATES */}
        {activeView === 'services' && (
          <section className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10">
            <div className="mb-8">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
                {copy.servicesPageTitle}
              </h1>
              <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">{copy.servicesPageSub}</p>
            </div>

            {submittedService ? (
              <div className="print-only-slip max-w-3xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-slate-200">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 text-[#059669] flex items-center justify-center shrink-0">
                      <Award className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="font-display text-xl font-bold text-slate-900">
                        {copy.ackTitle}
                      </h2>
                      <p className="text-sm text-slate-600 mt-0.5">
                        {submittedService.serviceName} · {submittedService.department}
                      </p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-slate-500">Application Tracking ID</p>
                    <p className="font-mono text-xl font-bold text-[#1E3A8A] tabular-nums">
                      {submittedService.id}
                    </p>
                  </div>
                </div>

                <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Applicant Name</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {submittedService.applicantName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Ward & Mobile</dt>
                    <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                      Ward {submittedService.ward} · {submittedService.mobile}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Statutory Fee</dt>
                    <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                      {submittedService.feeInr === 0
                        ? copy.freeLabel
                        : `INR ${submittedService.feeInr}.00`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Submitted At</dt>
                    <dd className="font-mono tabular-nums text-slate-700 mt-0.5">
                      {formatDateTime(submittedService.createdAt)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-slate-500">Confirmed Document Checklist</dt>
                    <dd className="mt-1 text-slate-800">
                      {submittedService.checkedDocs.join(' · ')}
                    </dd>
                  </div>
                </dl>

                <div className="no-print mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer"
                  >
                    <Printer className="w-4 h-4" aria-hidden="true" />
                    <span>{copy.printSlip}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadAcknowledgementReceipt({ kind: 'service', data: submittedService })
                    }
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    <span>{copy.downloadSlip}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openTrackerFor(submittedService.id)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#059669] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                  >
                    <Search className="w-4 h-4" aria-hidden="true" />
                    <span>{copy.trackThisNow}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSubmittedService(null);
                      setSelectedService(null);
                    }}
                    className="ml-auto text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Back to Service Catalog
                  </button>
                </div>
              </div>
            ) : selectedService ? (
              <div className="max-w-3xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
                <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
                  <div>
                    <p className="text-xs font-medium text-[#059669]">
                      {selectedService.department} · SLA {selectedService.slaDays} {copy.daysUnit}
                    </p>
                    <h2 className="font-display text-xl font-bold text-slate-900 mt-1">
                      {language === 'ml' ? selectedService.titleMl : selectedService.titleEn}
                    </h2>
                    <p className="text-sm text-slate-600 mt-1">
                      {language === 'ml'
                        ? selectedService.descriptionMl
                        : selectedService.descriptionEn}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-500">{copy.feeLabel}</p>
                    <p className="font-mono text-lg font-bold text-[#1E3A8A] tabular-nums">
                      {selectedService.feeInr === 0 ? copy.freeLabel : `₹${selectedService.feeInr}`}
                    </p>
                  </div>
                </div>

                {sError && (
                  <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                    {sError}
                  </div>
                )}

                <form onSubmit={handleServiceSubmit} className="mt-6 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="srv-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                        Applicant Full Name *
                      </label>
                      <input
                        id="srv-name"
                        type="text"
                        required
                        value={sName}
                        onChange={(e) => setSName(e.target.value)}
                        placeholder="e.g. Kavitha Krishnan"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                    <div>
                      <label htmlFor="srv-mobile" className="block text-sm font-medium text-slate-700 mb-1.5">
                        {copy.mobileNumber} *
                      </label>
                      <input
                        id="srv-mobile"
                        type="tel"
                        maxLength={10}
                        required
                        value={sMobile}
                        onChange={(e) => setSMobile(e.target.value.replace(/\D/g, ''))}
                        placeholder="9447000000"
                        className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    <div>
                      <label htmlFor="srv-ward" className="block text-sm font-medium text-slate-700 mb-1.5">
                        Ward *
                      </label>
                      <select
                        id="srv-ward"
                        value={sWard}
                        onChange={(e) => setSWard(Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      >
                        {ALL_WARDS.map((w) => (
                          <option key={w} value={w}>
                            Ward {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="srv-address" className="block text-sm font-medium text-slate-700 mb-1.5">
                        House Name / Door Number & Address *
                      </label>
                      <input
                        id="srv-address"
                        type="text"
                        required
                        value={sAddress}
                        onChange={(e) => setSAddress(e.target.value)}
                        placeholder="House No. 4/112, Temple Road, ABC Gram Panchayat"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  <div className="bg-[#F8FAFC] border border-slate-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-slate-900 mb-3">
                      {copy.requiredDocsTitle}
                    </p>
                    <div className="space-y-2.5">
                      {selectedService.requiredDocsEn.map((doc, i) => {
                        const label =
                          language === 'ml' ? selectedService.requiredDocsMl[i] || doc : doc;
                        return (
                          <label key={doc} className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sCheckedDocs.includes(doc)}
                              onChange={() => handleServiceDocToggle(doc)}
                              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#1E3A8A] focus:ring-[#1E3A8A]"
                            />
                            <span>{label}</span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <p className="text-xs font-medium text-slate-600 mb-2">
                        {copy.uploadDocsTitle}
                      </p>
                      <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Select PDF / Image Files</span>
                        <input
                          type="file"
                          multiple
                          accept=".pdf,image/*"
                          onChange={handleServiceFileChange}
                          className="hidden"
                        />
                      </label>
                      {sUploadedFiles.length > 0 && (
                        <p className="mt-2 text-xs font-mono text-emerald-700">
                          Attached: {sUploadedFiles.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedService(null)}
                      className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Back to Catalog
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors cursor-pointer"
                    >
                      {copy.submitServiceBtn}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {SERVICE_CATALOG.map((service) => (
                  <div
                    key={service.id}
                    className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{service.department}</span>
                        <span className="font-mono tabular-nums">
                          {service.slaDays} {copy.daysUnit} SLA
                        </span>
                      </div>
                      <h2 className="mt-2 font-display text-lg font-bold text-slate-900">
                        {language === 'ml' ? service.titleMl : service.titleEn}
                      </h2>
                      <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                        {language === 'ml' ? service.descriptionMl : service.descriptionEn}
                      </p>
                      <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600">
                        <span className="font-medium text-slate-500">{copy.feeLabel}: </span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {service.feeInr === 0 ? copy.freeLabel : `₹${service.feeInr}`}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectService(service)}
                      className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer"
                    >
                      <span>{copy.applyNowBtn}</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* VIEW 4: LIVE STATUS TRACKER */}
        {activeView === 'track' && (
          <section className="max-w-[1000px] mx-auto px-4 sm:px-6 py-10">
            <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
              <h1 className="font-display text-2xl font-bold text-slate-900">
                {copy.trackerTitle}
              </h1>
              <p className="mt-1.5 text-sm text-slate-600">{copy.trackerSub}</p>

              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={trackQuery}
                    onChange={(e) => setTrackQuery(e.target.value)}
                    placeholder={copy.trackerPlaceholder}
                    className="w-full pl-10 pr-4 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setTrackQuery((q) => q.trim())}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copy.searchBtn}
                </button>
              </div>

              {/* Pre-populated clickable sample IDs */}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">{copy.sampleIdsLabel}</span>
                {sampleTrackerIds.map((sampleId) => (
                  <button
                    key={sampleId}
                    type="button"
                    onClick={() => setTrackQuery(sampleId)}
                    className={`px-2.5 py-1 font-mono rounded border transition-colors cursor-pointer ${
                      trackQuery.trim().toUpperCase() === sampleId
                        ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {sampleId}
                  </button>
                ))}
              </div>
            </div>

            {/* Tracked Result Card */}
            {trackedRecord ? (
              <div className="mt-6 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-8">
                {/* Summary Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-slate-200">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-[#1E3A8A]">
                        {trackedRecord.data.id}
                      </span>
                      <span>·</span>
                      <span>Ward {trackedRecord.data.ward}</span>
                      <span>·</span>
                      <span>{trackedRecord.data.department}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">
                        Filed {formatShortDate(trackedRecord.data.createdAt)}
                      </span>
                    </div>
                    <h2 className="mt-2 font-display text-xl font-bold text-slate-900">
                      {trackedRecord.kind === 'grievance'
                        ? `${trackedRecord.data.category} — ${trackedRecord.data.landmark}`
                        : trackedRecord.data.serviceName}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {trackedRecord.kind === 'grievance'
                        ? trackedRecord.data.description
                        : `Applicant: ${trackedRecord.data.applicantName} · ${trackedRecord.data.address}`}
                    </p>
                  </div>

                  <div className="flex flex-col items-start sm:items-end gap-2">
                    <StatusLabel status={trackedRecord.data.status} lang={language} />
                    <SlaBadge
                      createdAt={trackedRecord.data.createdAt}
                      status={trackedRecord.data.status}
                      slaLimitDays={portalState.slaLimitDays}
                    />
                  </div>
                </div>

                {/* Assigned Officer & Remarks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 text-sm">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Assigned Officer & Dept</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {trackedRecord.data.assignedOfficerName || 'Pending Desk Assignment'} ·{' '}
                      {trackedRecord.data.department}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Latest Official Remark</p>
                    <p className="mt-1 text-slate-800">
                      {(trackedRecord.kind === 'grievance'
                        ? trackedRecord.data.publicRemark
                        : trackedRecord.data.officialRemark) || 'Awaiting officer update.'}
                    </p>
                  </div>
                </div>

                {/* Vertical Timeline Stepper */}
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900 mb-4">
                    {copy.timelineHeading}
                  </h3>
                  <ol className="relative space-y-6 pl-6 before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200">
                    {trackedRecord.data.timeline.map((step, idx) => {
                      const isLast = idx === trackedRecord.data.timeline.length - 1;
                      return (
                        <li key={step.id} className="relative">
                          <span
                            className={`absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center border ${
                              isLast
                                ? 'bg-[#059669] border-[#059669] text-white'
                                : 'bg-white border-slate-300 text-slate-500'
                            }`}
                          >
                            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                          </span>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">{step.stepTitle}</p>
                            <span className="text-xs font-mono tabular-nums text-slate-500">
                              {formatDateTime(step.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{step.actor}</p>
                          <p className="text-sm text-slate-700 mt-1">{step.remark}</p>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {/* Before / After Resolution Photos (if available on Grievance) */}
                {trackedRecord.kind === 'grievance' &&
                  (trackedRecord.data.beforePhotoUrl || trackedRecord.data.afterPhotoUrl) && (
                    <div className="pt-6 border-t border-slate-200">
                      <h3 className="font-display text-base font-bold text-slate-900 mb-4">
                        {copy.beforeAfterHeading}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        {trackedRecord.data.beforePhotoUrl && (
                          <div>
                            <p className="text-xs font-semibold text-slate-600 mb-2">
                              {copy.beforeLabel}
                            </p>
                            <img
                              src={trackedRecord.data.beforePhotoUrl}
                              alt="Citizen reported issue photo"
                              referrerPolicy="no-referrer"
                              className="w-full h-56 object-cover rounded-lg border border-slate-200"
                            />
                          </div>
                        )}
                        {trackedRecord.data.afterPhotoUrl && (
                          <div>
                            <p className="text-xs font-semibold text-[#059669] mb-2">
                              {copy.afterLabel}
                            </p>
                            <img
                              src={trackedRecord.data.afterPhotoUrl}
                              alt="Officer verified resolution proof"
                              referrerPolicy="no-referrer"
                              className="w-full h-56 object-cover rounded-lg border border-emerald-200"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {/* Citizen 1-5 Star Feedback Rating on Resolved Grievances */}
                {trackedRecord.kind === 'grievance' && trackedRecord.data.status === 'Resolved' && (
                  <div className="pt-6 border-t border-slate-200">
                    <h3 className="font-display text-base font-bold text-slate-900">
                      {copy.feedbackHeading}
                    </h3>
                    {trackedRecord.data.rating ? (
                      <div className="mt-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-emerald-900">
                            {copy.feedbackSaved}
                          </p>
                          {trackedRecord.data.feedbackComment && (
                            <p className="text-xs text-emerald-800 mt-1">
                              “{trackedRecord.data.feedbackComment}”
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-amber-500">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`w-4 h-4 ${
                                star <= (trackedRecord.data.rating ?? 0)
                                  ? 'fill-amber-400 text-amber-500'
                                  : 'text-slate-300'
                              }`}
                            />
                          ))}
                          <span className="ml-1.5 text-xs font-mono font-bold text-slate-800">
                            {trackedRecord.data.rating}/5
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 space-y-3">
                        <p className="text-sm text-slate-600">{copy.feedbackDesc}</p>
                        <div className="flex items-center gap-1.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setRatingValue(star)}
                              aria-label={`Rate ${star} out of 5 stars`}
                              className="p-1 cursor-pointer"
                            >
                              <Star
                                className={`w-6 h-6 transition-colors ${
                                  star <= ratingValue
                                    ? 'fill-amber-400 text-amber-500'
                                    : 'text-slate-300 hover:text-amber-400'
                                }`}
                              />
                            </button>
                          ))}
                          <span className="ml-2 text-xs font-mono text-slate-600">
                            {ratingValue} / 5
                          </span>
                        </div>
                        <input
                          type="text"
                          value={ratingComment}
                          onChange={(e) => setRatingComment(e.target.value)}
                          placeholder="Optional citizen comment..."
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            submitGrievanceFeedback(
                              trackedRecord.data.id,
                              ratingValue,
                              ratingComment
                            );
                            setRatingComment('');
                          }}
                          className="px-4 py-2 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg cursor-pointer"
                        >
                          {copy.submitFeedbackBtn}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 bg-white border border-slate-200 rounded-xl p-8 text-center">
                <ClipboardList className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700">{copy.noRecordFound}</p>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Clean Civic Footer */}
      <footer className="no-print bg-white border-t border-slate-200 mt-auto">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="w-4 h-4 text-[#1E3A8A]" aria-hidden="true" />
            <span className="font-semibold text-slate-800">{copy.brandName}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              Panchayat Bhavan, Main Road, Kerala 682001
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setPortalMode('admin');
                window.history.replaceState({}, '', '/admin');
              }}
              className="text-[#1E3A8A] font-medium hover:underline cursor-pointer"
            >
              Official Staff Login
            </button>
            <span>·</span>
            <span>© 2026 ABC Gram Panchayat</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
