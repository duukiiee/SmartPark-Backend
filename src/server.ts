import express from "express";
import cors from "cors";

const app = express();

const PORT = 5000;

app.use(cors());
app

app.get("/api/test", (req, res) => {
  res.json({
    message: "Hello from Smart Park Backend!",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
