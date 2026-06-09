import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    try {
      const data = await u.db("o_productionGraphTemplate").where("projectId", req.body.projectId).orderBy("updatedAt", "desc");
      res.status(200).send(success(data));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
