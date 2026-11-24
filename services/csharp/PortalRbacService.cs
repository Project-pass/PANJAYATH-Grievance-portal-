using System;
using System.Collections.Generic;
using System.Linq;

namespace AbcGramPanchayat.Portal.Services
{
    public enum RoleType
    {
        Citizen,
        SuperAdmin,
        WardOfficer,
        CscOperator
    }

    [Flags]
    public enum RbacPermission
    {
        None = 0,
        ApproveCertificates = 1,
        AssignTickets = 2,
        ManageUsers = 4,
        DeleteRecords = 8,
        VerifyDocuments = 16
    }

    public sealed record StaffMember(
        string Id,
        string Name,
        string Email,
        RoleType Role,
        string Department,
        IReadOnlyCollection<int> AssignedWards,
        bool IsActive,
        RbacPermission Permissions
    );

    public sealed record SlaAssessment(
        int AgeDays,
        int RemainingDays,
        bool IsBreached,
        bool IsClosed,
        string Label
    );

    public sealed class PortalRbacService
    {
        public bool CanViewRecord(StaffMember? staff, int recordWard, string recordDepartment, string? assignedOfficerId)
        {
            if (staff is null || !staff.IsActive || staff.Role == RoleType.Citizen)
                return false;

            if (staff.Role is RoleType.SuperAdmin or RoleType.CscOperator)
                return true;

            bool inWard = staff.AssignedWards.Contains(recordWard);
            bool matchesDept = string.Equals(staff.Department, recordDepartment, StringComparison.OrdinalIgnoreCase);
            bool directlyAssigned = string.Equals(staff.Id, assignedOfficerId, StringComparison.OrdinalIgnoreCase);

            return inWard && (matchesDept || directlyAssigned);
        }

        public bool CanApproveCertificate(StaffMember? staff) =>
            staff is { IsActive: true } && staff.Permissions.HasFlag(RbacPermission.ApproveCertificates);

        public bool CanAssignTicket(StaffMember? staff) =>
            staff is { IsActive: true } &&
            (staff.Role == RoleType.SuperAdmin || staff.Permissions.HasFlag(RbacPermission.AssignTickets));

        public bool CanManageUsers(StaffMember? staff) =>
            staff is { IsActive: true } && staff.Permissions.HasFlag(RbacPermission.ManageUsers);

        public SlaAssessment EvaluateSla(DateTimeOffset createdAt, string status, int slaLimitDays, DateTimeOffset now)
        {
            int ageDays = Math.Max(0, (int)Math.Floor((now - createdAt).TotalDays));
            bool isClosed = status is "Resolved" or "Rejected" or "Approved";
            int remaining = slaLimitDays - ageDays;
            bool isBreached = !isClosed && ageDays > slaLimitDays;

            string label = isClosed
                ? $"Closed ({ageDays}d)"
                : isBreached
                    ? $"SLA BREACHED ({ageDays}d)"
                    : remaining == 0
                        ? "Due Today"
                        : $"{remaining}d left";

            return new SlaAssessment(ageDays, remaining, isBreached, isClosed, label);
        }
    }
}
