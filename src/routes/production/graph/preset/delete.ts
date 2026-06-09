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
  }),
  async (req, res) => {
    try {
      await u.db("o_productionGraphPreset").where({ id: req.body.id, projectId: req.body.projectId }).delete();
      res.status(200).send(success());
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
