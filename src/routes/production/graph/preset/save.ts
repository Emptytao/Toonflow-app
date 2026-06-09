import express from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    name: z.string(),
    category: z.string().optional(),
    content: z.string(),
    description: z.string().optional(),
  }),
  async (req, res) => {
    try {
      const now = Date.now();
      const id = uuidv4();
      await u.db("o_productionGraphPreset").insert({
        id,
        projectId: req.body.projectId,
        name: req.body.name,
        category: req.body.category ?? "",
        content: req.body.content,
        description: req.body.description ?? "",
        createdAt: now,
        updatedAt: now,
      });
      res.status(200).send(success({ id }));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
