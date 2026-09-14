import express from "express";
import cors from "cors";
import { corsconf } from "./config/cors.js";

const app = express();
app.use(corsconf);

function startServer() {
  const port: number = 5000;

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

startServer();
