import { Router } from "express";
import conversationsRouter from "./conversation"
import chatRouter from "./chat";
import councilRouter from "./council";  

const router = Router();

router.use("/conversations", conversationsRouter);
router.use("/chat", chatRouter);
router.use("/council", councilRouter); 

export default router;