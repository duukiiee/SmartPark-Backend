import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

// Helper to ensure all Philippine mobile numbers are normalized to 09XXXXXXXXX in the database
function normalizeToPhilippine09(phoneStr?: string | null): string | null {
  if (!phoneStr || !phoneStr.trim()) return null;
  let clean = phoneStr.trim().replace(/[\s-]/g, "");
  if (clean.startsWith("+63")) clean = "0" + clean.slice(3);
  else if (clean.startsWith("63")) clean = "0" + clean.slice(2);
  else if (!clean.startsWith("0") && clean.startsWith("9")) clean = "0" + clean;
  return clean;
}

// Canonical account status values. Must match the casing checked in authMiddleware.ts
const ACCOUNT_STATUSES = ["Active", "PendingActivation", "Inactive", "Suspended", "Deactivated", "Locked"];

// Normalizes incoming status casing (e.g. "ACTIVE" -> "Active"); returns null if unknown
function normalizeAccountStatus(status: unknown): string | null {
  if (typeof status !== "string") return null;
  const match = ACCOUNT_STATUSES.find((s) => s.toLowerCase() === status.trim().toLowerCase());
  return match ?? null;
}

const router = Router();

// Protect all account routes with requireAuth and requireRole ADMIN / SUPER_ADMIN
router.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

// 1. GET /api/admin/accounts
router.get("/accounts", async (req, res, next) => {
  try {
    const search = (req.query.search as string)?.trim() || "";
    const rawTab = (req.query.tab as string)?.trim() || "All";
    const status = (req.query.status as string) || "All";
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    const lowerTab = rawTab.toLowerCase();
    if (lowerTab === "administrators" || lowerTab === "admin" || lowerTab === "administrator") {
      where.role = { in: ["ADMIN", "SUPER_ADMIN", "admin", "super_admin"] };
    } else if (lowerTab === "guards" || lowerTab === "guard") {
      where.role = { in: ["GUARD", "guard", "Guard"] };
    } else if (lowerTab === "users" || lowerTab === "user") {
      where.role = { in: ["USER", "user", "STUDENT", "student"] };
    }

    if (status && status !== "All") {
      where.accountStatus = status;
    } else {
      // Exclude PendingVerification accounts from account and user management listings
      where.accountStatus = { not: "PendingVerification" };
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { schoolId: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rawAccounts, total, totalAccountsCount, totalAdminsCount, totalGuardsCount, totalUsersCount] = await Promise.all([
      db.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          schoolId: true,
          phone: true,
          avatar: true,
          role: true,
          accountType: true,
          accountStatus: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.user.count({ where }),
      db.user.count({ where: { accountStatus: { not: "PendingVerification" } } }),
      db.user.count({ where: { role: { in: ["ADMIN", "SUPER_ADMIN", "admin", "super_admin"] }, accountStatus: { not: "PendingVerification" } } }),
      db.user.count({ where: { role: { in: ["GUARD", "guard", "Guard"] }, accountStatus: { not: "PendingVerification" } } }),
      db.user.count({ where: { role: { in: ["USER", "user", "STUDENT", "student"] }, accountStatus: { not: "PendingVerification" } } }),
    ]);

    const accounts = rawAccounts.map((u) => ({
      ...u,
      name: `${u.firstName} ${u.lastName}`,
      status: u.accountStatus,
      studentId: u.schoolId,
      employeeId: u.schoolId,
      phoneNumber: u.phone,
      dateCreated: u.createdAt,
      lastUpdated: u.updatedAt,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      accounts,
      metrics: {
        totalAccounts: totalAccountsCount,
        totalAdmins: totalAdminsCount,
        totalGuards: totalGuardsCount,
        totalUsers: totalUsersCount,
      },
      pagination: {
        total,
        page,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 2. GET /api/admin/accounts/:id
router.get("/accounts/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid account ID" });
    }

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        schoolId: true,
        phone: true,
        avatar: true,
        role: true,
        accountType: true,
        accountStatus: true,
        createdAt: true,
        updatedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    return res.status(200).json({
      success: true,
      account: {
        ...user,
        name: `${user.firstName} ${user.lastName}`,
        status: user.accountStatus,
        studentId: user.schoolId,
        employeeId: user.schoolId,
        phoneNumber: user.phone,
        dateCreated: user.createdAt,
        lastUpdated: user.updatedAt,
        suspendedUntil: user.suspendedUntil,
        suspensionReason: user.suspensionReason,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 3. PATCH /api/admin/accounts/:id
router.patch("/accounts/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid account ID" });
    }

    const targetUser = await db.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    const currentUser = req.user!;
    const isRegularAdmin = currentUser.role?.toUpperCase() === "ADMIN";
    const targetRole = targetUser.role?.toUpperCase();

    if (targetRole === "USER") {
      return res.status(403).json({
        success: false,
        message: "Access denied. User profiles cannot be edited by administrators. Users manage their own profiles.",
      });
    }

    if (isRegularAdmin && (targetRole === "ADMIN" || targetRole === "SUPER_ADMIN")) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Administrators cannot modify Administrator or Super Administrator accounts.",
      });
    }

    const { firstName, lastName, email, schoolId, phone, role, accountStatus } = req.body;

    if (isRegularAdmin && role && ["ADMIN", "SUPER_ADMIN"].includes(role.toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Administrators cannot assign Administrator or Super Administrator roles.",
      });
    }

    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if (email !== undefined) updateData.email = email.trim().toLowerCase();
    if (schoolId !== undefined) updateData.schoolId = schoolId.trim();
    if (phone !== undefined) updateData.phone = normalizeToPhilippine09(phone);
    if (role !== undefined) updateData.role = role.toUpperCase();
    if (accountStatus !== undefined) {
      const canonicalStatus = normalizeAccountStatus(accountStatus);
      if (!canonicalStatus) {
        return res.status(400).json({ success: false, message: "Invalid account status" });
      }
      updateData.accountStatus = canonicalStatus;
    }

    const updatedUser = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        schoolId: true,
        phone: true,
        avatar: true,
        role: true,
        accountType: true,
        accountStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Account updated successfully",
      account: {
        ...updatedUser,
        name: `${updatedUser.firstName} ${updatedUser.lastName}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 4. PATCH /api/admin/accounts/:id/status
router.patch("/accounts/:id/status", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid account ID" });
    }

    const { status: rawStatus } = req.body;
    if (!rawStatus) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }

    const status = normalizeAccountStatus(rawStatus);
    if (!status) {
      return res.status(400).json({ success: false, message: "Invalid account status" });
    }

    const targetUser = await db.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    const currentUser = req.user!;
    const isRegularAdmin = currentUser.role?.toUpperCase() === "ADMIN";
    const targetRole = targetUser.role?.toUpperCase();

    if (targetRole === "USER") {
      return res.status(403).json({
        success: false,
        message: "Access denied. User profiles cannot be edited by administrators. Users manage their own profiles.",
      });
    }

    if (isRegularAdmin && (targetRole === "ADMIN" || targetRole === "SUPER_ADMIN")) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Administrators cannot change status of Administrator or Super Administrator accounts.",
      });
    }

    const updatedUser = await db.user.update({
      where: { id },
      data: { accountStatus: status },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        schoolId: true,
        phone: true,
        avatar: true,
        role: true,
        accountType: true,
        accountStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Account status updated successfully",
      account: {
        ...updatedUser,
        name: `${updatedUser.firstName} ${updatedUser.lastName}`,
      },
    });
  } catch (error) {
    next(error);
  }
});


// 5. POST /api/admin/accounts/:id/suspend
router.post("/accounts/:id/suspend", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { durationDays, suspendedUntil, reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: "Reason is required" });
    let suspensionDate = suspendedUntil ? new Date(suspendedUntil) : new Date(Date.now() + (durationDays || 0) * 24 * 60 * 60 * 1000);
    const updatedUser = await db.user.update({
      where: { id },
      data: { accountStatus: "Suspended", suspendedUntil: suspensionDate, suspensionReason: reason.trim() },
    });
    return res.status(200).json({ success: true, account: updatedUser });
  } catch (error) { next(error); }
});

// 6. POST /api/admin/accounts/:id/deactivate
router.post("/accounts/:id/deactivate", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        const updatedUser = await db.user.update({ where: { id }, data: { accountStatus: "Deactivated" } });
        return res.status(200).json({ success: true, account: updatedUser });
    } catch (error) { next(error); }
});

// 7. POST /api/admin/accounts/:id/set-status
router.post("/accounts/:id/set-status", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        const status = normalizeAccountStatus(req.body.status);
        if (!status) return res.status(400).json({ success: false, message: "Invalid account status" });
        const data: any = { accountStatus: status };
        if (status === "Active") { data.suspendedUntil = null; data.suspensionReason = null; }
        const updatedUser = await db.user.update({ where: { id }, data });
        return res.status(200).json({ success: true, account: updatedUser });
    } catch (error) { next(error); }
});

// 8. GET /api/admin/appeals
router.get("/appeals", async (req, res, next) => {
  try {
    const currentUser = req.user!;
    const isSuperAdmin = currentUser.role?.toUpperCase() === "SUPER_ADMIN";

    // RBAC: Super Admin can view Admin, Guard, User appeals. Admin can view Guard, User appeals only.
    const roleFilter = isSuperAdmin
      ? ["ADMIN", "SUPER_ADMIN", "GUARD", "USER", "STUDENT"]
      : ["GUARD", "USER", "STUDENT"];

    const appeals = await db.appeal.findMany({
      where: {
        user: {
          role: { in: roleFilter },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            schoolId: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const pendingAppealsCount = appeals.filter((a: any) => a.status === "Pending").length;

    return res.status(200).json({
      success: true,
      appeals: appeals.map((a: any) => ({
        id: a.id,
        referenceId: a.referenceId,
        subject: a.subject,
        reason: a.reason,
        additionalInfo: a.additionalInfo,
        status: a.status,
        createdAt: a.createdAt,
        user: {
          id: a.user.id,
          name: `${a.user.firstName} ${a.user.lastName}`,
          email: a.user.email,
          role: a.user.role,
          schoolId: a.user.schoolId,
          avatar: a.user.avatar,
        },
      })),
      metrics: {
        pendingAppeals: pendingAppealsCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 9. PATCH /api/admin/appeals/:id/review
router.patch("/appeals/:id/review", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid appeal ID" });
    }
    const { action } = req.body; // "Approved" | "Rejected"
    if (!["Approved", "Rejected"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid action. Must be 'Approved' or 'Rejected'." });
    }

    const appeal = await db.appeal.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!appeal) {
      return res.status(404).json({ success: false, message: "Appeal not found" });
    }

    const currentUser = req.user!;
    const isSuperAdmin = currentUser.role?.toUpperCase() === "SUPER_ADMIN";
    const targetRole = appeal.user.role?.toUpperCase();

    // Regular admin cannot review Admin/Super Admin appeals
    if (!isSuperAdmin && (targetRole === "ADMIN" || targetRole === "SUPER_ADMIN")) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only Super Administrators can review administrator appeals.",
      });
    }

    const updatedAppeal = await db.appeal.update({
      where: { id },
      data: {
        status: action,
        reviewedBy: `Admin (${currentUser.email})`,
        reviewedAt: new Date(),
      },
    });

    // If Approved, lift user suspension and set status back to Active
    if (action === "Approved") {
      await db.user.update({
        where: { id: appeal.userId },
        data: {
          accountStatus: "Active",
          suspendedUntil: null,
          suspensionReason: null,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Appeal marked as ${action} successfully.`,
      appeal: updatedAppeal,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

