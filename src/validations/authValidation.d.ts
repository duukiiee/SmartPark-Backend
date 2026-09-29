import { z } from "zod";
export declare const registerSchema: z.ZodObject<{
    firstName: z.ZodString;
    lastName: z.ZodString;
    email: z.ZodString;
    schoolId: z.ZodString;
    phone: z.ZodOptional<z.ZodString>;
    password: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<{
        ADMIN: "ADMIN";
        FACULTY: "FACULTY";
        STAFF: "STAFF";
        STUDENT: "STUDENT";
    }>>;
}, z.core.$strip>;
export declare const loginSchema: z.ZodObject<{
    identifier: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
//# sourceMappingURL=authValidation.d.ts.map