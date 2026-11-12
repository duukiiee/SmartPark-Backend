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

const router = Router();

// Protect all account routes with requireAuth and requireRole ADMIN / SUPER_ADMIN
router.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

// 1. GET /api/admin/accounts
router.get("/accounts", async (req, res, next) => {
  try {
    const search = (req.query.search as string)?.trim() || "";
    const tab = (req.query.tab as string) || "All";
    const status = (req.query.status as string) || "All";
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (tab === "Administrators") {
      where.role = { in: ["ADMIN", "SUPER_ADMIN"] };
    } else if (tab === "Guards") {
      where.role = "GUARD";
    } else if (tab === "Users") {
      where.role = "USER";
    }

    if (status && status !== "All") {
      where.accountStatus = status;
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
      db.user.count(),
      db.user.count({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } }),
      db.user.count({ where: { role: "GUARD" } }),
      db.user.count({ where: { role: "USER" } }),
    ]);

    const accounts = rawAccounts.map((u) => ({
      ...u,
      name: `${u.firstName} ${u.lastName}`,
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
    if (accountStatus !== undefined) updateData.accountStatus = accountStatus;

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

    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: "Status is required" });
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

export default router;

