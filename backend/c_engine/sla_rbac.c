#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * ABC Gram Panchayat — Native C SLA & RBAC Rule Engine
 * Compiled with GCC and invoked by the Python 3 backend.
 *
 * Role codes:
 *   0 = CITIZEN
 *   1 = SUPER_ADMIN (Panchayat Secretary)
 *   2 = WARD_OFFICER
 *   3 = CSC_OPERATOR
 *
 * Permission bitmask:
 *   1  = canApproveCertificates
 *   2  = canAssignTickets
 *   4  = canManageUsers
 *   8  = canDeleteRecords
 *   16 = canVerifyDocuments
 */

#define ROLE_CITIZEN 0
#define ROLE_SUPER_ADMIN 1
#define ROLE_WARD_OFFICER 2
#define ROLE_CSC_OPERATOR 3

#define PERM_APPROVE_CERT 1
#define PERM_ASSIGN_TICKET 2
#define PERM_MANAGE_USERS 4
#define PERM_DELETE_RECORDS 8
#define PERM_VERIFY_DOCS 16

static int handle_sla(int argc, char *argv[]) {
    if (argc < 5) {
        fprintf(stderr, "Usage: sla_rbac sla <age_days> <sla_limit_days> <is_closed>\n");
        return 1;
    }

    int age_days = atoi(argv[2]);
    int sla_limit = atoi(argv[3]);
    int is_closed = atoi(argv[4]);

    if (age_days < 0) age_days = 0;
    if (sla_limit < 1) sla_limit = 7;

    int remaining = sla_limit - age_days;
    int is_breached = (!is_closed && age_days > sla_limit) ? 1 : 0;

    char label[64];
    if (is_closed) {
        snprintf(label, sizeof(label), "Closed (%dd)", age_days);
    } else if (is_breached) {
        snprintf(label, sizeof(label), "SLA BREACHED (%dd)", age_days);
    } else if (remaining == 0) {
        snprintf(label, sizeof(label), "Due Today");
    } else {
        snprintf(label, sizeof(label), "%dd left", remaining);
    }

    printf("{\"ageDays\":%d,\"remainingDays\":%d,\"isBreached\":%s,\"isClosed\":%s,\"label\":\"%s\"}\n",
           age_days,
           remaining,
           is_breached ? "true" : "false",
           is_closed ? "true" : "false",
           label);
    return 0;
}

static int handle_rbac(int argc, char *argv[]) {
    if (argc < 8) {
        fprintf(stderr, "Usage: sla_rbac rbac <role_code> <perm_mask> <ward_mask> <target_ward> <same_dept> <action>\n");
        return 1;
    }

    int role = atoi(argv[2]);
    int perm_mask = atoi(argv[3]);
    int ward_mask = atoi(argv[4]);
    int target_ward = atoi(argv[5]);
    int same_dept = atoi(argv[6]);
    const char *action = argv[7];

    int allowed = 0;
    const char *reason = "Access denied by Panchayat RBAC policy.";

    if (role == ROLE_CITIZEN) {
        printf("{\"allowed\":false,\"reason\":\"Citizen role has no administrative privileges.\"}\n");
        return 0;
    }

    int ward_bit = (target_ward >= 1 && target_ward <= 15) ? (1 << (target_ward - 1)) : 0;
    int in_ward = (role == ROLE_SUPER_ADMIN || role == ROLE_CSC_OPERATOR) ? 1 : ((ward_mask & ward_bit) != 0);

    if (strcmp(action, "VIEW") == 0) {
        if (role == ROLE_SUPER_ADMIN || role == ROLE_CSC_OPERATOR) {
            allowed = 1;
            reason = "Full ward visibility granted.";
        } else if (role == ROLE_WARD_OFFICER && in_ward && same_dept) {
            allowed = 1;
            reason = "Ward and department jurisdiction matched.";
        } else {
            reason = "Outside assigned ward or department scope.";
        }
    } else if (strcmp(action, "UPDATE") == 0) {
        if (role == ROLE_SUPER_ADMIN || role == ROLE_CSC_OPERATOR) {
            allowed = 1;
            reason = "Authorized to update record.";
        } else if (role == ROLE_WARD_OFFICER && in_ward && same_dept) {
            allowed = 1;
            reason = "Ward officer update permitted within jurisdiction.";
        } else {
            reason = "Cannot modify ticket outside assigned ward/department.";
        }
    } else if (strcmp(action, "ASSIGN") == 0) {
        if (role == ROLE_SUPER_ADMIN || (perm_mask & PERM_ASSIGN_TICKET)) {
            allowed = 1;
            reason = "Ticket assignment permission verified.";
        } else {
            reason = "Permission denied: Assign Tickets authority required.";
        }
    } else if (strcmp(action, "VERIFY") == 0) {
        if (role == ROLE_SUPER_ADMIN || (perm_mask & PERM_VERIFY_DOCS)) {
            allowed = 1;
            reason = "Document verification permission verified.";
        } else {
            reason = "Permission denied: Verify Documents authority required.";
        }
    } else if (strcmp(action, "APPROVE_CERT") == 0) {
        if (perm_mask & PERM_APPROVE_CERT) {
            allowed = 1;
            reason = "Certificate approval authority verified.";
        } else {
            reason = "Permission denied: Approve Certificates authority required.";
        }
    } else if (strcmp(action, "MANAGE_USERS") == 0) {
        if (perm_mask & PERM_MANAGE_USERS) {
            allowed = 1;
            reason = "User and RBAC management authority verified.";
        } else {
            reason = "Permission denied: Manage Users authority required.";
        }
    } else if (strcmp(action, "DELETE") == 0) {
        if (perm_mask & PERM_DELETE_RECORDS) {
            allowed = 1;
            reason = "Record deletion authority verified.";
        } else {
            reason = "Permission denied: Delete Records authority required.";
        }
    }

    printf("{\"allowed\":%s,\"reason\":\"%s\"}\n", allowed ? "true" : "false", reason);
    return 0;
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: sla_rbac <sla|rbac> ...\n");
        return 1;
    }

    if (strcmp(argv[1], "sla") == 0) {
        return handle_sla(argc, argv);
    }
    if (strcmp(argv[1], "rbac") == 0) {
        return handle_rbac(argc, argv);
    }

    fprintf(stderr, "Unknown command: %s\n", argv[1]);
    return 1;
}
