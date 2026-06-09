import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    nodeId: z.string().optional(),
    jobId: z.union([z.string(), z.number()]).optional(),
  }),
  async (_req, res) => {
    res.status(200).send(
      success({
        supported: false,
        message: "当前一期未接入底层停止能力，前端可先停止轮询并保留状态展示。",
      }),
    );
  },
);
