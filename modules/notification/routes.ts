import { Router } from "express";
import { verifyToken } from "../../middleware/auth";
import NotificationController from "./controller";

const router = Router();

// Authenticated user routes
router.post("/token", verifyToken, NotificationController.registerToken);
router.delete("/token", verifyToken, NotificationController.removeToken);

// Admin broadcast (guarded inside controller by ADMIN_SECRET)
router.post("/broadcast", NotificationController.broadcast);

export default router;
