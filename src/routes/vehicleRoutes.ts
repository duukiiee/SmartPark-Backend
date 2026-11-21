import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export const studentVehicleRoutes = Router();
export const adminVehicleRoutes = Router();

// ====================================================================
// STUDENT VEHICLE ROUTES (/api/vehicles)
// ====================================================================
studentVehicleRoutes.use(requireAuth);

export const DEFAULT_VEHICLE_OPTIONS = {
  cars: [
    { brand: "Toyota", models: ["Vios", "Fortuner", "Innova", "Wigo", "Rush", "Corolla Altis", "Hilux", "Raize", "Avanza", "Yaris Cross"] },
    { brand: "Honda", models: ["City", "Civic", "CR-V", "BR-V", "Brio", "HR-V"] },
    { brand: "Mitsubishi", models: ["Mirage G4", "Mirage Hatchback", "Xpander", "Montero Sport", "Strada", "Outlander"] },
    { brand: "Nissan", models: ["Navara", "Almera", "Terra", "Urvan", "Kicks e-Power", "Patrol"] },
    { brand: "Suzuki", models: ["Swift", "Dzire", "Ertiga", "Jimny", "S-Presso", "Celerio", "XL7"] },
    { brand: "Hyundai", models: ["Accent", "Tucson", "Stargazer", "Creta", "Custin", "Santa Fe"] },
    { brand: "Ford", models: ["Ranger", "Everest", "Territory", "Explorer"] },
    { brand: "Geely", models: ["Coolray", "Emgrand", "Okavango", "Azkarra"] },
    { brand: "MG", models: ["MG 5", "ZS", "GT", "One"] },
    { brand: "BYD", models: ["Atto 3", "Dolphin", "Seal", "Sealion 6"] },
    { brand: "Kia", models: ["Soluto", "Seltos", "Carnival", "Sonet", "K2500"] },
    { brand: "Isuzu", models: ["D-Max", "mu-X", "Traviz"] },
    { brand: "Mazda", models: ["Mazda 2", "Mazda 3", "CX-30", "CX-5", "BT-50"] }
  ],
  motorcycles: [
    { brand: "Honda", models: ["Click 125", "Click 160", "Beat", "ADV 160", "PCX 160", "Wave 110", "Winner X", "Airblade 160", "CBR150R", "TMX 125"] },
    { brand: "Yamaha", models: ["Mio Sporty", "Mio i125 (M3)", "NMAX 155", "Aerox 155", "Sniper 155", "Mio Gravis", "Mio Fazzio", "XSR 155", "YZF-R15", "Sight 115"] },
    { brand: "Suzuki", models: ["Raider 150 Fi", "Raider 150 Carb", "Burgman Street 125", "Smash 115", "Avenis 125", "Gixxer 150"] },
    { brand: "Kawasaki", models: ["Barako II", "Ninja 400", "Rouser NS200", "Dominar 400", "Fury 125", "W175"] },
    { brand: "Vespa", models: ["Primavera 150", "Sprint 150", "GTS 300", "S 125"] },
    { brand: "Kymco", models: ["Like 125", "Like 150i", "Super Z 150", "KRV 180"] }
  ],
  colors: [
    "White", "Black", "Silver", "Gray", "Red", "Blue", "Brown", "Yellow", "Orange", "Green", "Pearl White", "Metallic Gray", "Midnight Blue"
  ],
  years: Array.from({ length: 27 }, (_, i) => (2026 - i).toString())
};

export async function getOrCreateVehicleOptions() {
  let setting = await db.vehicleSetting.findUnique({
    where: { key: "options" },
  });
  if (!setting) {
    setting = await db.vehicleSetting.create({
      data: {
        key: "options",
        data: DEFAULT_VEHICLE_OPTIONS,
      },
    });
  }
  return setting.data;
}

// 0. GET /api/vehicles/options - Dynamic vehicle brands, models, colors, years
studentVehicleRoutes.get("/options", async (req, res, next) => {
  try {
    const options = await getOrCreateVehicleOptions();
    return res.status(200).json({
      success: true,
      options,
    });
  } catch (error) {
    next(error);
  }
});

// 1. GET /api/vehicles/my-vehicles - List logged in user's vehicles
studentVehicleRoutes.get("/my-vehicles", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const vehicles = await db.vehicle.findMany({
      where: {
        userId,
        status: { not: "Deleted" },
      },
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

// 2. POST /api/vehicles - Register a vehicle requiring admin approval
studentVehicleRoutes.post("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { type, plateNumber, brand, model, color, year, photo } = req.body;

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
      // If currently Approved or Pending, do not allow duplicate active registration
      if (existingVehicle.status === "Approved" || existingVehicle.status === "Pending") {
        return res.status(400).json({
          success: false,
          message: "Plate number is already actively registered or pending approval.",
        });
      }

      // If the vehicle was previously Inactive, Rejected, or Deleted, archive the old plate to free it up
      await db.vehicle.update({
        where: { id: existingVehicle.id },
        data: {
          plateNumber: `${existingVehicle.plateNumber}-ARCHIVED-${existingVehicle.id}-${Date.now()}`,
          status: "Deleted",
        },
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
        photo: photo || null,
        status: "Pending",
        qrCode: null,
        registrationSource: "Online",
      },
    });

    // Notification for system
    const user = await db.user.findUnique({ where: { id: userId } });
    const ownerName = user ? `${user.firstName} ${user.lastName}` : "Student";
    await db.notification.create({
      data: {
        title: "New Vehicle Registration",
        description: `${newVehicle.brand} ${newVehicle.model} (${newVehicle.plateNumber}) registered by ${ownerName}. Pending admin approval.`,
        type: "update",
        link: `/admin/vehicles`,
        read: false,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Vehicle registered successfully and is pending administrator approval.",
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

    const { type, plateNumber, brand, model, color, year, photo } = req.body;
    const updateData: any = {};

    if (type) updateData.type = type.trim();
    if (brand) updateData.brand = brand.trim();
    if (model) updateData.model = model.trim();
    if (color) updateData.color = color.trim();
    if (year) updateData.year = year.toString().trim();
    if (photo !== undefined) updateData.photo = photo;

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
// 4.5. DELETE /api/vehicles/:id - Delete/remove vehicle (frees up plate number)
studentVehicleRoutes.delete("/:id", async (req, res, next) => {
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

    // Check if vehicle has historical parking logs
    const parkingLogsCount = await db.parkingLog.count({
      where: { vehicleId },
    });

    if (parkingLogsCount > 0) {
      // Archive to preserve historical parking logs for admin audit without blocking plate reuse
      await db.vehicle.update({
        where: { id: vehicleId },
        data: {
          plateNumber: `${vehicle.plateNumber}-DELETED-${vehicle.id}-${Date.now()}`,
          status: "Deleted",
        },
      });
    } else {
      // No parking history, safe to hard delete completely
      await db.vehicle.delete({
        where: { id: vehicleId },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vehicle removed successfully",
    });
  } catch (error) {
    next(error);
  }
});

// 5. GET /api/vehicles/:id/qr - Get vehicle QR code pass (Requires Approved status)
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

    if (vehicle.status !== "Approved" || !vehicle.qrCode) {
      return res.status(403).json({
        success: false,
        message: "Vehicle is not approved yet. QR code is only available for approved vehicles.",
        status: vehicle.status,
      });
    }

    return res.status(200).json({
      success: true,
      qrCode: vehicle.qrCode,
      plateNumber: vehicle.plateNumber,
      status: vehicle.status,
    });
  } catch (error) {
    next(error);
  }
});

// 6. POST /api/vehicles/:id/generate-qr - Get vehicle QR code pass (Requires Approved status)
studentVehicleRoutes.post("/:id/generate-qr", async (req, res, next) => {
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

    if (vehicle.status !== "Approved" || !vehicle.qrCode) {
      return res.status(403).json({
        success: false,
        message: "Cannot generate QR code for unapproved vehicle. Please wait for admin approval.",
        status: vehicle.status,
      });
    }

    return res.status(200).json({
      success: true,
      message: "QR pass retrieved successfully",
      qrCode: vehicle.qrCode,
      vehicle,
    });
  } catch (error) {
    next(error);
  }
});

// ====================================================================
// ADMIN VEHICLE ROUTES (/api/admin/vehicles)
// ====================================================================
adminVehicleRoutes.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

// 0. Options Management (GET, PUT, RESET)
adminVehicleRoutes.get("/options", async (req, res, next) => {
  try {
    const options = await getOrCreateVehicleOptions();
    return res.status(200).json({ success: true, options });
  } catch (error) {
    next(error);
  }
});

adminVehicleRoutes.put("/options", async (req, res, next) => {
  try {
    const { options } = req.body;
    if (!options) {
      return res.status(400).json({ success: false, message: "Options data is required" });
    }
    const setting = await db.vehicleSetting.upsert({
      where: { key: "options" },
      update: { data: options },
      create: { key: "options", data: options },
    });
    return res.status(200).json({ success: true, message: "Vehicle options updated successfully", options: setting.data });
  } catch (error) {
    next(error);
  }
});

adminVehicleRoutes.post("/options/reset", async (req, res, next) => {
  try {
    const setting = await db.vehicleSetting.upsert({
      where: { key: "options" },
      update: { data: DEFAULT_VEHICLE_OPTIONS },
      create: { key: "options", data: DEFAULT_VEHICLE_OPTIONS },
    });
    return res.status(200).json({ success: true, message: "Vehicle options reset to standard list", options: setting.data });
  } catch (error) {
    next(error);
  }
});

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
      photo: v.photo,
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
      photo: v.photo,
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
      photo: vehicle.photo,
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

// 7. GET /api/admin/vehicles/:id/history - Get vehicle parking history with search, filters & pagination
adminVehicleRoutes.get("/:id/history", async (req, res, next) => {
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

    // If vehicle status is Pending, return empty history (read-only; no logs are modified)
    if (vehicle.status === "Pending") {
      return res.status(200).json({
        success: true,
        isPending: true,
        history: [],
        availableDates: ["All Dates"],
        pagination: { total: 0, page: 1, limit: 5, totalPages: 1 },
      });
    }

    const search = (req.query.search as string)?.trim() || "";
    const dateFilter = (req.query.date as string)?.trim() || "All Dates";
    const timeFilter = (req.query.timeFilter as string)?.trim() || "All";
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 5;
    const skip = (page - 1) * limit;

    const allLogs = await db.parkingLog.findMany({
      where: { vehicleId },
      orderBy: { entryTime: "desc" },
    });

    const formattedAllLogs = allLogs.map((log) => {
      const entryDateObj = new Date(log.entryTime);
      const dateStr = entryDateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      });

      const entryTimeStr = entryDateObj.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      let exitTimeStr = "--";
      let durationStr = log.duration || "--";
      let logStatus = log.status;

      if (log.exitTime) {
        const exitDateObj = new Date(log.exitTime);
        exitTimeStr = exitDateObj.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        if (!log.duration) {
          const diffMs = exitDateObj.getTime() - entryDateObj.getTime();
          const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
          const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          durationStr = `${diffHrs}h ${diffMins}m`;
        }
        logStatus = "Complete";
      } else {
        logStatus = "Currently Parked";
      }

      const hours24 = entryDateObj.getHours();
      const timeOfDay = hours24 < 12 ? "Morning (AM)" : "Afternoon / Evening (PM)";

      return {
        id: log.id,
        date: dateStr,
        entryTime: entryTimeStr,
        exitTime: exitTimeStr,
        duration: durationStr,
        status: logStatus,
        registeredBy: log.guardName,
        timeOfDay,
      };
    });

    const uniqueDatesSet = new Set<string>();
    formattedAllLogs.forEach((l) => uniqueDatesSet.add(l.date));
    const availableDates = ["All Dates", ...Array.from(uniqueDatesSet)];

    const filtered = formattedAllLogs.filter((log) => {
      if (search) {
        const query = search.toLowerCase();
        const matchSearch =
          log.date.toLowerCase().includes(query) ||
          log.registeredBy.toLowerCase().includes(query) ||
          log.status.toLowerCase().includes(query) ||
          log.entryTime.toLowerCase().includes(query) ||
          log.exitTime.toLowerCase().includes(query);
        if (!matchSearch) return false;
      }

      if (dateFilter && dateFilter !== "All Dates") {
        if (log.date !== dateFilter) return false;
      }

      if (timeFilter && timeFilter !== "All") {
        if (log.timeOfDay !== timeFilter) return false;
      }

      return true;
    });

    const totalCount = filtered.length;
    const paginatedLogs = filtered.slice(skip, skip + limit).map(({ timeOfDay, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      isPending: false,
      history: paginatedLogs,
      availableDates,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
});


