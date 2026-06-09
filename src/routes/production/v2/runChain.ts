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
      const action = (req.body.action || "generateVideo") as CanvasV2WorkflowAction;
      const graphData = normalizeCanvasV2Document(req.body.graphData, projectId, episodeId);
      const targetNode = findNode(graphData, req.body.nodeId);
      if (!targetNode) {
        return res.status(404).send(error("目标节点不存在"));
      }
      const executed: Array<Record<string, any>> = [];
      const upstreamPromptNodes = getUpstreamNodes(graphData, targetNode.id, "prompt").filter((node) => node.type === "prompt");
      for (const node of upstreamPromptNodes) {
        await runPromptNode(node as any);
        executed.push({
          nodeId: node.id,
          type: node.type,
          status: (node as any).data?.runtime?.status ?? "success",
        });
      }
      if (targetNode.type === "video") {
        const result = await runVideoWorkflowNode(projectId, episodeId, graphData, targetNode as any, action);
        executed.push({
          nodeId: targetNode.id,
          type: targetNode.type,
          status: result.node.data.runtime.status,
          jobId: result.jobId ?? null,
          resultType: result.resultType,
        });
      } else if (targetNode.type === "prompt") {
        await runPromptNode(targetNode as any);
        executed.push({
          nodeId: targetNode.id,
          type: targetNode.type,
          status: targetNode.data.runtime.status,
        });
      } else {
        return res.status(400).send(error("当前节点类型不支持运行链路"));
      }
      res.status(200).send(success({ graphData, executed }));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
