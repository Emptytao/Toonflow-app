import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  findNode,
  getEpisodeId,
  getUpstreamNodes,
  normalizeCanvasV2Document,
  runPromptNode,
  runVideoWorkflowNode,
  type CanvasV2WorkflowAction,
} from "@/lib/productionCanvasV2";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodeId: z.number().optional(),
    episodesId: z.number().optional(),
    nodeId: z.string(),
    graphData: z.any(),
    action: z.enum(["generatePrompt", "generateVideo"]).optional(),
  }),
  async (req, res) => {
    try {
      const projectId = Number(req.body.projectId);
      const episodeId = getEpisodeId(req.body);
      const graphData = normalizeCanvasV2Document(req.body.graphData, projectId, episodeId);
      const node = findNode(graphData, req.body.nodeId);
      const action = (req.body.action || "generateVideo") as CanvasV2WorkflowAction;
      if (!node) {
        return res.status(404).send(error("节点不存在"));
      }
      if (node.type === "prompt") {
        await runPromptNode(node as any);
        return res.status(200).send(success({ graphData, node }));
      }
      if (node.type === "video") {
        const upstreamPromptNodes = getUpstreamNodes(graphData, node.id, "prompt").filter((item) => item.type === "prompt");
        for (const promptNode of upstreamPromptNodes) {
          await runPromptNode(promptNode as any);
        }
        const result = await runVideoWorkflowNode(projectId, episodeId, graphData, node as any, action);
        return res.status(200).send(success({ graphData, node: result.node, jobId: result.jobId ?? null, resultType: result.resultType }));
      }
      return res.status(400).send(error("当前节点类型不支持运行"));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
