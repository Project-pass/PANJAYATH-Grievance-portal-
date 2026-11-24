export const IMG_HERO = '/src/assets/images/panchayat_bhavan_hero_1795502748499.jpg';
export const IMG_ROAD_BEFORE = '/src/assets/images/grievance_road_before_1795502748537.jpg';
export const IMG_ROAD_AFTER = '/src/assets/images/grievance_road_after_1795502749598.jpg';
export const IMG_WATER_LEAK = '/src/assets/images/grievance_water_leak_1795502750018.jpg';
export const IMG_STREETLIGHT_FIXED = '/src/assets/images/grievance_streetlight_fixed_1795502750170.jpg';

export const ALL_WARDS = Array.from({ length: 15 }, (_, i) => i + 1);

export const DEPARTMENTS = [
  'General Administration',
  'Roads & Streetlights',
  'Water & Sanitation',
  'Public Health',
  'Revenue & Certificates',
  'Building & Planning',
];

export const GRIEVANCE_CATEGORIES = [
  'Water Supply',
  'Streetlights',
  'Waste Management',
  'Roads & Drainage',
  'Public Health',
  'Encroachment',
];

export const DEFAULT_ROLE_PERMISSIONS = {
  SUPER_ADMIN: {
    canApproveCertificates: true,
    canAssignTickets: true,
    canManageUsers: true,
    canDeleteRecords: true,
    canVerifyDocuments: true,
  },
  WARD_OFFICER: {
    canApproveCertificates: false,
    canAssignTickets: false,
    canManageUsers: false,
    canDeleteRecords: false,
    canVerifyDocuments: true,
  },
  CSC_OPERATOR: {
    canApproveCertificates: false,
    canAssignTickets: false,
    canManageUsers: false,
    canDeleteRecords: false,
    canVerifyDocuments: true,
  },
};

export const SERVICE_CATALOG = [
  {
    id: 'birth_death',
    titleEn: 'Birth / Death Certificate',
    titleMl: 'ജനന / മരണ സർട്ടിഫിക്കറ്റ്',
    department: 'Revenue & Certificates',
    feeInr: 0,
    slaDays: 5,
    descriptionEn:
      'Digitally signed statutory extract issued under the Registration of Births and Deaths Act.',
    descriptionMl: 'ജനന-മരണ രജിസ്ട്രേഷൻ നിയമപ്രകാരം ഡിജിറ്റലായി ഒപ്പിട്ട സർട്ടിഫിക്കറ്റ്.',
    requiredDocsEn: [
      'Hospital Discharge Summary / Medical Certificate',
      'Parents Aadhaar / Identity Proof',
      'Address Proof within ABC Gram Panchayat',
    ],
    requiredDocsMl: [
      'ആശുപത്രി ഡിസ്ചാർജ് സമ്മറി / മെഡിക്കൽ സർട്ടിഫിക്കറ്റ്',
      'മാതാപിതാക്കളുടെ ആധാർ / തിരിച്ചറിയൽ രേഖ',
      'പഞ്ചായത്തിലെ വിലാസ തെളിവ്',
    ],
  },
  {
    id: 'residence',
    titleEn: 'Residence Certificate',
    titleMl: 'താമസ സർട്ടിഫിക്കറ്റ്',
    department: 'Revenue & Certificates',
    feeInr: 25,
    slaDays: 4,
    descriptionEn:
      'Official proof of continuous residence within ABC Gram Panchayat wards for welfare and school admissions.',
    descriptionMl: 'പഞ്ചായത്തിലെ സ്ഥിരതാമസം തെളിയിക്കുന്ന ഔദ്യോഗിക സർട്ടിഫിക്കറ്റ്.',
    requiredDocsEn: [
      'Ration Card / Elector Photo ID Card',
      'Latest Property Tax Receipt or Rent Agreement',
      'Self-Declaration Form',
    ],
    requiredDocsMl: [
      'റേഷൻ കാർഡ് / വോട്ടർ ഐഡി',
      'ഏറ്റവും പുതിയ വസ്തുനികുതി രസീത് അല്ലെങ്കിൽ വാടക കരാർ',
      'സ്വയം സാക്ഷ്യപ്പെടുത്തിയ സത്യവാങ്മൂലം',
    ],
  },
  {
    id: 'property_tax',
    titleEn: 'Property Tax Assessment',
    titleMl: 'വസ്തുനികുതി നിർണ്ണയം',
    department: 'Revenue & Certificates',
    feeInr: 50,
    slaDays: 7,
    descriptionEn:
      'New building door-number assessment, ownership mutation, or annual property tax revision.',
    descriptionMl: 'പുതിയ കെട്ടിട നമ്പർ, ഉടമസ്ഥാവകാശ മാറ്റം, അല്ലെങ്കിൽ നികുതി പുനർനിർണ്ണയം.',
    requiredDocsEn: [
      'Registered Title Deed / Ownership Copy',
      'Approved Building Completion Sketch',
      'Latest Land Tax Receipt',
    ],
    requiredDocsMl: [
      'ആധാരത്തിന്റെ പകർപ്പ്',
      'അംഗീകൃത കെട്ടിട പ്ലാൻ',
      'ഭൂനികുതി രസീത്',
    ],
  },
  {
    id: 'trade_license',
    titleEn: 'Trade License (D&O)',
    titleMl: 'വ്യാപാര ലൈസൻസ്',
    department: 'General Administration',
    feeInr: 500,
    slaDays: 7,
    descriptionEn:
      'Annual Panchayat trade & commercial establishment license renewal or fresh registration.',
    descriptionMl: 'കടകൾക്കും വാണിജ്യ സ്ഥാപനങ്ങൾക്കുമുള്ള പഞ്ചായത്ത് വ്യാപാര ലൈസൻസ്.',
    requiredDocsEn: [
      'Building Owner Consent / Lease Agreement',
      'Property Tax Paid Receipt',
      'Sanitary / Fire NOC (where applicable)',
    ],
    requiredDocsMl: [
      'കെട്ടിട ഉടമയുടെ സമ്മതപത്രം / വാടക കരാർ',
      'വസ്തുനികുതി അടച്ച രസീത്',
      'ഹെൽത്ത് / ഫയർ എൻ.ഒ.സി',
    ],
  },
  {
    id: 'building_permit',
    titleEn: 'Building Permit',
    titleMl: 'കെട്ടിട നിർമ്മാണ അനുമതി',
    department: 'Building & Planning',
    feeInr: 1200,
    slaDays: 14,
    descriptionEn:
      'KPBR-compliant residential or commercial construction permit verified by the Panchayat Assistant Engineer.',
    descriptionMl: 'കെട്ടിട നിർമ്മാണ ചട്ടങ്ങൾ പ്രകാരമുള്ള നിർമ്മാണ അനുമതി.',
    requiredDocsEn: [
      'Site & Floor Plan signed by Licensed Engineer',
      'Possession Certificate & Land Tax Receipt',
      'Aadhaar Copy of Landowner',
    ],
    requiredDocsMl: [
      'അംഗീകൃത എൻജിനീയർ ഒപ്പിട്ട പ്ലാൻ',
      'കൈവശാവകാശ സർട്ടിഫിക്കറ്റും ഭൂനികുതി രസീതും',
      'ഭൂവുടമയുടെ ആധാർ പകർപ്പ്',
    ],
  },
  {
    id: 'water_connection',
    titleEn: 'New Water Connection',
    titleMl: 'പുതിയ കുടിവെള്ള കണക്ഷൻ',
    department: 'Water & Sanitation',
    feeInr: 750,
    slaDays: 7,
    descriptionEn:
      'Domestic metered drinking water tap connection from ABC Gram Panchayat Jal Jeevan distribution line.',
    descriptionMl: 'പഞ്ചായത്ത് കുടിവെള്ള വിതരണ ലൈനിൽ നിന്നുള്ള ഗാർഹിക കണക്ഷൻ.',
    requiredDocsEn: [
      'Property Tax Receipt with Door Number',
      'Applicant Identity Proof (Aadhaar)',
      'Road Cutting Consent (if crossing Panchayat road)',
    ],
    requiredDocsMl: [
      'വീട്ടുനമ്പർ സഹിതമുള്ള നികുതി രസീത്',
      'അപേക്ഷകന്റെ ആധാർ പകർപ്പ്',
      'റോഡ് കട്ടിംഗ് അനുമതി (ആവശ്യമെങ്കിൽ)',
    ],
  },
];

export const TRANSLATIONS = {
  en: {
    brandName: 'ABC Gram Panchayat',
    brandSubtitle: 'Local Self-Government Civic Portal · Kerala',
    navHome: 'Home',
    navGrievance: 'Lodge Grievance',
    navServices: 'E-Services',
    navTrack: 'Track Status',
    langToggle: 'മലയാളം',
    emergencyTitle: '24x7 Emergency Helplines',
    tickerLabel: 'Public Notice',
    notices: [
      'Gram Sabha Ward Meetings scheduled across Wards 1–15 from 28 Nov 2026 at 10:00 AM.',
      'Property Tax 2026–27 online rebate of 5% available for payments completed before 31 Dec 2026.',
      'Monsoon Drain Desilting & Streetlight Maintenance Drive active in all Panchayat wards.',
      'Akshaya CSC Helpdesk open Mon–Sat, 9:30 AM to 5:00 PM at Panchayat Bhavan Ground Floor.',
    ],
    heroKicker: 'Transparent Local Governance · Ward 1 to Ward 15',
    heroTitle: 'Public Grievance Redressal & Citizen E-Services',
    heroDesc:
      'Report local infrastructure issues, apply for statutory Panchayat certificates, and track official action in real time with guaranteed 7-day SLA accountability.',
    heroCtaPrimary: 'Lodge a Grievance',
    heroCtaSecondary: 'Track Application',
    statsResolved: 'Grievances Resolved',
    statsAvgTime: 'Avg. Resolution Time',
    statsActiveServices: 'Active E-Services',
    statsSatisfaction: 'Citizen Rating',
    quickActionsTitle: 'Citizen Services at Your Fingertips',
    quickActionsSubtitle:
      'Submit civic complaints or certificate requests online with instant tracking acknowledgement.',
    qaGrievanceTitle: 'Lodge a Grievance',
    qaGrievanceDesc:
      'Report water leaks, broken streetlights, waste collection, road damage, or public health issues.',
    qaGrievanceBtn: 'Register Complaint',
    qaServiceTitle: 'Apply for E-Services',
    qaServiceDesc:
      'Request Birth/Death Certificates, Residence Certificates, Trade Licenses, and Water Connections.',
    qaServiceBtn: 'Browse 6 Services',
    qaTrackTitle: 'Track Application Status',
    qaTrackDesc:
      'Enter your Grievance or Service Tracking ID to inspect live timeline updates and officer remarks.',
    qaTrackBtn: 'Open Status Tracker',
    formGrievanceTitle: 'Register a Public Grievance',
    formGrievanceSub:
      'Provide exact ward and landmark details so our field officer can inspect and resolve the issue within 7 days.',
    citizenName: 'Citizen Full Name',
    mobileNumber: '10-Digit Mobile Number',
    wardSelection: 'Select Ward (Ward 1 – 15)',
    categoryLabel: 'Grievance Category',
    landmarkLabel: 'Nearest Landmark / Street Name',
    descriptionLabel: 'Detailed Description of Issue',
    photoLabel: 'Photo Evidence (Optional)',
    submitGrievanceBtn: 'Submit Grievance',
    ackTitle: 'Official Acknowledgement Slip',
    ackSub: 'Keep this Tracking ID to monitor inspection and resolution progress.',
    printSlip: 'Print Acknowledgement',
    downloadSlip: 'Download Receipt',
    trackThisNow: 'Track This Application',
    submitAnother: 'Submit Another',
    servicesPageTitle: 'Citizen E-Services & Statutory Certificates',
    servicesPageSub:
      'Select a Panchayat service below, verify required documents, and receive an instant tracking ID.',
    feeLabel: 'Statutory Fee',
    freeLabel: 'Free of Cost',
    slaLabel: 'Processing SLA',
    daysUnit: 'Days',
    applyNowBtn: 'Apply Online',
    requiredDocsTitle: 'Required Document Checklist',
    uploadDocsTitle: 'Attach Supporting Documents (Optional Preview)',
    submitServiceBtn: 'Submit Service Application',
    trackerTitle: 'Live Grievance & Service Tracker',
    trackerSub:
      'Enter a Tracking ID (e.g. ABC-GRV-2026-101 or ABC-SRV-2026-201) or click a sample record below.',
    trackerPlaceholder: 'Enter Tracking ID (e.g. ABC-GRV-2026-101)',
    searchBtn: 'Track Now',
    sampleIdsLabel: 'Sample Tracking IDs:',
    timelineHeading: 'Official Action Timeline',
    beforeAfterHeading: 'Field Evidence & Resolution Proof',
    beforeLabel: 'Reported Issue Photo',
    afterLabel: 'Verified Resolution Proof',
    feedbackHeading: 'Rate Resolution Quality',
    feedbackDesc: 'Your grievance is marked Resolved. Please share your 1–5 star rating.',
    submitFeedbackBtn: 'Submit Citizen Rating',
    feedbackSaved: 'Thank you! Your citizen feedback has been recorded.',
    noRecordFound: 'No grievance or service record matched that Tracking ID.',
  },
  ml: {
    brandName: 'എബിസി ഗ്രാമപഞ്ചായത്ത്',
    brandSubtitle: 'തദ്ദേശ സ്വയംഭരണ പൗരസേവന പോർട്ടൽ · കേരളം',
    navHome: 'ഹോം',
    navGrievance: 'പരാതി നൽകുക',
    navServices: 'ഇ-സേവനങ്ങൾ',
    navTrack: 'നിലവിലെ സ്ഥിതി',
    langToggle: 'English',
    emergencyTitle: '24x7 അടിയന്തര ഹെൽപ്പ്‌ലൈൻ',
    tickerLabel: 'പൊതു അറിയിപ്പ്',
    notices: [
      'വാർഡ് 1 മുതൽ 15 വരെയുള്ള ഗ്രാമസഭ യോഗങ്ങൾ 2026 നവംബർ 28 രാവിലെ 10:00 മണിക്ക് നടക്കും.',
      '2026–27 വസ്തുനികുതി ഡിസംബർ 31-ന് മുൻപ് അടയ്ക്കുന്നവർക്ക് 5% ഇളവ് ലഭ്യമാണ്.',
      'എല്ലാ വാർഡുകളിലും മഴക്കാല ശുചീകരണവും തെരുവുവിളക്ക് അറ്റകുറ്റപ്പണിയും പുരോഗമിക്കുന്നു.',
      'അക്ഷയ സി.എസ്.സി ഹെൽപ്പ്ഡെസ്ക് തിങ്കൾ–ശനി രാവിലെ 9:30 മുതൽ വൈകിട്ട് 5:00 വരെ പ്രവർത്തിക്കുന്നു.',
    ],
    heroKicker: 'സുതാര്യമായ തദ്ദേശ ഭരണം · വാർഡ് 1 മുതൽ 15 വരെ',
    heroTitle: 'പൊതുജന പരാതി പരിഹാരവും പൗര ഇ-സേവന പോർട്ടലും',
    heroDesc:
      'പ്രാദേശിക അടിസ്ഥാന സൗകര്യ പ്രശ്നങ്ങൾ അറിയിക്കുക, പഞ്ചായത്ത് സർട്ടിഫിക്കറ്റുകൾക്ക് അപേക്ഷിക്കുക, 7 ദിവസത്തെ സമയപരിധിക്കുള്ളിൽ നടപടികൾ തത്സമയം പരിശോധിക്കുക.',
    heroCtaPrimary: 'പരാതി സമർപ്പിക്കുക',
    heroCtaSecondary: 'അപേക്ഷ പരിശോധിക്കുക',
    statsResolved: 'പരിഹരിച്ച പരാതികൾ',
    statsAvgTime: 'ശരാശരി പരിഹാര സമയം',
    statsActiveServices: 'സജീവ ഇ-സേവനങ്ങൾ',
    statsSatisfaction: 'പൗര വിലയിരുത്തൽ',
    quickActionsTitle: 'പൗര സേവനങ്ങൾ വിരൽത്തുമ്പിൽ',
    quickActionsSubtitle:
      'ഓൺലൈനായി പരാതികളും സർട്ടിഫിക്കറ്റ് അപേക്ഷകളും നൽകി ഉടൻ ട്രാക്കിംഗ് നമ്പർ നേടൂ.',
    qaGrievanceTitle: 'പരാതി നൽകുക',
    qaGrievanceDesc:
      'കുടിവെള്ള ചോർച്ച, തെരുവുവിളക്ക്, മാലിന്യ നിർമ്മാർജ്ജനം, റോഡ് തകർച്ച എന്നിവ അറിയിക്കുക.',
    qaGrievanceBtn: 'പരാതി രജിസ്റ്റർ ചെയ്യുക',
    qaServiceTitle: 'ഇ-സേവനങ്ങൾക്ക് അപേക്ഷിക്കുക',
    qaServiceDesc:
      'ജനന/മരണ സർട്ടിഫിക്കറ്റ്, താമസ സർട്ടിഫിക്കറ്റ്, വ്യാപാര ലൈസൻസ്, വാട്ടർ കണക്ഷൻ എന്നിവ.',
    qaServiceBtn: '6 സേവനങ്ങൾ കാണുക',
    qaTrackTitle: 'അപേക്ഷയുടെ നിലവിലെ സ്ഥിതി',
    qaTrackDesc:
      'ട്രാക്കിംഗ് ഐഡി നൽകി ഉദ്യോഗസ്ഥരുടെ നടപടികളും പരിഹാര ചിത്രങ്ങളും പരിശോധിക്കുക.',
    qaTrackBtn: 'സ്റ്റാറ്റസ് ട്രാക്കർ തുറക്കുക',
    formGrievanceTitle: 'പൊതുജന പരാതി രജിസ്റ്റർ ചെയ്യുക',
    formGrievanceSub:
      '7 ദിവസത്തിനുള്ളിൽ ഫീൽഡ് പരിശോധനയും പരിഹാരവും ഉറപ്പാക്കാൻ കൃത്യമായ വാർഡും ലാൻഡ്മാർക്കും നൽകുക.',
    citizenName: 'അപേക്ഷകന്റെ പൂർണ്ണ നാമം',
    mobileNumber: '10 അക്ക മൊബൈൽ നമ്പർ',
    wardSelection: 'വാർഡ് തിരഞ്ഞെടുക്കുക (വാർഡ് 1 – 15)',
    categoryLabel: 'പരാതിയുടെ വിഭാഗം',
    landmarkLabel: 'അടുത്തുള്ള ലാൻഡ്മാർക്ക് / റോഡ്',
    descriptionLabel: 'പ്രശ്നത്തിന്റെ വിശദമായ വിവരണം',
    photoLabel: 'ഫോട്ടോ തെളിവ് (നിർബന്ധമില്ല)',
    submitGrievanceBtn: 'പരാതി സമർപ്പിക്കുക',
    ackTitle: 'ഔദ്യോഗിക രസീത് (Acknowledgement Slip)',
    ackSub: 'പുരോഗതി പരിശോധിക്കാൻ ഈ ട്രാക്കിംഗ് ഐഡി സൂക്ഷിക്കുക.',
    printSlip: 'രസീത് പ്രിന്റ് ചെയ്യുക',
    downloadSlip: 'രസീത് ഡൗൺലോഡ് ചെയ്യുക',
    trackThisNow: 'ഇപ്പോൾ ട്രാക്ക് ചെയ്യുക',
    submitAnother: 'മറ്റൊരു പരാതി നൽകുക',
    servicesPageTitle: 'പൗര ഇ-സേവനങ്ങളും സർട്ടിഫിക്കറ്റുകളും',
    servicesPageSub:
      'ആവശ്യമായ സേവനം തിരഞ്ഞെടുത്ത് രേഖകൾ പരിശോധിച്ച് അപേക്ഷ സമർപ്പിക്കുക.',
    feeLabel: 'ഫീസ്',
    freeLabel: 'സൗജന്യം',
    slaLabel: 'സമയപരിധി',
    daysUnit: 'ദിവസം',
    applyNowBtn: 'ഓൺലൈനായി അപേക്ഷിക്കുക',
    requiredDocsTitle: 'ആവശ്യമായ രേഖകളുടെ പട്ടിക',
    uploadDocsTitle: 'രേഖകൾ അറ്റാച്ച് ചെയ്യുക (പ്രിവ്യൂ)',
    submitServiceBtn: 'അപേക്ഷ സമർപ്പിക്കുക',
    trackerTitle: 'തത്സമയ പരാതി & സേവന ട്രാക്കർ',
    trackerSub:
      'ട്രാക്കിംഗ് ഐഡി നൽകുക (ഉദാ: ABC-GRV-2026-101) അല്ലെങ്കിൽ താഴെ കാണുന്ന സാമ്പിൾ ഐഡി ക്ലിക്ക് ചെയ്യുക.',
    trackerPlaceholder: 'ട്രാക്കിംഗ് ഐഡി നൽകുക (ഉദാ: ABC-GRV-2026-101)',
    searchBtn: 'പരിശോധിക്കുക',
    sampleIdsLabel: 'സാമ്പിൾ ട്രാക്കിംഗ് ഐഡികൾ:',
    timelineHeading: 'നടപടി ക്രമങ്ങളുടെ വിവരം',
    beforeAfterHeading: 'ഫീൽഡ് പരിശോധനയും പരിഹാര തെളിവും',
    beforeLabel: 'പരാതിപ്പെടുമ്പോഴുള്ള ചിത്രം',
    afterLabel: 'പരിഹാരത്തിന് ശേഷമുള്ള ചിത്രം',
    feedbackHeading: 'പരിഹാരത്തിന്റെ ഗുണനിലവാരം വിലയിരുത്തുക',
    feedbackDesc: 'നിങ്ങളുടെ പരാതി പരിഹരിക്കപ്പെട്ടു. ദയവായി 1–5 സ്റ്റാർ റേറ്റിംഗ് നൽകുക.',
    submitFeedbackBtn: 'റേറ്റിംഗ് സമർപ്പിക്കുക',
    feedbackSaved: 'നന്ദി! നിങ്ങളുടെ അഭിപ്രായം രേഖപ്പെടുത്തിയിട്ടുണ്ട്.',
    noRecordFound: 'നൽകിയ ട്രാക്കിംഗ് ഐഡിയുമായി പൊരുത്തപ്പെടുന്ന വിവരങ്ങൾ കണ്ടെത്തിയില്ല.',
  },
};

export const CATEGORY_ML = {
  'Water Supply': 'കുടിവെള്ള വിതരണം',
  Streetlights: 'തെരുവുവിളക്കുകൾ',
  'Waste Management': 'മാലിന്യ സംസ്കരണം',
  'Roads & Drainage': 'റോഡുകളും ഓടകളും',
  'Public Health': 'പൊതുജനാരോഗ്യം',
  Encroachment: 'കൈയേറ്റം',
};

export const STATUS_ML = {
  SUBMITTED: 'സമർപ്പിച്ചു',
  ACKNOWLEDGED: 'കൈപ്പറ്റി',
  ASSIGNED: 'ഉദ്യോഗസ്ഥന് നൽകി',
  IN_PROGRESS: 'നടപടി പുരോഗമിക്കുന്നു',
  ON_HOLD: 'താൽക്കാലികമായി നിർത്തി',
  ESCALATED: 'ഉന്നതതലത്തിലേക്ക് മാറ്റി',
  RESOLVED: 'പരിഹരിച്ചു',
  CLOSED: 'അടച്ചുപൂട്ടി',
  REJECTED: 'നിരസിച്ചു',
  REOPENED: 'വീണ്ടും തുറന്നു',
  Pending: 'തീർപ്പാക്കാനുണ്ട്',
  'In Progress': 'നടപടി പുരോഗമിക്കുന്നു',
  'Field Inspection': 'ഫീൽഡ് പരിശോധന',
  Resolved: 'പരിഹരിച്ചു',
  Rejected: 'നിരസിച്ചു',
  Submitted: 'സമർപ്പിച്ചു',
  'Pending Verification': 'പരിശോധന കാത്തിരിക്കുന്നു',
  'Documents Verified': 'രേഖകൾ ശരിവെച്ചു',
  'Correction Needed': 'തിരുത്തൽ ആവശ്യമാണ്',
  Approved: 'അംഗീകരിച്ചു',
};

export const GRIEVANCE_STATUS_LABELS = {
  SUBMITTED: 'Submitted',
  ACKNOWLEDGED: 'Acknowledged',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  REOPENED: 'Reopened',
};

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];

