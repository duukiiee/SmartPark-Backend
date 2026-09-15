import { Router } from "express";

const router = Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (email === "test@smartpark.com" && password === "123456") {
    return res.status(200).json({
      success: true,
      message: "Login successful",
    });
  }

  return res.status(401).json({
    success: false,
    message: "Invalid email or password",
  });
});

export default router;
