import express from "express";
import u from "@/utils";
import pLimit from "p-limit";
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
    concurrentCount: z.number().optional(), //并发数
  }),
  async (req, res) => {
    const { trackData, projectId, mode, model, concurrentCount = 5 } = req.body as {
      projectId: number;
      trackData: { trackId: number; info: { id: number; sources: string }[] }[];
      model: string;
      mode?: string;
      concurrentCount?: number;
    };

    try {
      const projectData = await u.db("o_project").select("*").where({ id: projectId }).first();
      const artStyle = projectData?.artStyle || "无";
      const visualManual = u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video");
      const { modelName, videoPromptGeneration } = await resolveVideoPromptTemplate(model, mode ?? projectData?.mode ?? undefined);

      await u
        .db("o_videoTrack")
        .whereIn(
          "id",
          trackData.map((t: { trackId: number }) => t.trackId),
        )
        .update({ state: "生成中" });

      const limit = pLimit(concurrentCount ?? 5);
      const tasks = trackData.map((track) =>
        limit(async () => {
          try {
            const { assets, storyboard, assetsAudioRecord } = await loadVideoPromptContext(track.info);
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

            await u.db("o_videoTrack").where({ id: track.trackId }).update({
              prompt: text,
              bgmSuggestion,
              aiTrace: stringifyVideoPromptAiTrace(aiTrace),
              state: "已完成",
            });

            return { trackId: track.trackId, text, bgmSuggestion, aiTrace };
          } catch (e) {
            const reason = u.error(e).message;
            await u.db("o_videoTrack").where({ id: track.trackId }).update({ state: "生成失败", reason });
            return { trackId: track.trackId, error: reason };
          }
        }),
      );

      void Promise.allSettled(tasks);
      res.status(200).send(success("开始生成提示词"));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
