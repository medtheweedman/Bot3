import { Router, type IRouter } from "express";
import healthRouter from "./health";
import creatorReplyRouter from "./creator-reply";
import authRouter from "./auth";
import whatsAppRouter from "./whatsapp";
import { requireAccess } from "../middlewares/access";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireAccess);
router.use(creatorReplyRouter);
router.use(whatsAppRouter);

export default router;
