import { z } from "zod";

export const scanCodeSchema = z.object({
  code: z.string().trim().min(1, "Plate number or QR code is required"),
});

export const recordEntrySchema = z.object({
  vehicleId: z
    .union([z.number(), z.string()])
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val > 0, {
      message: "A valid positive vehicle ID is required.",
    }),
});

export const recordExitSchema = z.object({
  vehicleId: z
    .union([z.number(), z.string()])
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val > 0, {
      message: "A valid positive vehicle ID is required.",
    }),
});

export const registerGateVehicleSchema = z.object({
  ownerName: z.string().trim().min(1, "Owner name is required"),
  vehicleType: z.enum(["Car", "Motorcycle"], {
    message: "Vehicle type must be either 'Car' or 'Motorcycle'",
  }),
  plateNumber: z
    .string()
    .trim()
    .min(2, "Plate number must be at least 2 characters")
    .max(15, "Plate number too long"),
  brand: z
    .string()
    .trim()
    .min(1, "Brand is required")
    .max(50, "Brand too long"),
  model: z
    .string()
    .trim()
    .min(1, "Model is required")
    .max(50, "Model too long"),
  color: z
    .string()
    .trim()
    .min(1, "Color is required")
    .max(30, "Color too long"),
  idType: z.string().trim().optional(),
  idNumber: z.string().trim().optional(),
});

export const monitoringQuerySchema = z.object({
  tab: z
    .enum(["entries", "exits", "inside", "history"])
    .optional()
    .default("entries"),
  search: z.string().trim().optional(),
  vehicleType: z.string().trim().optional(),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(10),
  cursor: z.coerce.number().int().positive().optional(),
});

export const guardVehiclesQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["Active", "Deactivated"]).optional().default("Active"),
  vehicleType: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(10),
  cursor: z.coerce.number().int().positive().optional(),
});

export const vehicleParamSchema = z.object({
  id: z.coerce.number().int().positive("Invalid vehicle ID parameter"),
});
