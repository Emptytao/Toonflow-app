import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { queryVideoWorkflowJob } from "@/lib/productionCanvasV2";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    jobs: z
      .array(
        z.object({
          nodeId: z.string(),
          jobId: z.union([z.string(), z.number()]),
          jobType: z.enum(["video", "prompt"]),
        }),
      )
      .optional(),
    nodeId: z.string().optional(),
    jobId: z.union([z.string(), z.number()]).optional(),
    jobType: z.enum(["video", "prompt"]).optional(),
  }),
  async (req, res) => {
    try {
      const jobs = Array.isArray(req.body.jobs)
        ? req.body.jobs
        : req.body.jobId
          ? [{ nodeId: req.body.nodeId ?? "", jobId: req.body.jobId, jobType: req.body.jobType ?? "video" }]
          : [];
      const result = await Promise.all(
        jobs.map(async (job: { nodeId: string; jobId: string | number; jobType: "video" | "prompt" }) => {
          if (job.jobType !== "video") {
            return {
              nodeId: job.nodeId,
              jobId: job.jobId,
              jobType: job.jobType,
              status: "success",
            };
          }
          const payload = await queryVideoWorkflowJob(Number(job.jobId));
          return {
            nodeId: job.nodeId,
            jobType: "video",
            ...payload,
          };
        }),
      );
      res.status(200).send(success({ jobs: result }));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
