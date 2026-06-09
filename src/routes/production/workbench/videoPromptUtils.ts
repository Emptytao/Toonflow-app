import u from "@/utils";
import fs from "fs/promises";
import path from "path";

export interface PromptInfoItem {
  id: number;
  sources: string;
}

export interface VideoPromptAsset {
  id: number;
  type?: string | null;
  name?: string | null;
  filePath?: string | null;
}

export interface VideoPromptStoryboard {
  videoDesc?: string | null;
  prompt?: string | null;
  track?: string | null;
  duration?: string | number | null;
  associateAssetsIds: number[];
  shouldGenerateImage?: boolean | number | string | null;
}

export function isSeedance20Model(modelName: string) {
  return /seedance.*2[.\-]0/i.test(modelName);
}

export async function resolveVideoPromptTemplate(model: string, mode?: string) {
  const [vendorId = "", modelName = ""] = model.split(/:(.+)/);
  const videoPrompt = await u.db("o_prompt").where("type", "videoPromptGeneration").first();
  let videoPromptGeneration = "";

  const modelPromptData = await u.db("o_modelPrompt").where("vendorId", vendorId).where("model", modelName).first();
  if (modelPromptData?.path) {
    try {
      const fullPath = path.join(u.getPath(["modelPrompt"]), modelPromptData.path);
      videoPromptGeneration = await fs.readFile(fullPath, "utf-8");
    } catch {}
  }

  if (!videoPromptGeneration) {
    const fileName = getVideoPromptFileName(modelName, mode);
    if (fileName) {
      try {
        const fullPath = path.join(u.getPath(["modelPrompt", "video"]), fileName);
        videoPromptGeneration = await fs.readFile(fullPath, "utf-8");
      } catch {}
    }
  }

  if (!videoPromptGeneration) {
    videoPromptGeneration = videoPrompt?.useData || videoPrompt?.data || "";
  }

  return {
    vendorId,
    modelName,
    videoPromptGeneration,
  };
}

export async function loadVideoPromptContext(info: PromptInfoItem[]) {
  const mixedData = await Promise.all(
    info.map(async (item) => {
      if (item.sources === "storyboard") {
        const storyboard = await u
          .db("o_storyboard")
          .where("o_storyboard.id", item.id)
          .select("videoDesc", "prompt", "track", "duration", "shouldGenerateImage")
          .first();
        const assetRows = await u.db("o_assets2Storyboard").where("storyboardId", item.id).orderBy("rowid").select("assetId");
        return {
          ...storyboard,
          associateAssetsIds: assetRows.map((row: { assetId: number }) => row.assetId),
          _type: "storyboard" as const,
        };
      }

      if (item.sources === "assets") {
        const asset = await u
          .db("o_assets")
          .leftJoin("o_image", "o_image.id", "o_assets.imageId")
          .where("o_assets.id", item.id)
          .select("o_assets.id", "o_assets.type", "o_assets.name", "o_image.filePath")
          .first();
        return {
          ...asset,
          _type: "assets" as const,
        };
      }

      return null;
    }),
  );

  const assets: VideoPromptAsset[] = [];
  const storyboard: VideoPromptStoryboard[] = [];
  for (const item of mixedData) {
    if (!item) continue;
    if (item._type === "assets") {
      assets.push({
        id: item.id,
        type: item.type,
        name: item.name,
        filePath: item.filePath,
      });
    }
    if (item._type === "storyboard") {
      storyboard.push({
        videoDesc: item.videoDesc,
        prompt: item.prompt,
        track: item.track,
        duration: item.duration,
        associateAssetsIds: item.associateAssetsIds,
        shouldGenerateImage: item.shouldGenerateImage,
      });
    }
  }

  const audioAssetIds = assets.filter((item) => item.type === "audio").map((item) => item.id);
  const assetsAudioRecord: Record<number, number> = {};
  if (audioAssetIds.length) {
    const assets2Audio = await u
      .db("o_assets")
      .whereIn("o_assets.id", audioAssetIds)
      .join("o_assetsRole2Audio", "o_assetsRole2Audio.assetsAudioId", "o_assets.assetsId")
      .select("o_assets.id", "o_assetsRole2Audio.assetsRoleId");
    assets2Audio.forEach((item: { id?: number; assetsRoleId?: number }) => {
      if (item.assetsRoleId && item.id) {
        assetsAudioRecord[item.assetsRoleId] = item.id;
      }
    });
  }

  return {
    assets,
    storyboard,
    assetsAudioRecord,
  };
}

export function buildVideoPromptContent(modelName: string, assets: VideoPromptAsset[], storyboard: VideoPromptStoryboard[], assetsAudioRecord: Record<number, number>) {
  const assetSummary =
    assets
      .filter((item) => item.filePath)
      .map(
        (item) =>
          `[${item.id},${item.type},${item.name}${assetsAudioRecord[item.id] ? `, audio:${assetsAudioRecord[item.id]}` : ""}]`,
      )
      .join("，") || "无";
  const storyboardSummary = storyboard.map((item) => buildStoryboardItemXml(item)).join("\n") || "无";

  return `
**模型名称**：${modelName},

**资产信息**（角色、场景、道具、音频):${assetSummary},

**分镜信息**：
${storyboardSummary}
`;
}

export function buildStoryboardItemXml(item: VideoPromptStoryboard) {
  const associateAssetsIds = escapeXmlAttribute(JSON.stringify(item.associateAssetsIds ?? []));
  return `<storyboardItem
  videoDesc='${escapeXmlAttribute(item.videoDesc ?? "")}'
  prompt='${escapeXmlAttribute(item.prompt ?? "")}'
  track='${escapeXmlAttribute(item.track ?? "")}'
  duration='${escapeXmlAttribute(String(item.duration ?? ""))}'
  associateAssetsIds='${associateAssetsIds}'
  shouldGenerateImage='${normalizeShouldGenerateImage(item.shouldGenerateImage)}'
></storyboardItem>`;
}

function getVideoPromptFileName(modelName: string, mode?: string) {
  const modelLower = modelName.toLowerCase();
  if (modelLower.includes("wan") && modelLower.includes("2.6")) {
    return "wan2.6Single-imageFirstFrameMode.md";
  }
  if (isSeedance20Model(modelName)) {
    return "seedance2Multi-parameterMode.md";
  }
  if (mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional") {
    return "universalFirstAndLastFrameMode.md";
  }
  if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
    return "universalMulti-parameterMode.md";
  }
  return null;
}

function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeShouldGenerateImage(value: VideoPromptStoryboard["shouldGenerateImage"]) {
  if (typeof value === "string") {
    return value === "true" ? "true" : "false";
  }
  return value ? "true" : "false";
}
