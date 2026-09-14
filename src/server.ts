import express from "express";

const app = express();

const PORT = 5000;

app.get("/api/test", (req, res) => {
  res.json({
    message: "Hello from Smart Park Backend!",
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
