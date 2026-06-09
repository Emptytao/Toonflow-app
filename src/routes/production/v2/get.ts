import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getEpisodeId, loadCanvasV2Document } from "@/lib/productionCanvasV2";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodeId: z.number().optional(),
    episodesId: z.number().optional(),
  }),
  async (req, res) => {
    try {
      const projectId = Number(req.body.projectId);
      const episodeId = getEpisodeId(req.body);
      const result = await loadCanvasV2Document(projectId, episodeId);
      res.status(200).send(success(result));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
