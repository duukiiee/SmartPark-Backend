import type { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Safe logging: log error message without printing secrets or request payload
  console.error("Unhandled error:", err?.message || err);

  const statusCode = err?.statusCode || 500;
  const message =
    statusCode === 500
      ? "An unexpected internal server error occurred"
      : err?.message || "Error processing request";

  res.status(statusCode).json({
    success: false,
    message,
  });
}
