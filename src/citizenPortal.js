import {
  ALL_WARDS,
  CATEGORY_ML,
  GRIEVANCE_CATEGORIES,
  IMG_HERO,
  IMG_ROAD_BEFORE,
  IMG_WATER_LEAK,
  SERVICE_CATALOG,
  STATUS_ML,
  TRANSLATIONS,
} from './i18n.js';
import {
  ICONS,
  downloadReceipt,
  esc,
  formatDateTime,
  formatShortDate,
  renderSlaBadge,
  renderStatusLabel,
} from './icons.js';
import {
  notify,
  store,
  submitFeedback,
  submitGrievance,
  submitServiceApplication,
  trackApplication,
} from './store.js';

function renderHomeView(copy) {
  const stats = store.publicOverview.stats || {
    resolvedCount: 145,
    avgDays: '3.2',
    activeServicesCount: 6,
    avgRating: '4.6',
  };
  const lang = store.language;
  const recent = (store.publicOverview.recentWorks || []).slice(0, 5);
  const slaLimit = store.publicOverview.slaLimitDays || 7;

  return `
    <div>
      <section class="bg-white border-b border-slate-200">
        <div class="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 lg:py-14">
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
            <div class="lg:col-span-7 flex flex-col justify-between">
              <div>
                <p class="text-xs font-semibold text-[#059669] mb-2">${esc(copy.heroKicker)}</p>
                <h1 class="font-display text-3xl sm:text-4xl lg:text-[2.6rem] font-bold text-slate-900 leading-[1.15] tracking-tight text-balance">
                  ${esc(copy.heroTitle)}
                </h1>
                <p class="mt-4 text-base text-slate-600 leading-relaxed max-w-2xl">
                  ${esc(copy.heroDesc)}
                </p>
                <div class="mt-7 flex flex-wrap items-center gap-3">
                  <button type="button" data-cnav="grievance" class="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer">
                    <span>${esc(copy.heroCtaPrimary)}</span>
                    ${ICONS.arrowRight('w-4 h-4')}
                  </button>
                  <button type="button" data-cnav="track" class="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-[#1E3A8A] bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer">
                    ${ICONS.search('w-4 h-4')}
                    <span>${esc(copy.heroCtaSecondary)}</span>
                  </button>
                </div>
              </div>

              <div class="mt-8 pt-6 border-t border-slate-200">
                <p class="text-xs font-semibold text-slate-500 mb-2.5">${esc(copy.emergencyTitle)}</p>
                <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-700 font-mono tabular-nums">
                  <span class="inline-flex items-center gap-1.5 text-[#059669]">
                    ${ICONS.phone('w-3.5 h-3.5')}
                    <span class="text-slate-700">Panchayat Helpdesk: <strong class="text-slate-900">0484-245-1900</strong></span>
                  </span>
                  <span>·</span>
                  <span>Water Emergency: <strong class="text-slate-900">1916</strong></span>
                  <span>·</span>
                  <span>Police: <strong class="text-slate-900">100</strong></span>
                  <span>·</span>
                  <span>Ambulance: <strong class="text-slate-900">108</strong></span>
                </div>
              </div>
            </div>

            <div class="lg:col-span-5 flex flex-col">
              <div class="relative flex-1 min-h-[260px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                <img src="${IMG_HERO}" alt="ABC Gram Panchayat Office Building and Civic Courtyard" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/45 to-transparent p-4 text-white">
                  <p class="text-xs font-medium text-emerald-300">${esc(copy.brandSubtitle)}</p>
                  <p class="text-sm font-semibold mt-0.5">ABC Gram Panchayat Bhavan · Office Hours 10:00 AM – 5:00 PM</p>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="bg-[#F8FAFC] border border-slate-200 rounded-xl p-5">
              <p class="text-xs font-medium text-slate-500">${esc(copy.statsResolved)}</p>
              <p class="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#1E3A8A]">${esc(stats.resolvedCount)}</p>
              <p class="mt-1 text-xs text-slate-500">FY 2026–27 across 15 wards</p>
            </div>
            <div class="bg-[#F8FAFC] border border-slate-200 rounded-xl p-5">
              <p class="text-xs font-medium text-slate-500">${esc(copy.statsAvgTime)}</p>
              <p class="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#059669]">${esc(stats.avgDays)} ${esc(copy.daysUnit)}</p>
              <p class="mt-1 text-xs text-slate-500">Against ${slaLimit}-day SLA mandate</p>
            </div>
            <div class="bg-[#F8FAFC] border border-slate-200 rounded-xl p-5">
              <p class="text-xs font-medium text-slate-500">${esc(copy.statsActiveServices)}</p>
              <p class="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900">${esc(stats.activeServicesCount)}</p>
              <p class="mt-1 text-xs text-slate-500">Certificates & Permits online</p>
            </div>
            <div class="bg-[#F8FAFC] border border-slate-200 rounded-xl p-5">
              <p class="text-xs font-medium text-slate-500">${esc(copy.statsSatisfaction)}</p>
              <p class="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900">${esc(stats.avgRating)} / 5.0</p>
              <p class="mt-1 text-xs text-slate-500">Verified citizen feedback</p>
            </div>
          </div>
        </div>
      </section>

      <section class="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
        <div class="mb-8">
          <h2 class="font-display text-2xl font-bold text-slate-900 text-balance">${esc(copy.quickActionsTitle)}</h2>
          <p class="mt-1.5 text-sm text-slate-600 max-w-2xl">${esc(copy.quickActionsSubtitle)}</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div class="w-10 h-10 rounded-lg bg-indigo-50 text-[#1E3A8A] flex items-center justify-center mb-4">${ICONS.alert('w-5 h-5')}</div>
              <h3 class="font-display text-lg font-semibold text-slate-900">${esc(copy.qaGrievanceTitle)}</h3>
              <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(copy.qaGrievanceDesc)}</p>
            </div>
            <button type="button" data-cnav="grievance" class="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer">
              <span>${esc(copy.qaGrievanceBtn)}</span>
              ${ICONS.arrowRight('w-4 h-4')}
            </button>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div class="w-10 h-10 rounded-lg bg-emerald-50 text-[#059669] flex items-center justify-center mb-4">${ICONS.fileText('w-5 h-5')}</div>
              <h3 class="font-display text-lg font-semibold text-slate-900">${esc(copy.qaServiceTitle)}</h3>
              <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(copy.qaServiceDesc)}</p>
            </div>
            <button type="button" data-cnav="services" class="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors cursor-pointer">
              <span>${esc(copy.qaServiceBtn)}</span>
              ${ICONS.arrowRight('w-4 h-4')}
            </button>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div class="w-10 h-10 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center mb-4">${ICONS.search('w-5 h-5')}</div>
              <h3 class="font-display text-lg font-semibold text-slate-900">${esc(copy.qaTrackTitle)}</h3>
              <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(copy.qaTrackDesc)}</p>
            </div>
            <button type="button" data-cnav="track" class="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer">
              <span>${esc(copy.qaTrackBtn)}</span>
              ${ICONS.arrowRight('w-4 h-4')}
            </button>
          </div>
        </div>
      </section>

      <section class="max-w-[1200px] mx-auto px-4 sm:px-6 pb-14">
        <div class="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div class="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <h2 class="font-display text-xl font-bold text-slate-900">Recent Civic Redressal Log</h2>
              <p class="text-sm text-slate-600 mt-0.5">Anonymized ward-level redressal ledger (citizen personal details protected).</p>
            </div>
            <button type="button" data-cnav="track" class="text-sm font-semibold text-[#1E3A8A] hover:underline whitespace-nowrap shrink-0 cursor-pointer">
              Open Verified Status Tracker
            </button>
          </div>
          <div class="divide-y divide-slate-200">
            ${recent
              .map(
                (item) => `
                <div class="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <button type="button" data-prefill-track="${esc(item.id)}" class="font-mono font-semibold text-[#1E3A8A] hover:underline cursor-pointer">${esc(item.id)}</button>
                      <span aria-hidden="true">·</span>
                      <span>Ward ${item.ward}</span>
                      <span aria-hidden="true">·</span>
                      <span>${esc(lang === 'ml' ? CATEGORY_ML[item.category] || item.category : item.category)}</span>
                      <span aria-hidden="true">·</span>
                      <span class="font-mono tabular-nums">${esc(formatShortDate(item.createdAt))}</span>
                    </div>
                    <p class="mt-1 text-sm font-medium text-slate-700">${esc(item.department)} · Ward ${item.ward} Civic Redressal</p>
                  </div>
                  <div class="flex items-center gap-3 shrink-0">
                    ${renderSlaBadge(item, slaLimit)}
                    ${renderStatusLabel(item.status, lang, STATUS_ML)}
                  </div>
                </div>`
              )
              .join('')}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderGrievanceView(copy) {
  const lang = store.language;
  const sub = store.submittedGrievance;
  const token = store.submittedGrievanceToken;

  if (sub) {
    return `
      <section class="max-w-[900px] mx-auto px-4 sm:px-6 py-10">
        <div class="print-only-slip bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div class="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-slate-200">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-lg bg-emerald-50 text-[#059669] flex items-center justify-center shrink-0">${ICONS.checkCircle('w-6 h-6')}</div>
              <div>
                <h2 class="font-display text-xl font-bold text-slate-900">${esc(copy.ackTitle)}</h2>
                <p class="text-sm text-slate-600 mt-0.5">${esc(copy.ackSub)}</p>
              </div>
            </div>
            <div class="text-left sm:text-right">
              <p class="text-xs text-slate-500">Tracking ID</p>
              <p class="font-mono text-xl font-bold text-[#1E3A8A] tabular-nums">${esc(sub.id)}</p>
            </div>
          </div>

          <div class="mt-5 p-4 rounded-lg bg-indigo-50 border border-indigo-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-xs font-semibold text-[#1E3A8A]">Private Verification Token (Save Securely)</p>
              <p class="text-xs text-slate-600 mt-0.5">Required alongside the last 4 digits of your mobile number to view timeline updates.</p>
            </div>
            <p class="font-mono text-sm font-bold text-slate-900 bg-white px-3 py-1.5 rounded border border-indigo-200 select-all">${esc(token)}</p>
          </div>

          <dl class="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div><dt class="text-xs text-slate-500">Citizen Name</dt><dd class="font-medium text-slate-900 mt-0.5">${esc(sub.citizenName || sub.citizenDisplay)}</dd></div>
            <div><dt class="text-xs text-slate-500">Registered Mobile</dt><dd class="font-mono tabular-nums text-slate-900 mt-0.5">******${esc(sub.mobileLast4)}</dd></div>
            <div><dt class="text-xs text-slate-500">Ward & Category</dt><dd class="font-medium text-slate-900 mt-0.5">Ward ${sub.ward} · ${esc(sub.category)}</dd></div>
            <div><dt class="text-xs text-slate-500">Routed Department</dt><dd class="font-medium text-slate-900 mt-0.5">${esc(sub.department)}${sub.assignedOfficerName ? ` (${esc(sub.assignedOfficerName)})` : ''}</dd></div>
            <div class="sm:col-span-2"><dt class="text-xs text-slate-500">Landmark & Description</dt><dd class="text-slate-800 mt-0.5"><strong>${esc(sub.landmark)}:</strong> ${esc(sub.description)}</dd></div>
            <div><dt class="text-xs text-slate-500">Registered At</dt><dd class="font-mono tabular-nums text-slate-700 mt-0.5">${esc(formatDateTime(sub.createdAt))}</dd></div>
            <div><dt class="text-xs text-slate-500">SLA Deadline</dt><dd class="font-mono tabular-nums text-slate-700 mt-0.5">Within ${store.publicOverview.slaLimitDays} Days</dd></div>
          </dl>

          <div class="no-print mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-3">
            <button type="button" id="btn-print-slip" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">${ICONS.printer('w-4 h-4')}<span>${esc(copy.printSlip)}</span></button>
            <button type="button" id="btn-dl-grv-slip" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">${ICONS.download('w-4 h-4')}<span>${esc(copy.downloadSlip)}</span></button>
            <button type="button" id="btn-track-submitted-grv" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#059669] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer">${ICONS.search('w-4 h-4')}<span>${esc(copy.trackThisNow)}</span></button>
            <button type="button" id="btn-submit-another-grv" class="ml-auto text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer">${esc(copy.submitAnother)}</button>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="max-w-[900px] mx-auto px-4 sm:px-6 py-10">
      <div class="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <h1 class="font-display text-2xl font-bold text-slate-900">${esc(copy.formGrievanceTitle)}</h1>
        <p class="mt-1.5 text-sm text-slate-600">${esc(copy.formGrievanceSub)}</p>
        <div id="grv-form-error" class="hidden mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>

        <form id="citizen-grievance-form" class="mt-6 space-y-5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label for="grv-name" class="block text-sm font-medium text-slate-700 mb-1.5">${esc(copy.citizenName)} *</label>
              <input id="grv-name" name="citizenName" type="text" maxlength="120" required placeholder="e.g. Suresh Nair" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
            </div>
            <div>
              <label for="grv-mobile" class="block text-sm font-medium text-slate-700 mb-1.5">${esc(copy.mobileNumber)} *</label>
              <input id="grv-mobile" name="mobile" type="tel" maxlength="10" required placeholder="9847000000" class="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label for="grv-ward" class="block text-sm font-medium text-slate-700 mb-1.5">${esc(copy.wardSelection)} *</label>
              <select id="grv-ward" name="ward" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]">
                ${ALL_WARDS.map((w) => `<option value="${w}">Ward ${w}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="grv-category" class="block text-sm font-medium text-slate-700 mb-1.5">${esc(copy.categoryLabel)} *</label>
              <select id="grv-category" name="category" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]">
                ${GRIEVANCE_CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(lang === 'ml' ? `${c} (${CATEGORY_ML[c]})` : c)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div>
            <label for="grv-landmark" class="block text-sm font-medium text-slate-700 mb-1.5">${esc(copy.landmarkLabel)} *</label>
            <input id="grv-landmark" name="landmark" type="text" maxlength="200" required placeholder="e.g. Near Anganwadi No. 2, Main Cross Road" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
          </div>

          <div>
            <label for="grv-desc" class="block text-sm font-medium text-slate-700 mb-1.5">${esc(copy.descriptionLabel)} *</label>
            <textarea id="grv-desc" name="description" rows="4" maxlength="2000" required placeholder="Describe the exact problem, duration, and impact..." class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"></textarea>
          </div>

          <div>
            <p class="block text-sm font-medium text-slate-700 mb-1.5">${esc(copy.photoLabel)}</p>
            <div class="flex flex-wrap items-center gap-3">
              <label class="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer">
                ${ICONS.upload('w-4 h-4')}
                <span>Upload Photo File (PNG/JPG)</span>
                <input id="grv-photo-input" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" />
              </label>
              <button type="button" data-sample-photo="${IMG_ROAD_BEFORE}" class="px-3 py-2 text-xs font-medium text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer">Use Sample Road Photo</button>
              <button type="button" data-sample-photo="${IMG_WATER_LEAK}" class="px-3 py-2 text-xs font-medium text-[#1E3A8A] bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer">Use Sample Pipe Leak Photo</button>
            </div>
            ${
              store.gPhotoPreview
                ? `<div class="mt-3 relative inline-block">
                    <img src="${esc(store.gPhotoPreview)}" alt="Uploaded grievance evidence preview" referrerpolicy="no-referrer" class="w-56 h-36 object-cover rounded-lg border border-slate-200" />
                    <button type="button" id="btn-clear-grv-photo" aria-label="Remove attached photo" class="absolute -top-2 -right-2 p-1 bg-slate-900 text-white rounded-full cursor-pointer">${ICONS.x('w-3.5 h-3.5')}</button>
                  </div>`
                : ''
            }
          </div>

          <div class="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button type="button" data-cnav="home" class="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
            <button type="submit" class="px-6 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer">${esc(copy.submitGrievanceBtn)}</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderServicesView(copy) {
  const lang = store.language;
  const sub = store.submittedService;
  const token = store.submittedServiceToken;
  const sel = store.selectedService;

  if (sub) {
    return `
      <section class="max-w-[1200px] mx-auto px-4 sm:px-6 py-10">
        <div class="print-only-slip max-w-3xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div class="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-slate-200">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-lg bg-emerald-50 text-[#059669] flex items-center justify-center shrink-0">${ICONS.checkCircle('w-6 h-6')}</div>
              <div>
                <h2 class="font-display text-xl font-bold text-slate-900">${esc(copy.ackTitle)}</h2>
                <p class="text-sm text-slate-600 mt-0.5">${esc(sub.serviceName)} · ${esc(sub.department)}</p>
              </div>
            </div>
            <div class="text-left sm:text-right">
              <p class="text-xs text-slate-500">Application Tracking ID</p>
              <p class="font-mono text-xl font-bold text-[#1E3A8A] tabular-nums">${esc(sub.id)}</p>
            </div>
          </div>

          <div class="mt-5 p-4 rounded-lg bg-indigo-50 border border-indigo-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-xs font-semibold text-[#1E3A8A]">Private Verification Token (Save Securely)</p>
              <p class="text-xs text-slate-600 mt-0.5">Required alongside the last 4 digits of your mobile number to view verification status.</p>
            </div>
            <p class="font-mono text-sm font-bold text-slate-900 bg-white px-3 py-1.5 rounded border border-indigo-200 select-all">${esc(token)}</p>
          </div>

          <dl class="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div><dt class="text-xs text-slate-500">Applicant Name</dt><dd class="font-medium text-slate-900 mt-0.5">${esc(sub.applicantName || sub.applicantDisplay)}</dd></div>
            <div><dt class="text-xs text-slate-500">Ward & Mobile</dt><dd class="font-mono tabular-nums text-slate-900 mt-0.5">Ward ${sub.ward} · ******${esc(sub.mobileLast4)}</dd></div>
            <div><dt class="text-xs text-slate-500">Statutory Fee</dt><dd class="font-mono tabular-nums text-slate-900 mt-0.5">${sub.feeInr === 0 ? esc(copy.freeLabel) : `INR ${sub.feeInr}.00`}</dd></div>
            <div><dt class="text-xs text-slate-500">Submitted At</dt><dd class="font-mono tabular-nums text-slate-700 mt-0.5">${esc(formatDateTime(sub.createdAt))}</dd></div>
            <div class="sm:col-span-2"><dt class="text-xs text-slate-500">Confirmed Document Checklist</dt><dd class="mt-1 text-slate-800">${esc((sub.checkedDocs || []).join(' · '))}</dd></div>
          </dl>

          <div class="no-print mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-3">
            <button type="button" id="btn-print-slip" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg cursor-pointer">${ICONS.printer('w-4 h-4')}<span>${esc(copy.printSlip)}</span></button>
            <button type="button" id="btn-dl-srv-slip" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">${ICONS.download('w-4 h-4')}<span>${esc(copy.downloadSlip)}</span></button>
            <button type="button" id="btn-track-submitted-srv" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#059669] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer">${ICONS.search('w-4 h-4')}<span>${esc(copy.trackThisNow)}</span></button>
            <button type="button" id="btn-back-catalog" class="ml-auto text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer">Back to Service Catalog</button>
          </div>
        </div>
      </section>
    `;
  }

  if (sel) {
    return `
      <section class="max-w-[1200px] mx-auto px-4 sm:px-6 py-10">
        <div class="max-w-3xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div class="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <p class="text-xs font-medium text-[#059669]">${esc(sel.department)} · SLA ${sel.slaDays} ${esc(copy.daysUnit)}</p>
              <h2 class="font-display text-xl font-bold text-slate-900 mt-1">${esc(lang === 'ml' ? sel.titleMl : sel.titleEn)}</h2>
              <p class="text-sm text-slate-600 mt-1">${esc(lang === 'ml' ? sel.descriptionMl : sel.descriptionEn)}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-xs text-slate-500">${esc(copy.feeLabel)}</p>
              <p class="font-mono text-lg font-bold text-[#1E3A8A] tabular-nums">${sel.feeInr === 0 ? esc(copy.freeLabel) : `₹${sel.feeInr}`}</p>
            </div>
          </div>

          <div id="srv-form-error" class="hidden mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>

          <form id="citizen-service-form" class="mt-6 space-y-5">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label for="srv-name" class="block text-sm font-medium text-slate-700 mb-1.5">Applicant Full Name *</label>
                <input id="srv-name" name="applicantName" type="text" maxlength="120" required placeholder="e.g. Kavitha Krishnan" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label for="srv-mobile" class="block text-sm font-medium text-slate-700 mb-1.5">${esc(copy.mobileNumber)} *</label>
                <input id="srv-mobile" name="mobile" type="tel" maxlength="10" required placeholder="9447000000" class="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg" />
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div>
                <label for="srv-ward" class="block text-sm font-medium text-slate-700 mb-1.5">Ward *</label>
                <select id="srv-ward" name="ward" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white">
                  ${ALL_WARDS.map((w) => `<option value="${w}">Ward ${w}</option>`).join('')}
                </select>
              </div>
              <div class="sm:col-span-2">
                <label for="srv-address" class="block text-sm font-medium text-slate-700 mb-1.5">House Name / Door Number & Address *</label>
                <input id="srv-address" name="address" type="text" maxlength="300" required placeholder="House No. 4/112, Temple Road, ABC Gram Panchayat" class="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg" />
              </div>
            </div>

            <div class="bg-[#F8FAFC] border border-slate-200 rounded-lg p-4">
              <p class="text-sm font-semibold text-slate-900 mb-3">${esc(copy.requiredDocsTitle)}</p>
              <div class="space-y-2.5">
                ${sel.requiredDocsEn
                  .map((doc, i) => {
                    const label = lang === 'ml' ? sel.requiredDocsMl[i] || doc : doc;
                    const checked = store.serviceCheckedDocs.includes(doc) ? 'checked' : '';
                    return `
                      <label class="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                        <input type="checkbox" data-srv-doc="${esc(doc)}" ${checked} class="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#1E3A8A]" />
                        <span>${esc(label)}</span>
                      </label>`;
                  })
                  .join('')}
              </div>
              <div class="mt-4 pt-4 border-t border-slate-200">
                <p class="text-xs font-medium text-slate-600 mb-2">${esc(copy.uploadDocsTitle)}</p>
                <label class="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                  ${ICONS.upload('w-3.5 h-3.5')}
                  <span>Select PDF / Image Files</span>
                  <input id="srv-file-input" type="file" multiple accept=".pdf,image/*" class="hidden" />
                </label>
                ${
                  store.serviceUploadedFiles.length > 0
                    ? `<p class="mt-2 text-xs font-mono text-emerald-700">Attached: ${esc(store.serviceUploadedFiles.join(', '))}</p>`
                    : ''
                }
              </div>
            </div>

            <div class="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <button type="button" id="btn-back-catalog" class="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">Back to Catalog</button>
              <button type="submit" class="px-6 py-2.5 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors cursor-pointer">${esc(copy.submitServiceBtn)}</button>
            </div>
          </form>
        </div>
      </section>
    `;
  }

  return `
    <section class="max-w-[1200px] mx-auto px-4 sm:px-6 py-10">
      <div class="mb-8">
        <h1 class="font-display text-2xl sm:text-3xl font-bold text-slate-900">${esc(copy.servicesPageTitle)}</h1>
        <p class="mt-1.5 text-sm text-slate-600 max-w-2xl">${esc(copy.servicesPageSub)}</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${SERVICE_CATALOG.map(
          (service) => `
          <div class="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>${esc(service.department)}</span>
                <span class="font-mono tabular-nums">${service.slaDays} ${esc(copy.daysUnit)} SLA</span>
              </div>
              <h2 class="mt-2 font-display text-lg font-bold text-slate-900">${esc(lang === 'ml' ? service.titleMl : service.titleEn)}</h2>
              <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(lang === 'ml' ? service.descriptionMl : service.descriptionEn)}</p>
              <div class="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600">
                <span class="font-medium text-slate-500">${esc(copy.feeLabel)}: </span>
                <span class="font-mono font-semibold text-slate-900 tabular-nums">${service.feeInr === 0 ? esc(copy.freeLabel) : `₹${service.feeInr}`}</span>
              </div>
            </div>
            <button type="button" data-select-service="${esc(service.id)}" class="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors cursor-pointer">
              <span>${esc(copy.applyNowBtn)}</span>
              ${ICONS.arrowRight('w-4 h-4')}
            </button>
          </div>`
        ).join('')}
      </div>
    </section>
  `;
}

function renderTrackView(copy) {
  const lang = store.language;
  const record = store.trackedRecord;
  const slaLimit = store.publicOverview.slaLimitDays || 7;

  return `
    <section class="max-w-[1000px] mx-auto px-4 sm:px-6 py-10">
      <div class="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <h1 class="font-display text-2xl font-bold text-slate-900">${esc(copy.trackerTitle)}</h1>
        <p class="mt-1.5 text-sm text-slate-600">Enter your Tracking ID, Verification Token (from your acknowledgement slip), and last 4 digits of your registered mobile number.</p>

        <form id="tracker-search-form" class="mt-5 grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div class="sm:col-span-4">
            <label for="tracker-input" class="block text-xs font-medium text-slate-600 mb-1">Tracking ID</label>
            <input id="tracker-input" name="trackingId" type="text" required value="${esc(store.trackQuery)}" placeholder="ABC-GRV-2026-109" class="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
          </div>
          <div class="sm:col-span-4">
            <label for="tracker-token-input" class="block text-xs font-medium text-slate-600 mb-1">Verification Token</label>
            <input id="tracker-token-input" name="trackingToken" type="text" required value="${esc(store.trackToken)}" placeholder="TK-..." class="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
          </div>
          <div class="sm:col-span-2">
            <label for="tracker-last4-input" class="block text-xs font-medium text-slate-600 mb-1">Mobile Last 4</label>
            <input id="tracker-last4-input" name="mobileLast4" type="text" maxlength="4" required value="${esc(store.trackMobileLast4)}" placeholder="0000" class="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]" />
          </div>
          <div class="sm:col-span-2 flex items-end">
            <button type="submit" class="w-full px-4 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg whitespace-nowrap cursor-pointer">${esc(copy.searchBtn)}</button>
          </div>
        </form>

        ${
          store.trackError
            ? `<div class="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">${esc(store.trackError)}</div>`
            : ''
        }
      </div>

      ${
        record
          ? `
        <div class="mt-6 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-8">
          <div class="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-slate-200">
            <div>
              <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span class="font-mono font-semibold text-[#1E3A8A]">${esc(record.id)}</span>
                <span>·</span>
                <span>Ward ${record.ward}</span>
                <span>·</span>
                <span>${esc(record.department)}</span>
                <span>·</span>
                <span class="font-mono tabular-nums">Filed ${esc(formatShortDate(record.createdAt))}</span>
              </div>
              <h2 class="mt-2 font-display text-xl font-bold text-slate-900">
                ${
                  record.kind === 'grievance'
                    ? `${esc(record.category)} — ${esc(record.landmark)}`
                    : esc(record.serviceName)
                }
              </h2>
              <p class="mt-1 text-sm text-slate-600">
                ${
                  record.kind === 'grievance'
                    ? `${esc(record.citizenDisplay)} · ${esc(record.description)}`
                    : `Applicant: ${esc(record.applicantDisplay)} · Statutory Fee: ${record.feeInr === 0 ? esc(copy.freeLabel) : `₹${record.feeInr}`}`
                }
              </p>
            </div>
            <div class="flex flex-col items-start sm:items-end gap-2">
              ${renderStatusLabel(record.status, lang, STATUS_ML)}
              ${renderSlaBadge(record, slaLimit)}
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 text-sm">
            <div>
              <p class="text-xs font-medium text-slate-500">Assigned Officer & Dept</p>
              <p class="mt-1 font-semibold text-slate-900">${esc(record.assignedOfficerName || 'Pending Desk Assignment')} · ${esc(record.department)}</p>
            </div>
            <div>
              <p class="text-xs font-medium text-slate-500">Latest Official Remark</p>
              <p class="mt-1 text-slate-800">${esc((record.kind === 'grievance' ? record.publicRemark : record.officialRemark) || 'Awaiting officer update.')}</p>
            </div>
          </div>

          <div>
            <h3 class="font-display text-base font-bold text-slate-900 mb-4">${esc(copy.timelineHeading)}</h3>
            <ol class="relative space-y-6 pl-6 before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200">
              ${(record.timeline || [])
                .map((step, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  return `
                    <li class="relative">
                      <span class="absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center border ${
                        isLast ? 'bg-[#059669] border-[#059669] text-white' : 'bg-white border-slate-300 text-slate-500'
                      }">${ICONS.checkCircle('w-3 h-3')}</span>
                      <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <p class="text-sm font-semibold text-slate-900">${esc(step.stepTitle)}</p>
                        <span class="text-xs font-mono tabular-nums text-slate-500">${esc(formatDateTime(step.timestamp))}</span>
                      </div>
                      <p class="text-xs text-slate-500 mt-0.5">${esc(step.actor)}</p>
                      <p class="text-sm text-slate-700 mt-1">${esc(step.remark)}</p>
                    </li>`;
                })
                .join('')}
            </ol>
          </div>

          ${
            record.kind === 'grievance' && (record.beforePhotoUrl || record.afterPhotoUrl)
              ? `
            <div class="pt-6 border-t border-slate-200">
              <h3 class="font-display text-base font-bold text-slate-900 mb-4">${esc(copy.beforeAfterHeading)}</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                ${
                  record.beforePhotoUrl
                    ? `<div><p class="text-xs font-semibold text-slate-600 mb-2">${esc(copy.beforeLabel)}</p><img src="${esc(record.beforePhotoUrl)}" alt="Citizen reported issue photo" referrerpolicy="no-referrer" class="w-full h-56 object-cover rounded-lg border border-slate-200" /></div>`
                    : ''
                }
                ${
                  record.afterPhotoUrl
                    ? `<div><p class="text-xs font-semibold text-[#059669] mb-2">${esc(copy.afterLabel)}</p><img src="${esc(record.afterPhotoUrl)}" alt="Officer verified resolution proof" referrerpolicy="no-referrer" class="w-full h-56 object-cover rounded-lg border border-emerald-200" /></div>`
                    : ''
                }
              </div>
            </div>`
              : ''
          }

          ${
            record.kind === 'grievance' && record.status === 'Resolved'
              ? `
            <div class="pt-6 border-t border-slate-200">
              <h3 class="font-display text-base font-bold text-slate-900">${esc(copy.feedbackHeading)}</h3>
              ${
                record.rating
                  ? `<div class="mt-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p class="text-sm font-semibold text-emerald-900">${esc(copy.feedbackSaved)}</p>
                        ${record.feedbackComment ? `<p class="text-xs text-emerald-800 mt-1">“${esc(record.feedbackComment)}”</p>` : ''}
                      </div>
                      <div class="flex items-center gap-1 text-amber-500">
                        ${[1, 2, 3, 4, 5].map((st) => ICONS.star('w-4 h-4', st <= record.rating)).join('')}
                        <span class="ml-1.5 text-xs font-mono font-bold text-slate-800">${record.rating}/5</span>
                      </div>
                    </div>`
                  : `<form id="citizen-feedback-form" data-ticket-id="${esc(record.id)}" class="mt-2 bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 space-y-3">
                      <p class="text-sm text-slate-600">${esc(copy.feedbackDesc)}</p>
                      <div class="flex items-center gap-1.5">
                        ${[1, 2, 3, 4, 5]
                          .map(
                            (st) => `<button type="button" data-star="${st}" aria-label="Rate ${st} stars" class="p-1 cursor-pointer ${
                              st <= store.ratingDraft ? 'text-amber-500' : 'text-slate-300'
                            }">${ICONS.star('w-6 h-6', st <= store.ratingDraft)}</button>`
                          )
                          .join('')}
                        <span class="ml-2 text-xs font-mono text-slate-600">${store.ratingDraft} / 5</span>
                      </div>
                      <input id="feedback-comment" type="text" maxlength="400" placeholder="Optional citizen comment..." class="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg" />
                      <button type="submit" class="px-4 py-2 text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg cursor-pointer">${esc(copy.submitFeedbackBtn)}</button>
                    </form>`
              }
            </div>`
              : ''
          }
        </div>`
          : `<div class="mt-6 bg-white border border-slate-200 rounded-xl p-8 text-center"><p class="text-sm text-slate-600">Submit your Tracking ID, Verification Token, and mobile last 4 digits to inspect verified status updates.</p></div>`
      }
    </section>
  `;
}

export function renderCitizenPortal() {
  const copy = TRANSLATIONS[store.language];
  const view = store.citizenView;

  const navBtn = (key, label) => `
    <button type="button" data-cnav="${key}" class="py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
    view === key
      ? 'text-[#1E3A8A] border-[#1E3A8A] font-semibold'
      : 'border-transparent hover:text-slate-900 hover:border-slate-300'
  }">${esc(label)}</button>`;

  let contentHtml = '';
  if (view === 'home') contentHtml = renderHomeView(copy);
  else if (view === 'grievance') contentHtml = renderGrievanceView(copy);
  else if (view === 'services') contentHtml = renderServicesView(copy);
  else contentHtml = renderTrackView(copy);

  return `
    <div class="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      <header class="no-print bg-white border-b border-slate-200 sticky top-0 z-30">
        <div class="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <button type="button" data-cnav="home" class="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 cursor-pointer rounded">
            <span class="text-[#1E3A8A]">${ICONS.landmark('w-6 h-6')}</span>
            <span class="font-display text-lg font-bold tracking-tight text-[#1E3A8A]">${esc(copy.brandName)}</span>
          </button>

          <nav class="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            ${navBtn('home', copy.navHome)}
            ${navBtn('grievance', copy.navGrievance)}
            ${navBtn('services', copy.navServices)}
            ${navBtn('track', copy.navTrack)}
          </nav>

          <div class="flex items-center gap-3 shrink-0">
            <button type="button" id="btn-toggle-lang" class="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer">
              ${ICONS.globe('w-3.5 h-3.5')}
              <span>${esc(copy.langToggle)}</span>
            </button>
            <button type="button" id="btn-citizen-mobile-menu" aria-label="Toggle menu" class="md:hidden p-2.5 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
              ${store.mobileMenuOpen ? ICONS.x('w-5 h-5') : ICONS.menu('w-5 h-5')}
            </button>
          </div>
        </div>
        ${
          store.mobileMenuOpen
            ? `<div class="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
                ${[
                  ['home', copy.navHome],
                  ['grievance', copy.navGrievance],
                  ['services', copy.navServices],
                  ['track', copy.navTrack],
                ]
                  .map(
                    ([k, l]) =>
                      `<button type="button" data-cnav="${k}" class="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
                        view === k ? 'bg-indigo-50 text-[#1E3A8A] font-semibold' : 'text-slate-700 hover:bg-slate-50'
                      }">${esc(l)}</button>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      </header>

      <div class="no-print bg-[#1E3A8A] text-white text-xs">
        <div class="max-w-[1440px] mx-auto px-4 sm:px-6 h-9 flex items-center gap-3 overflow-hidden">
          <span class="px-2 py-0.5 bg-[#059669] text-white font-semibold rounded text-[11px] shrink-0">${esc(copy.tickerLabel)}</span>
          <div class="overflow-hidden whitespace-nowrap flex-1">
            <div class="ticker-track">
              ${[...copy.notices, ...copy.notices]
                .map((n) => `<span class="inline-flex items-center gap-6 pr-12 text-slate-100"><span>${esc(n)}</span><span class="text-emerald-300">•</span></span>`)
                .join('')}
            </div>
          </div>
        </div>
      </div>

      <main class="flex-1">${contentHtml}</main>

      <footer class="no-print bg-white border-t border-slate-200 mt-12">
        <div class="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[#1E3A8A]">${ICONS.landmark('w-4 h-4')}</span>
            <span class="font-semibold text-slate-800">${esc(copy.brandName)}</span>
            <span>·</span>
            <span>Panchayat Bhavan, Main Road, Kerala 682001</span>
          </div>
          <div class="flex items-center gap-4">
            <button type="button" data-portal-switch="admin" class="text-[#1E3A8A] font-medium hover:underline cursor-pointer">Official Staff Login</button>
            <span>·</span>
            <span>© 2026 ABC Gram Panchayat</span>
          </div>
        </div>
      </footer>
    </div>
  `;
}

export function bindCitizenEvents(root) {
  root.querySelector('#btn-toggle-lang')?.addEventListener('click', () => {
    store.language = store.language === 'en' ? 'ml' : 'en';
    notify();
  });

  root.querySelector('#btn-citizen-mobile-menu')?.addEventListener('click', () => {
    store.mobileMenuOpen = !store.mobileMenuOpen;
    notify();
  });

  root.querySelectorAll('[data-cnav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-cnav');
      if (target === 'grievance') store.submittedGrievance = null;
      if (target === 'services') store.submittedService = null;
      store.citizenView = target;
      store.mobileMenuOpen = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      notify();
    });
  });

  root.querySelectorAll('[data-prefill-track]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.trackQuery = btn.getAttribute('data-prefill-track') || '';
      store.trackToken = '';
      store.trackMobileLast4 = '';
      store.trackedRecord = null;
      store.trackError = '';
      store.citizenView = 'track';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      notify();
    });
  });

  root.querySelectorAll('[data-sample-photo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.gPhotoPreview = btn.getAttribute('data-sample-photo') || '';
      notify();
    });
  });

  root.querySelector('#btn-clear-grv-photo')?.addEventListener('click', () => {
    store.gPhotoPreview = '';
    notify();
  });

  root.querySelector('#grv-photo-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      const errBox = root.querySelector('#grv-form-error');
      if (errBox) {
        errBox.textContent = 'Photo exceeds 1MB file limit.';
        errBox.classList.remove('hidden');
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        store.gPhotoPreview = reader.result;
        notify();
      }
    };
    reader.readAsDataURL(file);
  });

  root.querySelector('#citizen-grievance-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const citizenName = String(fd.get('citizenName') || '').trim();
    const mobile = String(fd.get('mobile') || '').replace(/\D/g, '');
    const ward = Number(fd.get('ward') || 1);
    const category = String(fd.get('category') || 'Water Supply');
    const landmark = String(fd.get('landmark') || '').trim();
    const description = String(fd.get('description') || '').trim();

    const errBox = root.querySelector('#grv-form-error');
    if (!citizenName || !/^\d{10}$/.test(mobile) || !landmark || !description) {
      if (errBox) {
        errBox.textContent =
          'Please enter valid full name, 10-digit mobile number, landmark, and description.';
        errBox.classList.remove('hidden');
      }
      return;
    }
    const res = await submitGrievance({
      citizenName,
      mobile,
      ward,
      category,
      landmark,
      description,
      ...(store.gPhotoPreview ? { beforePhotoUrl: store.gPhotoPreview } : {}),
    });
    if (res.ok && res.ticket) {
      store.gPhotoPreview = '';
      store.submittedGrievance = res.ticket;
      store.submittedGrievanceToken = res.trackingToken;
      notify();
    } else if (errBox) {
      errBox.textContent = res.error || 'Submission failed.';
      errBox.classList.remove('hidden');
    }
  });

  root.querySelector('#btn-track-submitted-grv')?.addEventListener('click', async () => {
    if (!store.submittedGrievance) return;
    store.citizenView = 'track';
    await trackApplication(
      store.submittedGrievance.id,
      store.submittedGrievanceToken,
      store.submittedGrievance.mobileLast4
    );
  });

  root.querySelector('#btn-track-submitted-srv')?.addEventListener('click', async () => {
    if (!store.submittedService) return;
    store.citizenView = 'track';
    await trackApplication(
      store.submittedService.id,
      store.submittedServiceToken,
      store.submittedService.mobileLast4
    );
  });

  root.querySelector('#btn-print-slip')?.addEventListener('click', () => window.print());
  root.querySelector('#btn-dl-grv-slip')?.addEventListener('click', () => {
    if (store.submittedGrievance) {
      downloadReceipt('grievance', store.submittedGrievance, store.submittedGrievanceToken);
    }
  });
  root.querySelector('#btn-dl-srv-slip')?.addEventListener('click', () => {
    if (store.submittedService) {
      downloadReceipt('service', store.submittedService, store.submittedServiceToken);
    }
  });
  root.querySelector('#btn-submit-another-grv')?.addEventListener('click', () => {
    store.submittedGrievance = null;
    notify();
  });

  root.querySelectorAll('[data-select-service]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-select-service');
      store.selectedService = SERVICE_CATALOG.find((s) => s.id === id) || null;
      store.submittedService = null;
      store.serviceCheckedDocs = [];
      store.serviceUploadedFiles = [];
      notify();
    });
  });

  root.querySelector('#btn-back-catalog')?.addEventListener('click', () => {
    store.selectedService = null;
    store.submittedService = null;
    notify();
  });

  root.querySelectorAll('[data-srv-doc]').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const doc = chk.getAttribute('data-srv-doc');
      if (e.target.checked) {
        if (!store.serviceCheckedDocs.includes(doc)) store.serviceCheckedDocs.push(doc);
      } else {
        store.serviceCheckedDocs = store.serviceCheckedDocs.filter((d) => d !== doc);
      }
    });
  });

  root.querySelector('#srv-file-input')?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []).map((f) => f.name);
    store.serviceUploadedFiles = [...store.serviceUploadedFiles, ...files].slice(0, 10);
    notify();
  });

  root.querySelector('#citizen-service-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!store.selectedService) return;
    const fd = new FormData(e.target);
    const applicantName = String(fd.get('applicantName') || '').trim();
    const mobile = String(fd.get('mobile') || '').replace(/\D/g, '');
    const ward = Number(fd.get('ward') || 1);
    const address = String(fd.get('address') || '').trim();
    const errBox = root.querySelector('#srv-form-error');

    if (!applicantName || !/^\d{10}$/.test(mobile) || !address) {
      if (errBox) {
        errBox.textContent = 'Please complete applicant name, 10-digit mobile, and address.';
        errBox.classList.remove('hidden');
      }
      return;
    }
    if (store.serviceCheckedDocs.length === 0) {
      if (errBox) {
        errBox.textContent = 'Please confirm at least one required document in the checklist.';
        errBox.classList.remove('hidden');
      }
      return;
    }
    const res = await submitServiceApplication({
      serviceId: store.selectedService.id,
      applicantName,
      mobile,
      ward,
      address,
      checkedDocs: store.serviceCheckedDocs,
      uploadedDocNames: store.serviceUploadedFiles,
    });
    if (res.ok && res.application) {
      store.submittedService = res.application;
      store.submittedServiceToken = res.trackingToken;
      notify();
    } else if (errBox) {
      errBox.textContent = res.error || 'Submission failed.';
      errBox.classList.remove('hidden');
    }
  });

  root.querySelector('#tracker-search-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const tid = String(fd.get('trackingId') || '').trim().toUpperCase();
    const token = String(fd.get('trackingToken') || '').trim();
    const last4 = String(fd.get('mobileLast4') || '').replace(/\D/g, '');
    await trackApplication(tid, token, last4);
  });

  root.querySelectorAll('[data-star]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.ratingDraft = Number(btn.getAttribute('data-star') || 5);
      notify();
    });
  });

  root.querySelector('#citizen-feedback-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ticketId = e.target.getAttribute('data-ticket-id');
    const comment = root.querySelector('#feedback-comment')?.value || '';
    if (ticketId) {
      await submitFeedback(ticketId, store.ratingDraft, comment);
    }
  });
}
