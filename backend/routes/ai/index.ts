import { Router } from "express";
import conversationsRouter from "./conversation"
import chatRouter from "./chat";

const router = Router();

router.use("/conversations", conversationsRouter);
router.use("/chat", chatRouter);

export default router;
