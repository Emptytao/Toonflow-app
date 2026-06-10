import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
const router = express.Router();

const agentDeployItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  model: z.string(),
  modelName: z.string(),
  vendorId: z.string().nullable(),
  desc: z.string(),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
});

const deployAgentModelSchema = z.union([
  z.object({
    items: z.array(agentDeployItemSchema),
  }),
  agentDeployItemSchema,
]);

export default router.post(
  "/",
  async (req, res) => {
    const parseResult = deployAgentModelSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => `字段 ${issue.path.join(".")} ${issue.message}`);
      console.error(errors);
      return res.status(400).json({ message: "参数错误", errors });
    }

    const items = "items" in parseResult.data ? parseResult.data.items : [parseResult.data];
    for (const item of items) {
      const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = item;
      await u.db("o_agentDeploy").where({ id }).update({ id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens });
    }
    res.status(200).send(success(items.length > 1 ? "批量配置成功" : "配置成功"));
  },
);
