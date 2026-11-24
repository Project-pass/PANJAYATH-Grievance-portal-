package in.gov.abcpanchayat.portal.service;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;

public class GrievanceSlaService {

    public enum RoleType {
        CITIZEN,
        SUPER_ADMIN,
        WARD_OFFICER,
        CSC_OPERATOR
    }

    public record StaffPrincipal(
        String id,
        String name,
        RoleType role,
        String department,
        Set<Integer> assignedWards,
        boolean active,
        boolean canApproveCertificates,
        boolean canAssignTickets,
        boolean canManageUsers,
        boolean canDeleteRecords,
        boolean canVerifyDocuments
    ) {}

    public record SlaStatus(
        long ageDays,
        long remainingDays,
        boolean breached,
        boolean closed,
        String label
    ) {}

    public boolean canViewTicket(
        StaffPrincipal staff,
        int ticketWard,
        String ticketDepartment,
        String assignedOfficerId
    ) {
        if (staff == null || !staff.active() || staff.role() == RoleType.CITIZEN) {
            return false;
        }
        if (staff.role() == RoleType.SUPER_ADMIN || staff.role() == RoleType.CSC_OPERATOR) {
            return true;
        }
        boolean inWard = staff.assignedWards().contains(ticketWard);
        boolean sameDept = staff.department().equalsIgnoreCase(ticketDepartment);
        boolean direct = staff.id().equals(assignedOfficerId);
        return inWard && (sameDept || direct);
    }

    public boolean canApproveCertificate(StaffPrincipal staff) {
        return staff != null && staff.active() && staff.canApproveCertificates();
    }

    public SlaStatus evaluateSla(Instant createdAt, String status, int slaLimitDays, Instant now) {
        long ageDays = Math.max(0, Duration.between(createdAt, now).toDays());
        boolean closed = "Resolved".equals(status) || "Rejected".equals(status) || "Approved".equals(status);
        long remaining = slaLimitDays - ageDays;
        boolean breached = !closed && ageDays > slaLimitDays;

        String label;
        if (closed) {
            label = "Closed (" + ageDays + "d)";
        } else if (breached) {
            label = "SLA BREACHED (" + ageDays + "d)";
        } else if (remaining == 0) {
            label = "Due Today";
        } else {
            label = remaining + "d left";
        }

        return new SlaStatus(ageDays, remaining, breached, closed, label);
    }
}
