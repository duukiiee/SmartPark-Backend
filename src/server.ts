import express from "express";
import helmet from "helmet";
import { corsconf } from "./config/cors.js";
import authRoutes from "./routes/authRoutes.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { db } from "./prisma/db.js";

const app = express();

// Trust proxy for accurate client IP behind reverse proxies (Nginx, Render, Cloudflare)
app.set("trust proxy", 1);

// Disable X-Powered-By header to prevent information disclosure
app.disable("x-powered-by");

// Security HTTP headers
app.use(helmet());

// CORS configuration
app.use(corsconf);

// Body parser with payload size limit to prevent DoS attacks
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Health check routes
app.get(["/health", "/api/health"], (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes
app.use("/api", authRoutes);

// Fallback JSON 404 handler for unknown endpoints
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.originalUrl} not found`,
  });
});

// Safe global error handler (never leaks credentials or stack traces)
app.use(errorHandler);

function startServer() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });

  // Graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    server.close(async () => {
      console.log("HTTP server closed.");
      
      try {
        await db.$disconnect();
        console.log("Database connection closed.");
      } catch (err) {
        console.error("Error closing database connection:", err);
      }
      
      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
      console.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer();
