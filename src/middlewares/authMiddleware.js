import jwt from "jsonwebtoken";
export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authorization token required",
        });
    }
    const parts = authHeader.split(" ");
    const token = parts[1];
    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Malformed authorization header",
        });
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        console.error("JWT_SECRET is not configured in environment variables");
        return res.status(500).json({
            success: false,
            message: "Server configuration error",
        });
    }
    try {
        const decoded = jwt.verify(token, jwtSecret);
        req.user = decoded;
        next();
    }
    catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }
}
// Role-based authorization middleware
export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Insufficient permissions.",
            });
        }
        next();
    };
}
//# sourceMappingURL=authMiddleware.js.map