import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  buildVideoPromptContent,
  loadVideoPromptContext,
  resolveVideoPromptTemplate,
} from "./videoPromptUtils";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    trackId: z.number(),
    projectId: z.number(),
    info: z.array(
      z.object({
        id: z.number(),
        sources: z.string(),
      }),
    ),
    model: z.string(),
    mode: z.string(),
  }),
  async (req, res) => {
    const { trackId, projectId, info, model, mode } = req.body;
    const { assets, storyboard, assetsAudioRecord } = await loadVideoPromptContext(info);
    const { modelName: modelData, videoPromptGeneration } = await resolveVideoPromptTemplate(model, mode);
    const projectData = await u.db("o_project").select("*").where({ id: projectId }).first();
    const artStyle = projectData?.artStyle || "无";
    const visualManual = u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video");
    const content = buildVideoPromptContent(modelData, assets, storyboard, assetsAudioRecord);

    try {
      const { text } = await u.Ai.Text("universalAi").invoke({
        system: videoPromptGeneration,
        messages: [
          {
            role: "assistant",
            content: `${visualManual}`,
          },
          {
            role: "user",
            content: content,
          },
        ],
      });
      await u.db("o_videoTrack").where({ id: trackId }).update({
        prompt: text,
      });
      res.status(200).send(success(text));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
