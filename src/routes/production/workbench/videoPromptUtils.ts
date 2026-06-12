import u from "@/utils";
import { isSeedance20Model } from "@/utils/videoModelRouting";
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

export interface VideoPromptAiTrace {
  prompt: string;
  thinking: string;
  skill: string;
  tools: string[];
  modelName: string;
  inputSummary: string;
  visualManual: string;
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
          associateAssetsIds: assetRows
            .map((row) => row.assetId)
            .filter((assetId): assetId is number => typeof assetId === "number"),
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

export async function generateBgmSuggestion(modelName: string, visualManual: string, content: string) {
  void modelName;
  try {
    const { text } = await u.Ai.Text("universalAi").invoke({
      system: [
        "你是短剧视频 BGM 推荐助手。",
        "根据输入的资产信息、分镜信息和视觉风格，生成一段供人工参考的 BGM 推荐建议。",
        "这段建议不会参与视频生成，请不要输出视频提示词、XML、分镜正文或解释过程。",
        "只输出 BGM 推荐文本，80-160 字，包含情绪方向、节奏速度、音乐质感、适合进入/收束的位置。",
        "不得改写剧情，不得新增台词，不得要求模型生成配乐。",
      ].join("\n"),
      messages: [
        {
          role: "assistant",
          content: visualManual,
        },
        {
          role: "user",
          content,
        },
      ],
    });
    const result = text.trim();
    return result || buildBgmSuggestionFallback(content);
  } catch {
    return buildBgmSuggestionFallback(content);
  }
}

export function buildVideoPromptAiTrace(params: {
  prompt: string;
  thinking?: string;
  modelName: string;
  inputSummary: string;
  visualManual: string;
}): VideoPromptAiTrace {
  return {
    prompt: params.prompt,
    thinking: params.thinking?.trim() || buildVideoPromptThinkingSummary(params.modelName, params.inputSummary, params.visualManual),
    skill: "videoPromptGeneration",
    tools: [
      "loadVideoPromptContext",
      "resolveVideoPromptTemplate",
      'u.Ai.Text("universalAi").invoke',
      "generateBgmSuggestion",
    ],
    modelName: params.modelName,
    inputSummary: params.inputSummary,
    visualManual: params.visualManual,
  };
}

function buildVideoPromptThinkingSummary(modelName: string, inputSummary: string, visualManual: string) {
  void modelName;
  const hasSummary = inputSummary?.trim().length > 0;
  const hasVisual = visualManual?.trim().length > 0;
  return [
    "先读取当前轨道关联的资产、分镜与视觉风格约束。",
    hasVisual ? "再结合项目视觉手册与模型提示词模板整理生成方向。" : "",
    hasSummary ? "随后按分镜内容拼接视频提示词，并同步生成 BGM 参考建议。" : "",
    "最终输出可直接用于视频生成的提示词结果。",
  ]
    .filter(Boolean)
    .join("");
}

function buildBgmSuggestionFallback(content: string) {
  const text = content || "";
  const toneMap: Array<[RegExp, string]> = [
    [/紧张|压迫|危机|战斗|追逐|对抗/, "建议使用紧张压迫的中低频配乐，节奏中快，鼓点推进明显，适合在冲突升级处逐步增强。"],
    [/悲伤|失落|痛苦|压抑|哀伤/, "建议使用克制的抒情氛围配乐，节奏偏慢，钢琴或弦乐铺底，适合情绪下沉与停顿段落。"],
    [/悬疑|诡异|神秘|暗夜|黑暗/, "建议使用悬疑感较强的环境音色配乐，低频铺底、留白较多，适合推进未知感和压迫感。"],
    [/温暖|治愈|轻松|温柔|日常/, "建议使用轻柔舒缓的氛围配乐，节奏平稳，木吉他或轻钢琴为主，适合人物互动与过渡段落。"],
    [/热血|激昂|奋起|胜利|燃/, "建议使用鼓舞感更强的配乐，节奏更明确，打击乐和弦乐推进突出，适合动作升级和情绪爆发。"],
  ];
  const matched = toneMap.find(([reg]) => reg.test(text))?.[1];
  return matched || "建议使用中性电影氛围配乐，节奏保持中等偏稳，前段以铺底和氛围为主，后段逐步加强层次与情绪推进。";
}

export function stringifyVideoPromptAiTrace(trace?: VideoPromptAiTrace | null) {
  if (!trace) return "";
  return JSON.stringify(trace);
}

export function parseVideoPromptAiTrace(value?: string | null): VideoPromptAiTrace | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as VideoPromptAiTrace;
  } catch {
    return null;
  }
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
