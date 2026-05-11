import { Router } from "express";
import { verifyToken } from "../../middleware/auth";
import NotificationController from "./controller";

const router = Router();

router.post("/token", verifyToken, NotificationController.registerToken);
router.delete("/token", verifyToken, NotificationController.removeToken);

export default router;
