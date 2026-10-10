import { z } from "zod";

// Student/Employee ID validation pattern: XX-XXXX or AA-XXXXXXX
const schoolIdSchema = z
  .string()
  .trim()
  .min(1, "Student/Employee ID is required")
  .regex(/^(\d{2}-\d{4}|[A-Za-z]{2}-\d{7})$/, {
    message: "ID must be in format XX-XXXX (e.g., 24-1474) or AA-XXXXXXX (e.g., AB-1234567)",
  });

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Invalid email address"),
  schoolId: schoolIdSchema,
  phone: z.string().trim().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  // Remove role from public registration - backend will assign "USER"
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Email or School ID is required"),
  password: z.string().min(1, "Password is required"),
});

// Admin-only registration schema (for privileged account provisioning)
export const adminRegisterSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Invalid email address"),
  schoolId: schoolIdSchema,
  phone: z.string().trim().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["GUARD", "ADMIN"]),
});
