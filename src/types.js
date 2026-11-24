/**
 * @typedef {Object} StaffPermissions
 * @property {boolean} canApproveCertificates
 * @property {boolean} canAssignTickets
 * @property {boolean} canManageUsers
 * @property {boolean} canDeleteRecords
 * @property {boolean} canVerifyDocuments
 */

/**
 * @typedef {'SUPER_ADMIN' | 'WARD_OFFICER' | 'CSC_OPERATOR'} StaffRole
 */

/**
 * @typedef {Object} StaffMember
 * @property {string} id
 * @property {string} [username]
 * @property {string} name
 * @property {string} email
 * @property {string} designation
 * @property {StaffRole} role
 * @property {string} department
 * @property {number[]} assignedWards
 * @property {boolean} isActive
 * @property {boolean} [isClaimed]
 * @property {boolean} [mustChangePassword]
 * @property {StaffPermissions} permissions
 */

/**
 * @typedef {Object} SlaInfo
 * @property {number} ageDays
 * @property {number} remainingDays
 * @property {boolean} isBreached
 * @property {boolean} isClosed
 * @property {boolean} isOnHold
 * @property {string} label
 */

/**
 * @typedef {Object} TimelineEntry
 * @property {string} timestamp
 * @property {string} [status]
 * @property {string} [stepTitle]
 * @property {string} [remark]
 * @property {string} [note]
 * @property {string} actor
 */

/**
 * @typedef {Object} GrievanceComment
 * @property {string} id
 * @property {string} authorName
 * @property {string} authorRole
 * @property {string} body
 * @property {boolean} isInternal
 * @property {string} createdAt
 */

/**
 * @typedef {Object} GrievanceFeedback
 * @property {number} rating
 * @property {string} [comment]
 * @property {string} [submittedAt]
 */

/**
 * @typedef {Object} GrievanceTicket
 * @property {string} id
 * @property {string} [externalUuid]
 * @property {string} [citizenName]
 * @property {string} [citizenDisplay]
 * @property {string} [mobile]
 * @property {string} [mobileLast4]
 * @property {number} ward
 * @property {string} category
 * @property {string} [priority]
 * @property {number} [escalationLevel]
 * @property {number} [slaLimitDays]
 * @property {string} department
 * @property {string} landmark
 * @property {string} description
 * @property {string} status
 * @property {string} [assignedOfficerId]
 * @property {string} [assignedOfficerName]
 * @property {string} [publicRemark]
 * @property {string} [internalRemark]
 * @property {string} [beforePhotoUrl]
 * @property {string} [afterPhotoUrl]
 * @property {number | null} [rating]
 * @property {string | null} [feedbackComment]
 * @property {number} [reopenCount]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {SlaInfo} [sla]
 * @property {TimelineEntry[]} [timeline]
 * @property {GrievanceComment[]} [comments]
 * @property {GrievanceFeedback | null} [feedback]
 */

/**
 * @typedef {Object} ServiceApplication
 * @property {string} id
 * @property {string} [externalUuid]
 * @property {string} serviceId
 * @property {string} serviceName
 * @property {string} [applicantName]
 * @property {string} [applicantDisplay]
 * @property {string} [mobile]
 * @property {string} [mobileLast4]
 * @property {number} ward
 * @property {string} [address]
 * @property {string} department
 * @property {number} feeInr
 * @property {number} [slaLimitDays]
 * @property {string} status
 * @property {string} [assignedOfficerId]
 * @property {string} [assignedOfficerName]
 * @property {string} [officialRemark]
 * @property {string[]} [checkedDocs]
 * @property {string[]} [uploadedDocNames]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {SlaInfo} [sla]
 * @property {TimelineEntry[]} [timeline]
 */

/**
 * @typedef {Object} PublicOverviewStats
 * @property {number} resolvedCount
 * @property {number} totalCount
 * @property {string} avgDays
 * @property {number} activeServicesCount
 * @property {string} avgRating
 * @property {number} ratingCount
 */

/**
 * @typedef {Object} ServiceCatalogItem
 * @property {string} id
 * @property {string} titleEn
 * @property {string} titleMl
 * @property {string} department
 * @property {number} feeInr
 * @property {number} slaDays
 * @property {string} descriptionEn
 * @property {string} descriptionMl
 * @property {string[]} requiredDocsEn
 * @property {string[]} requiredDocsMl
 */

/**
 * @typedef {Object} RecentWorkItem
 * @property {string} id
 * @property {number} ward
 * @property {string} category
 * @property {string} [department]
 * @property {string} [priority]
 * @property {string} status
 * @property {string} landmark
 * @property {string} [publicRemark]
 * @property {string} [beforePhotoUrl]
 * @property {string} [afterPhotoUrl]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} PublicOverview
 * @property {number} slaLimitDays
 * @property {Record<string, number>} categorySlaDays
 * @property {PublicOverviewStats} stats
 * @property {RecentWorkItem[]} recentWorks
 * @property {ServiceCatalogItem[]} serviceCatalog
 */

/**
 * @typedef {Object} AuditLogEntry
 * @property {string} id
 * @property {string} timestamp
 * @property {string} [actorId]
 * @property {string} actorName
 * @property {string} actorRole
 * @property {string} action
 * @property {string} targetId
 * @property {string} details
 * @property {string} [sessionPrefix]
 * @property {number} [seqNo]
 * @property {string} [prevHash]
 * @property {string} [eventHash]
 */

/**
 * @typedef {Object} SecurityAlert
 * @property {string} id
 * @property {string} timestamp
 * @property {string} severity
 * @property {string} eventType
 * @property {string} summary
 * @property {string} [actorHint]
 * @property {string} [details]
 * @property {string} [actorIp]
 */

/**
 * @typedef {Object} NotificationEntry
 * @property {string} id
 * @property {string} createdAt
 * @property {string} [recipientId]
 * @property {string} [targetId]
 * @property {string} channel
 * @property {string} subject
 * @property {string} message
 */

/**
 * @typedef {Object} AuditRetentionInfo
 * @property {number} [retentionDays]
 * @property {number} [retentionPolicyDays]
 * @property {number} [totalRecords]
 * @property {number} [totalAuditRecords]
 * @property {boolean} [immutableTriggersActive]
 * @property {number} [headSeqNo]
 * @property {string} [headEventHash]
 */

/**
 * @typedef {Object} StaffDashboard
 * @property {number} slaLimitDays
 * @property {GrievanceTicket[]} grievances
 * @property {ServiceApplication[]} services
 * @property {StaffMember[]} staff
 * @property {AuditLogEntry[]} auditLogs
 * @property {SecurityAlert[]} securityAlerts
 * @property {NotificationEntry[]} notifications
 * @property {AuditRetentionInfo | null} auditRetention
 */

/**
 * @typedef {Object} TrackedRecord
 * @property {'grievance' | 'service'} kind
 * @property {string} id
 * @property {string} [externalUuid]
 * @property {number} ward
 * @property {string} status
 * @property {string} department
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {number} [slaLimitDays]
 * @property {number} [escalationLevel]
 * @property {string} [assignedOfficerName]
 * @property {string} [category]
 * @property {string} [priority]
 * @property {string} [landmark]
 * @property {string} [description]
 * @property {string} [citizenDisplay]
 * @property {string} [publicRemark]
 * @property {string} [beforePhotoUrl]
 * @property {string} [afterPhotoUrl]
 * @property {number | null} [rating]
 * @property {string | null} [feedbackComment]
 * @property {number} [reopenCount]
 * @property {GrievanceFeedback | null} [feedback]
 * @property {GrievanceComment[]} [comments]
 * @property {string} [serviceName]
 * @property {string} [applicantDisplay]
 * @property {number} [feeInr]
 * @property {string} [officialRemark]
 * @property {string[]} [checkedDocs]
 * @property {TimelineEntry[]} [timeline]
 * @property {SlaInfo} [sla]
 */

/**
 * @typedef {Object} AdminFilters
 * @property {string} search
 * @property {string} status
 * @property {string} ward
 * @property {string} category
 * @property {string} priority
 * @property {boolean} slaOverdueOnly
 * @property {string} auditSearch
 * @property {number} page
 * @property {number} pageSize
 */

/**
 * @typedef {Object} PortalStore
 * @property {PublicOverview} publicOverview
 * @property {StaffDashboard} staffDashboard
 * @property {string | null} csrfToken
 * @property {StaffMember | null} currentUser
 * @property {boolean} bootstrapRequired
 * @property {boolean} envPasscodeConfigured
 * @property {import('firebase/auth').User | null} firebaseUser
 * @property {boolean} isSubmitting
 * @property {'en' | 'ml'} language
 * @property {'citizen' | 'admin'} portalMode
 * @property {'home' | 'grievance' | 'services' | 'track'} citizenView
 * @property {string} adminView
 * @property {boolean} mobileMenuOpen
 * @property {boolean} mobileSidebarOpen
 * @property {string} trackQuery
 * @property {string} trackToken
 * @property {string} trackMobileLast4
 * @property {TrackedRecord | null} trackedRecord
 * @property {string} trackError
 * @property {number} ratingDraft
 * @property {ServiceCatalogItem | null} selectedService
 * @property {GrievanceTicket | null} submittedGrievance
 * @property {string} submittedGrievanceToken
 * @property {Array<{id: string, status: string, category: string, ward: number, landmark?: string}>} submittedDuplicates
 * @property {ServiceApplication | null} submittedService
 * @property {string} submittedServiceToken
 * @property {string} gPhotoPreview
 * @property {string[]} serviceCheckedDocs
 * @property {string[]} serviceUploadedFiles
 * @property {AdminFilters} adminFilters
 * @property {string | null} selectedGrievanceId
 * @property {string | null} selectedServiceId
 * @property {'grievance' | 'service' | null} walkInType
 * @property {boolean} staffModalOpen
 * @property {string | null} editingStaffId
 * @property {number[]} staffModalWards
 * @property {Set<() => void>} listeners
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate `/api/public/overview` payload at runtime boundary.
 * @param {unknown} data
 * @param {PublicOverview} fallback
 * @returns {PublicOverview}
 */
export function parsePublicOverviewPayload(data, fallback) {
  if (!isPlainObject(data) || data.ok !== true || !isPlainObject(data.stats)) {
    throw new Error('Invalid /api/public/overview response payload.');
  }
  return {
    slaLimitDays: typeof data.slaLimitDays === 'number' ? data.slaLimitDays : 7,
    categorySlaDays: isPlainObject(data.categorySlaDays) ? data.categorySlaDays : {},
    stats: {
      resolvedCount: Number(data.stats.resolvedCount || 0),
      totalCount: Number(data.stats.totalCount || 0),
      avgDays: String(data.stats.avgDays ?? fallback.stats.avgDays),
      activeServicesCount: Number(data.stats.activeServicesCount ?? fallback.stats.activeServicesCount),
      avgRating: String(data.stats.avgRating ?? fallback.stats.avgRating),
      ratingCount: Number(data.stats.ratingCount || 0),
    },
    recentWorks: Array.isArray(data.recentWorks) ? data.recentWorks : [],
    serviceCatalog: Array.isArray(data.serviceCatalog) ? data.serviceCatalog : [],
  };
}

/**
 * Validate `/api/staff/dashboard` payload at runtime boundary.
 * @param {unknown} data
 * @returns {{ user: StaffMember, dashboard: StaffDashboard }}
 */
export function parseStaffDashboardPayload(data) {
  if (!isPlainObject(data) || data.ok !== true || !isPlainObject(data.user)) {
    throw new Error('Invalid /api/staff/dashboard response payload.');
  }
  if (!Array.isArray(data.grievances) || !Array.isArray(data.services)) {
    throw new Error('Malformed grievance or service arrays in /api/staff/dashboard.');
  }
  return {
    user: /** @type {StaffMember} */ (data.user),
    dashboard: {
      slaLimitDays: typeof data.slaLimitDays === 'number' ? data.slaLimitDays : 7,
      grievances: data.grievances,
      services: data.services,
      staff: Array.isArray(data.staff) ? data.staff : [],
      auditLogs: Array.isArray(data.auditLogs) ? data.auditLogs : [],
      securityAlerts: Array.isArray(data.securityAlerts) ? data.securityAlerts : [],
      notifications: Array.isArray(data.notifications) ? data.notifications : [],
      auditRetention: isPlainObject(data.auditRetention)
        ? /** @type {AuditRetentionInfo} */ (data.auditRetention)
        : null,
    },
  };
}

/**
 * Validate `/api/public/track` record payload at runtime boundary.
 * @param {unknown} record
 * @returns {TrackedRecord}
 */
export function parseTrackedRecordPayload(record) {
  if (
    !isPlainObject(record) ||
    typeof record.id !== 'string' ||
    (record.kind !== 'grievance' && record.kind !== 'service') ||
    typeof record.status !== 'string'
  ) {
    throw new Error('Malformed tracked application payload.');
  }
  return /** @type {TrackedRecord} */ (record);
}
