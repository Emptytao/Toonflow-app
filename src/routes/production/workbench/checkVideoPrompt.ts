import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeVideoPromptStyle, parseVideoPromptAiTrace } from "./videoPromptUtils";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    trackIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, scriptId, trackIds } = req.body;
    const promptList = await u
      .db("o_videoTrack")
      .where("projectId", projectId)
      .where("scriptId", scriptId)
      .whereIn("id", trackIds)
      .whereIn("state", ["已完成", "生成失败"])
      .select("id", "state", "reason", "prompt", "bgmSuggestion", "aiTrace", "promptStyle");
    const data = promptList.map((item) => ({
      ...item,
      aiTrace: parseVideoPromptAiTrace(item.aiTrace),
      promptStyle: normalizeVideoPromptStyle(item.promptStyle),
    }));
    res.status(200).send(success(data));
  },
);
