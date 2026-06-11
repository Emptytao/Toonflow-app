import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    prompt: z.string().optional(),
    bgmSuggestion: z.string().optional(),
  }),
  async (req, res) => {
    const { id, prompt, bgmSuggestion } = req.body;
    const updateData: { prompt?: string; bgmSuggestion?: string } = {};
    if (prompt !== undefined) updateData.prompt = prompt;
    if (bgmSuggestion !== undefined) updateData.bgmSuggestion = bgmSuggestion;
    if (Object.keys(updateData).length) {
      await u.db("o_videoTrack").where("id", id).update(updateData);
    }
    res.status(200).send(success("更新成功"));
  },
);
