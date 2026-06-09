import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getEpisodeId, saveGraphDocument } from "@/lib/productionGraph";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodeId: z.number().optional(),
    episodesId: z.number().optional(),
    graphData: z.any(),
  }),
  async (req, res) => {
    try {
      const projectId = Number(req.body.projectId);
      const episodeId = getEpisodeId(req.body);
      const result = await saveGraphDocument(projectId, episodeId, req.body.graphData);
      res.status(200).send(success(result));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
