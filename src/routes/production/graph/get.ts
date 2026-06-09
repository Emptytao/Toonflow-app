import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getEpisodeId, loadGraphDocument } from "@/lib/productionGraph";

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
      const { graphData, version, created } = await loadGraphDocument(projectId, episodeId);
      res.status(200).send(
        success({
          graphData,
          version,
          created,
        }),
      );
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
