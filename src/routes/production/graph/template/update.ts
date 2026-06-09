import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    projectId: z.number(),
    name: z.string(),
    category: z.string().optional(),
    content: z.string(),
    description: z.string().optional(),
  }),
  async (req, res) => {
    try {
      await u.db("o_productionGraphTemplate").where({ id: req.body.id, projectId: req.body.projectId }).update({
        name: req.body.name,
        category: req.body.category ?? "",
        content: req.body.content,
        description: req.body.description ?? "",
        updatedAt: Date.now(),
      });
      res.status(200).send(success());
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
