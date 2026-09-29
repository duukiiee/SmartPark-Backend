import express from "express";
import helmet from "helmet";
import { corsconf } from "./config/cors.js";
import authRoutes from "./routes/authRoutes.js";
import { errorHandler } from "./middlewares/errorHandler.js";

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration
app.use(corsconf);

// Body parser
app.use(express.json());

// API Routes
app.use("/api", authRoutes);

// Safe global error handler (never leaks credentials or stack traces)
app.use(errorHandler);

function startServer() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

startServer();
