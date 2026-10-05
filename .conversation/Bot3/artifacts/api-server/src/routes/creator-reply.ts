import { Router, type IRouter } from "express";
import {
  DraftCreatorReplyBody,
  DraftCreatorReplyResponse,
} from "@workspace/api-zod";
import {
  CreatorReplyServiceError,
  generateCreatorReply,
} from "../lib/creator-reply-service";

const router: IRouter = Router();

router.post("/creator/reply", async (req, res): Promise<void> => {
  const parsed = DraftCreatorReplyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the question and persona details." });
    return;
  }

  try {
    const reply = await generateCreatorReply(parsed.data, req.log);
    res.json(DraftCreatorReplyResponse.parse({ reply }));
  } catch (error) {
    if (error instanceof CreatorReplyServiceError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unexpected reply generation error");
    res.status(502).json({ error: "Gemini is unavailable right now. Try again shortly." });
  }
});

export default router;