import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export const studentVehicleRoutes = Router();
export const adminVehicleRoutes = Router();

// ====================================================================
// STUDENT VEHICLE ROUTES (/api/vehicles)
// ====================================================================
studentVehicleRoutes.use(requireAuth);

// 1. GET /api/vehicles/my-vehicles - List logged in user's vehicles
studentVehicleRoutes.get("/my-vehicles", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const vehicles = await db.vehicle.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      vehicles,
    });
  } catch (error) {
    next(error);
  }
});

// 2. POST /api/vehicles - Register a vehicle
studentVehicleRoutes.post("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { type, plateNumber, brand, model, color, year } = req.body;

    if (!type || !plateNumber || !brand || !model || !color || !year) {
      return res.status(400).json({
        success: false,
        message: "All vehicle details (type, plateNumber, brand, model, color, year) are required",
      });
    }

    const normalizedPlate = plateNumber.trim().toUpperCase();

    // Check if plateNumber already exists
    const existingVehicle = await db.vehicle.findUnique({
      where: { plateNumber: normalizedPlate },
    });

    if (existingVehicle) {
      return res.status(400).json({
        success: false,
        message: "Plate number is already registered",
      });
    }

    const newVehicle = await db.vehicle.create({
      data: {
        userId,
        type: type.trim(),
        plateNumber: normalizedPlate,
        brand: brand.trim(),
        model: model.trim(),
        color: color.trim(),
        year: year.toString().trim(),
        status: "Pending",
        registrationSource: "Online",
      },
    });

    return res.status(201).json({
      success: true,
      message: "Vehicle registered successfully",
      vehicle: newVehicle,
    });
  } catch (error) {
    next(error);
  }
});

// 3. PATCH /api/vehicles/:id - Update vehicle (user must own it)
studentVehicleRoutes.patch("/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const vehicleId = parseInt(req.params.id, 10);

    if (isNaN(vehicleId)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID" });
    }

    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle || vehicle.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found or unauthorized",
      });
    }

    const { type, plateNumber, brand, model, color, year } = req.body;
    const updateData: any = {};

    if (type) updateData.type = type.trim();
    if (brand) updateData.brand = brand.trim();
    if (model) updateData.model = model.trim();
    if (color) updateData.color = color.trim();
    if (year) updateData.year = year.toString().trim();

    if (plateNumber) {
      const normalizedPlate = plateNumber.trim().toUpperCase();
      if (normalizedPlate !== vehicle.plateNumber) {
        const existing = await db.vehicle.findUnique({
          where: { plateNumber: normalizedPlate },
        });
        if (existing) {
          return res.status(400).json({
            success: false,
            message: "Plate number is already registered",
          });
        }
        updateData.plateNumber = normalizedPlate;
      }
    }

    // If vehicle was previously Approved and student changes details, revert to Pending for re-clearance
    const hasAnyChange = Object.keys(updateData).length > 0;
    if (vehicle.status === "Approved" && hasAnyChange) {
      updateData.status = "Pending";
      updateData.approvedAt = null;
    }

    const updatedVehicle = await db.vehicle.update({
      where: { id: vehicleId },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle updated successfully",
      vehicle: updatedVehicle,
    });
  } catch (error) {
    next(error);
  }
});

// 4. POST /api/vehicles/:id/deactivate - Deactivate vehicle
studentVehicleRoutes.post("/:id/deactivate", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const vehicleId = parseInt(req.params.id, 10);

    if (isNaN(vehicleId)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID" });
    }

    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle || vehicle.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found or unauthorized",
      });
    }

    const updatedVehicle = await db.vehicle.update({
      where: { id: vehicleId },
      data: { status: "Inactive" },
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle deactivated successfully",
      vehicle: updatedVehicle,
    });
  } catch (error) {
    next(error);
  }
});

// 5. GET /api/vehicles/:id/qr - Get vehicle QR code pass
studentVehicleRoutes.get("/:id/qr", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const vehicleId = parseInt(req.params.id, 10);

    if (isNaN(vehicleId)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID" });
    }

    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle || vehicle.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found or unauthorized",
      });
    }

    if (vehicle.status === "Pending" || vehicle.status === "Rejected") {
      return res.status(403).json({
        success: false,
        message: "QR Pass is only available for Approved vehicles",
      });
    }

    return res.status(200).json({
      success: true,
      qrCode: vehicle.qrCode || `SP-${vehicle.plateNumber.replace(/\s+/g, "")}`,
      plateNumber: vehicle.plateNumber,
      status: vehicle.status,
    });
  } catch (error) {
    next(error);
  }
});

// ====================================================================
// ADMIN VEHICLE ROUTES (/api/admin/vehicles)
// ====================================================================
adminVehicleRoutes.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

// 1. GET /api/admin/vehicles - List all vehicles with filters & pagination
adminVehicleRoutes.get("/", async (req, res, next) => {
  try {
    const search = (req.query.search as string)?.trim() || "";
    const tab = (req.query.tab as string) || "All";
    const status = (req.query.status as string) || "All";
    const type = (req.query.type as string) || "All";
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (tab === "Gate Registered Vehicles") {
      where.status = "Approved";
    }

    if (status && status !== "All") {
      where.status = status;
    }

    if (type && type !== "All") {
      where.type = type;
    }

    if (search) {
      where.OR = [
        { plateNumber: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        {
          user: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { schoolId: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    const [rawVehicles, total, totalRegistered, totalCars, totalMotorcycles] = await Promise.all([
      db.vehicle.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              schoolId: true,
            },
          },
        },
      }),
      db.vehicle.count({ where }),
      db.vehicle.count(),
      db.vehicle.count({ where: { type: "Car" } }),
      db.vehicle.count({ where: { type: "Motorcycle" } }),
    ]);

    const vehicles = rawVehicles.map((v) => ({
      id: v.id,
      plateNo: v.plateNumber,
      plateNumber: v.plateNumber,
      owner: `${v.user.lastName}, ${v.user.firstName}`,
      ownerFullName: `${v.user.firstName} ${v.user.lastName}`,
      type: v.type,
      brand: v.brand,
      model: v.model,
      brandModel: `${v.brand} ${v.model}`,
      color: v.color,
      year: v.year,
      regDate: v.createdAt.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      status: v.status,
      qrCode: v.qrCode,
      registrationSource: v.registrationSource,
      approvedAt: v.approvedAt,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      user: v.user,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      vehicles,
      metrics: {
        totalRegistered,
        totalCars,
        totalMotorcycles,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
});
// 2. GET /api/admin/vehicles/registrations - List registrations with metrics
adminVehicleRoutes.get("/registrations", async (req, res, next) => {
  try {
    const search = (req.query.search as string)?.trim() || "";
    const filter = (req.query.filter as string) || "All";

    const where: any = {};

    if (filter && filter !== "All" && filter !== "All Vehicles") {
      where.status = filter;
    }

    if (search) {
      where.OR = [
        { plateNumber: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        {
          user: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { schoolId: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    const [rawRegistrations, totalRegistered, pendingApprovals, activePasses] = await Promise.all([
      db.vehicle.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              schoolId: true,
            },
          },
        },
      }),
      db.vehicle.count(),
      db.vehicle.count({ where: { status: "Pending" } }),
      db.vehicle.count({ where: { status: "Approved" } }),
    ]);

    const registrations = rawRegistrations.map((v) => ({
      id: v.id,
      owner: `${v.user.firstName} ${v.user.lastName}`,
      vehicleType: `${v.brand} ${v.model} (${v.type})`,
      type: v.type,
      brand: v.brand,
      model: v.model,
      color: v.color,
      year: v.year,
      plateNo: v.plateNumber,
      plateNumber: v.plateNumber,
      status: v.status,
      date: v.createdAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      createdAt: v.createdAt,
      email: v.user.email,
      phone: v.user.phone || "--",
      idNo: v.user.schoolId,
      rejectionReason: v.rejectionReason,
      qrCode: v.qrCode,
      registrationSource: v.registrationSource,
      user: v.user,
    }));

    return res.status(200).json({
      success: true,
      registrations,
      metrics: {
        totalRegistered,
        pendingApprovals,
        activePasses,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 3. GET /api/admin/vehicles/:id - Vehicle details with owner profile
adminVehicleRoutes.get("/:id", async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id, 10);
    if (isNaN(vehicleId)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID" });
    }

    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            schoolId: true,
            avatar: true,
          },
        },
      },
    });

    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found" });
    }

    const formattedVehicle = {
      id: vehicle.id,
      plateNo: vehicle.plateNumber,
      plateNumber: vehicle.plateNumber,
      brandModel: `${vehicle.brand} ${vehicle.model} (${vehicle.year}) • ${vehicle.color}`,
      vehicleType: `${vehicle.type}`,
      type: vehicle.type,
      brand: vehicle.brand,
      model: vehicle.model,
      color: vehicle.color,
      yearRegistered: vehicle.year,
      year: vehicle.year,
      status: vehicle.status,
      originalStatus: vehicle.status,
      registrationStatus: vehicle.status === "Approved" ? "Registered" : vehicle.status,
      registrationSource: vehicle.registrationSource,
      registrationDate: vehicle.createdAt.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      qrStatus: vehicle.status === "Approved" ? "Active" : "Inactive",
      qrCode: vehicle.qrCode,
      rejectionReason: vehicle.rejectionReason,
      owner: {
        fullName: `${vehicle.user.firstName} ${vehicle.user.lastName}`,
        studentId: vehicle.user.schoolId,
        email: vehicle.user.email,
        phoneNumber: vehicle.user.phone || "--",
      },
      user: vehicle.user,
    };

    return res.status(200).json({
      success: true,
      vehicle: formattedVehicle,
    });
  } catch (error) {
    next(error);
  }
});

// 4. POST /api/admin/vehicles/:id/approve - Approve vehicle
adminVehicleRoutes.post("/:id/approve", async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id, 10);
    if (isNaN(vehicleId)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID" });
    }

    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found" });
    }

    const qrToken = `SP-${vehicle.plateNumber.replace(/\s+/g, "")}-${Date.now()}`;

    const updatedVehicle = await db.vehicle.update({
      where: { id: vehicleId },
      data: {
        status: "Approved",
        approvedAt: new Date(),
        qrCode: qrToken,
        rejectionReason: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle approved successfully",
      vehicle: updatedVehicle,
    });
  } catch (error) {
    next(error);
  }
});

// 5. POST /api/admin/vehicles/:id/reject - Reject vehicle with reason
adminVehicleRoutes.post("/:id/reject", async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id, 10);
    if (isNaN(vehicleId)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID" });
    }

    const { rejectionReason } = req.body;
    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
      });
    }

    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found" });
    }

    const updatedVehicle = await db.vehicle.update({
      where: { id: vehicleId },
      data: {
        status: "Rejected",
        rejectionReason: rejectionReason.trim(),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle rejected successfully",
      vehicle: updatedVehicle,
    });
  } catch (error) {
    next(error);
  }
});

// 6. PATCH /api/admin/vehicles/:id/status - Update vehicle status (Active/Approved/Inactive)
adminVehicleRoutes.patch("/:id/status", async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id, 10);
    if (isNaN(vehicleId)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID" });
    }

    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }

    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found" });
    }

    // Map Active to Approved if approved or generating qrCode if needed
    let targetStatus = status;
    let qrCode = vehicle.qrCode;

    if (status === "Active" || status === "Approved") {
      targetStatus = "Approved";
      if (!qrCode) {
        qrCode = `SP-${vehicle.plateNumber.replace(/\s+/g, "")}-${Date.now()}`;
      }
    } else if (status === "Inactive") {
      targetStatus = "Inactive";
    }

    const updatedVehicle = await db.vehicle.update({
      where: { id: vehicleId },
      data: {
        status: targetStatus,
        ...(targetStatus === "Approved" ? { approvedAt: vehicle.approvedAt || new Date(), qrCode } : {}),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle status updated successfully",
      vehicle: updatedVehicle,
    });
  } catch (error) {
    next(error);
  }
});

