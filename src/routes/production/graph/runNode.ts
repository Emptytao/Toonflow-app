import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  findNode,
  getEpisodeId,
  normalizeGraphDocument,
  runMediaNodeImage,
  runMediaNodeVideo,
  runPromptNode,
} from "@/lib/productionGraph";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodeId: z.number().optional(),
    episodesId: z.number().optional(),
    nodeId: z.string(),
    graphData: z.any(),
  }),
  async (req, res) => {
    try {
      const projectId = Number(req.body.projectId);
      const episodeId = getEpisodeId(req.body);
      const graphData = normalizeGraphDocument(req.body.graphData, projectId, episodeId);
      const node = findNode(graphData, req.body.nodeId);
      if (!node) {
        return res.status(404).send(error("节点不存在"));
      }

      let payload: Record<string, any> = { node, graphData };
      if (node.type === "prompt") {
        payload = { ...(await runPromptNode(node)), graphData };
      } else if (node.type === "media") {
        payload =
          node.data?.mode === "video"
            ? { ...(await runMediaNodeVideo(projectId, episodeId, graphData, node)), graphData }
            : { ...(await runMediaNodeImage(projectId, episodeId, graphData, node)), graphData };
      } else {
        return res.status(400).send(error("当前节点类型不支持独立运行"));
      }

      res.status(200).send(success(payload));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
