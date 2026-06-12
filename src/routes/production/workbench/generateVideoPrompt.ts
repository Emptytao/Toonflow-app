import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  buildVideoPromptAiTrace,
  buildVideoPromptContent,
  composeVideoPromptSystem,
  generateBgmSuggestion,
  loadVideoPromptContext,
  normalizeVideoPromptStyle,
  resolveVideoPromptStyle,
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
    promptStyle: z.enum(["general", "high_energy", "lyrical"]).optional(),
  }),
  async (req, res) => {
    const { trackId, projectId, info, model, mode, promptStyle } = req.body;
    const normalizedPromptStyle = normalizeVideoPromptStyle(promptStyle);

    await u.db("o_videoTrack").where({ id: trackId }).update({
      state: "生成中",
      promptStyle: normalizedPromptStyle,
    });

    try {
      const { assets, storyboard, assetsAudioRecord } = await loadVideoPromptContext(info);
      const { modelName, videoPromptGeneration } = await resolveVideoPromptTemplate(model, mode);
      const styleSkill = await resolveVideoPromptStyle(normalizedPromptStyle);
      const projectData = await u.db("o_project").select("*").where({ id: projectId }).first();
      const artStyle = projectData?.artStyle || "无";
      const visualManual = u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video");
      const content = buildVideoPromptContent(modelName, assets, storyboard, assetsAudioRecord);
      const system = composeVideoPromptSystem({
        template: videoPromptGeneration,
        visualManual,
        styleSkill,
      });

      const { text, reasoningText } = await u.Ai.Text("universalAi").invoke({
        system,
        messages: [{ role: "user", content }],
      });
      const bgmSuggestion = await generateBgmSuggestion(modelName, visualManual, content);
      const aiTrace = buildVideoPromptAiTrace({
        prompt: text,
        thinking: reasoningText,
        modelName,
        inputSummary: content,
        visualManual,
        promptStyle: normalizedPromptStyle,
        styleSkillName: styleSkill.skillName,
        systemLayers: ["template", "visualManual", "styleSkill"],
      });
      await u.db("o_videoTrack").where({ id: trackId }).update({
        state: "已完成",
        prompt: text,
        bgmSuggestion,
        aiTrace: stringifyVideoPromptAiTrace(aiTrace),
        promptStyle: normalizedPromptStyle,
      });
      res.status(200).send(
        success({
          prompt: text,
          bgmSuggestion,
          aiTrace,
          promptStyle: normalizedPromptStyle,
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
