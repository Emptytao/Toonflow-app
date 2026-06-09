import express from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getEpisodeId } from "@/lib/productionCanvasV2";

const router = express.Router();

function getExtFromBase64(base64Data: string) {
  const mime = base64Data.match(/^data:([^;]+);base64,/)?.[1] ?? "";
  const mimeMap: Record<string, { ext: string; fileType: "image" | "video" | "audio" }> = {
    "image/jpeg": { ext: "jpg", fileType: "image" },
    "image/jpg": { ext: "jpg", fileType: "image" },
    "image/png": { ext: "png", fileType: "image" },
    "image/webp": { ext: "webp", fileType: "image" },
    "video/mp4": { ext: "mp4", fileType: "video" },
    "video/webm": { ext: "webm", fileType: "video" },
    "audio/mpeg": { ext: "mp3", fileType: "audio" },
    "audio/mp3": { ext: "mp3", fileType: "audio" },
    "audio/wav": { ext: "wav", fileType: "audio" },
    "audio/ogg": { ext: "ogg", fileType: "audio" },
  };
  return mimeMap[mime] ?? null;
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodeId: z.number().optional(),
    episodesId: z.number().optional(),
    base64Data: z.string(),
  }),
  async (req, res) => {
    try {
      const projectId = Number(req.body.projectId);
      const episodeId = getEpisodeId(req.body);
      const extInfo = getExtFromBase64(req.body.base64Data);
      if (!extInfo) {
        return res.status(400).send(error("不支持的媒体类型"));
      }
      const savePath = `/${projectId}/productionCanvasV2/${episodeId}/uploads/${uuidv4()}.${extInfo.ext}`;
      await u.oss.writeFile(savePath, req.body.base64Data);
      const url =
        extInfo.fileType === "image"
          ? await u.oss.getSmallImageUrl(savePath)
          : await u.oss.getFileUrl(savePath);
      res.status(200).send(success({ url, fileType: extInfo.fileType }));
    } catch (err) {
      res.status(400).send(error((err as Error).message));
    }
  },
);
