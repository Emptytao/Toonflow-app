import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { queryVideoJob } from "@/lib/productionGraph";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    jobs: z
      .array(
        z.object({
          nodeId: z.string(),
          jobId: z.union([z.string(), z.number()]),
          jobType: z.enum(["video", "image", "prompt"]),
        }),
      )
      .optional(),
    jobId: z.union([z.string(), z.number()]).optional(),
    jobType: z.enum(["video", "image", "prompt"]).optional(),
    nodeId: z.string().optional(),
  }),
  async (req, res) => {
    try {
      const jobs = Array.isArray(req.body.jobs)
        ? req.body.jobs
        : req.body.jobId
          ? [
              {
                nodeId: req.body.nodeId ?? "",
                jobId: req.body.jobId,
                jobType: req.body.jobType ?? "video",
              },
            ]
          : [];

      const result = await Promise.all(
        jobs.map(async (job: { nodeId: string; jobId: number | string; jobType: "video" | "image" | "prompt" }) => {
          if (job.jobType !== "video") {
            return {
              nodeId: job.nodeId,
              jobId: job.jobId,
              jobType: job.jobType,
              status: "success",
            };
          }

          const status = await queryVideoJob(Number(job.jobId));
          return {
            nodeId: job.nodeId,
            jobType: job.jobType,
            ...status,
          };
        }),
      );

      res.status(200).send(success({ jobs: result }));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
