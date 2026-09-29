import { z } from "zod";

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Invalid email address"),
  schoolId: z.string().trim().min(3, "Student/Employee ID must be at least 3 characters"),
  phone: z.string().trim().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["USER", "GUARD", "ADMIN"]).default("USER"),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Email or School ID is required"),
  password: z.string().min(1, "Password is required"),
});
