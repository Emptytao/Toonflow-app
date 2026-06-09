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
    projectId: z.number(),
    trackData: z.array(
      z.object({
        trackId: z.number(),
        info: z.array(
          z.object({
            id: z.number(),
            sources: z.string(),
          }),
        ),
      }),
    ),
    model: z.string(),
    mode: z.string().optional(),
  }),
  async (req, res) => {
    const { projectId, trackData, model, mode } = req.body as {
      projectId: number;
      trackData: { trackId: number; info: { id: number; sources: string }[] }[];
      model: string;
      mode?: string;
    };

    try {
      const projectData = await u.db("o_project").select("*").where({ id: projectId }).first();
      const artStyle = projectData?.artStyle || "无";
      const visualManual = u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video");
      const { modelName, videoPromptGeneration } = await resolveVideoPromptTemplate(model, mode ?? projectData?.mode ?? undefined);

      const results: { trackId: number; prompt: string }[] = [];
      for (const track of trackData) {
        const { assets, storyboard, assetsAudioRecord } = await loadVideoPromptContext(track.info);
        const content = buildVideoPromptContent(modelName, assets, storyboard, assetsAudioRecord);
        const { text } = await u.Ai.Text("universalAi").invoke({
          system: videoPromptGeneration,
          messages: [
            {
              role: "assistant",
              content: `${visualManual}`,
            },
            {
              role: "user",
              content,
            },
          ],
        });
        await u.db("o_videoTrack").where({ id: track.trackId }).update({
          prompt: text,
        });
        results.push({
          trackId: track.trackId,
          prompt: text,
        });
      }

      res.status(200).send(success(results));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
