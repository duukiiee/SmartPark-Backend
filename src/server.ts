import express from "express";
import cors from "cors";
import { corsconf } from "./config/cors.js";
import authRoutes from "./routes/authRoutes.js";

const app = express();
app.use(corsconf);
app.use(express.json());
app.use("/api", authRoutes);

function startServer() {
  const port: number = 5000;

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

startServer();
