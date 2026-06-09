import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  findNode,
  getEpisodeId,
  getReachableNodeIds,
  getTopologicalOrder,
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
      const reachableNodeIds = getReachableNodeIds(graphData, req.body.nodeId);
      const order = getTopologicalOrder(graphData, reachableNodeIds);
      const executed: Array<Record<string, any>> = [];

      for (const nodeId of order) {
        const node = findNode(graphData, nodeId);
        if (!node) continue;

        if (node.type === "prompt") {
          await runPromptNode(node);
          executed.push({ nodeId, type: node.type, status: node.data?.runtime?.status ?? "success" });
          continue;
        }

        if (node.type !== "media") continue;
        if (node.data?.mode === "video") {
          const result = await runMediaNodeVideo(projectId, episodeId, graphData, node);
          executed.push({
            nodeId,
            type: node.type,
            status: result.node.data?.runtime?.status ?? "queued",
            jobId: result.videoId,
          });
          continue;
        }

        const result = await runMediaNodeImage(projectId, episodeId, graphData, node);
        executed.push({
          nodeId,
          type: node.type,
          status: result.node.data?.runtime?.status ?? "success",
          resultUrl: result.resultItem?.url ?? "",
        });
      }

      res.status(200).send(success({ graphData, executed }));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
