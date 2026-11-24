export type Language = 'en' | 'ml';

export type PortalMode = 'citizen' | 'admin';

export type CitizenView = 'home' | 'grievance' | 'services' | 'track';

export type AdminView = 'overview' | 'grievances' | 'services' | 'access-control' | 'audit-log';

export type RoleType = 'SUPER_ADMIN' | 'WARD_OFFICER' | 'CSC_OPERATOR' | 'CITIZEN';

export type Department =
  | 'General Administration'
  | 'Roads & Streetlights'
  | 'Water & Sanitation'
  | 'Public Health'
  | 'Revenue & Certificates'
  | 'Building & Planning';

export type GrievanceCategory =
  | 'Water Supply'
  | 'Streetlights'
  | 'Waste Management'
  | 'Roads & Drainage'
  | 'Public Health'
  | 'Encroachment';

export type GrievanceStatus =
  | 'Pending'
  | 'In Progress'
  | 'Field Inspection'
  | 'Resolved'
  | 'Rejected';

export type ServiceStatus =
  | 'Submitted'
  | 'Pending Verification'
  | 'Documents Verified'
  | 'Correction Needed'
  | 'Approved'
  | 'Rejected';

export type ServiceTypeId =
  | 'birth_death'
  | 'residence'
  | 'property_tax'
  | 'trade_license'
  | 'building_permit'
  | 'water_connection';

export interface StaffPermissions {
  canApproveCertificates: boolean;
  canAssignTickets: boolean;
  canManageUsers: boolean;
  canDeleteRecords: boolean;
  canVerifyDocuments: boolean;
}

export interface StaffAccount {
  id: string;
  name: string;
  email: string;
  pin: string;
  designation: string;
  role: Exclude<RoleType, 'CITIZEN'>;
  department: Department;
  assignedWards: number[];
  isActive: boolean;
  permissions: StaffPermissions;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  stepTitle: string;
  actor: string;
  remark: string;
  isInternal?: boolean;
  statusLabel?: string;
}

export interface GrievanceTicket {
  id: string;
  citizenName: string;
  mobile: string;
  ward: number;
  category: GrievanceCategory;
  department: Department;
  landmark: string;
  description: string;
  status: GrievanceStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  assignedOfficerId?: string;
  assignedOfficerName?: string;
  filedByRole?: RoleType;
  beforePhotoUrl?: string;
  afterPhotoUrl?: string;
  publicRemark?: string;
  internalRemark?: string;
  rating?: number;
  feedbackComment?: string;
  timeline: TimelineEvent[];
}

export interface ServiceCatalogItem {
  id: ServiceTypeId;
  titleEn: string;
  titleMl: string;
  department: Department;
  feeInr: number;
  slaDays: number;
  descriptionEn: string;
  descriptionMl: string;
  requiredDocsEn: string[];
  requiredDocsMl: string[];
}

export interface ServiceApplication {
  id: string;
  serviceId: ServiceTypeId;
  serviceName: string;
  applicantName: string;
  mobile: string;
  ward: number;
  address: string;
  department: Department;
  feeInr: number;
  status: ServiceStatus;
  createdAt: string;
  updatedAt: string;
  checkedDocs: string[];
  uploadedDocNames: string[];
  assignedOfficerId?: string;
  assignedOfficerName?: string;
  filedByRole?: RoleType;
  officialRemark?: string;
  timeline: TimelineEvent[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetId: string;
  details: string;
}

export interface PortalState {
  staff: StaffAccount[];
  grievances: GrievanceTicket[];
  services: ServiceApplication[];
  auditLogs: AuditLogEntry[];
  slaLimitDays: number;
}
