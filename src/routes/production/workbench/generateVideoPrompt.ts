import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  buildVideoPromptAiTrace,
  buildVideoPromptContent,
  generateBgmSuggestion,
  loadVideoPromptContext,
  resolveVideoPromptTemplate,
  stringifyVideoPromptAiTrace,
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

    await u.db("o_videoTrack").where({ id: trackId }).update({
      state: "生成中",
    });

    try {
      const { assets, storyboard, assetsAudioRecord } = await loadVideoPromptContext(info);
      const { modelName, videoPromptGeneration } = await resolveVideoPromptTemplate(model, mode);
      const projectData = await u.db("o_project").select("*").where({ id: projectId }).first();
      const artStyle = projectData?.artStyle || "无";
      const visualManual = u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video");
      const content = buildVideoPromptContent(modelName, assets, storyboard, assetsAudioRecord);

      const { text, reasoningText } = await u.Ai.Text("universalAi").invoke({
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
      const bgmSuggestion = await generateBgmSuggestion(modelName, visualManual, content);
      const aiTrace = buildVideoPromptAiTrace({
        prompt: text,
        thinking: reasoningText,
        modelName,
        inputSummary: content,
        visualManual,
      });
      await u.db("o_videoTrack").where({ id: trackId }).update({
        state: "已完成",
        prompt: text,
        bgmSuggestion,
        aiTrace: stringifyVideoPromptAiTrace(aiTrace),
      });
      res.status(200).send(
        success({
          prompt: text,
          bgmSuggestion,
          aiTrace,
        }),
      );
    } catch (e) {
      await u
        .db("o_videoTrack")
        .where({ id: trackId })
        .update({
          state: "生成失败",
          reason: u.error(e).message,
        });
      res.status(400).send(error(u.error(e).message));
    }
  },
);
