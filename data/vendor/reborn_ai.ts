/**
 * reborn_ai 供应商模板
 * 基于 new-api 标准接口整理
 *
 * 参考文档:
 * - /Users/tao/Documents/code/reboenapi/docs/standard-api-reference.zh-CN.md
 * - /Users/tao/Documents/code/reboenapi/docs/current-newapi-api-guide.zh-CN.md
 */

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
  onTaskId?: (taskId: string) => void | Promise<void>;
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

declare const axios: any;
declare const fetch: any;
declare const logger: (msg: string) => void;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const createOpenAI: any;
declare const FormData: any;
declare const Buffer: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  queryVideoResult?: (taskId: string, m: VideoModel) => Promise<{ status: string; url?: string; error?: string; raw?: any }>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
};

const vendor: VendorConfig = {
  id: "reborn_ai",
  version: "1.0.0",
  author: "Codex",
  name: "Reborn AI",
  description:
    "标准 new-api 兼容供应商模板，支持文本、图片与异步视频任务。\n\n默认 Base URL 请替换为你的 reborn_ai / new-api 实例地址，并按 /v1/models 查询结果自行调整模型列表。",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "填写你的 Bearer Token" },
    { key: "textKey", label: "文本API密钥", type: "password", required: false, placeholder: "不填则使用 API 密钥" },
    { key: "imageKey", label: "图像API密钥", type: "password", required: false, placeholder: "不填则使用 API 密钥" },
    { key: "videoKey", label: "视频API密钥", type: "password", required: false, placeholder: "不填则使用 API 密钥" },
    { key: "baseUrl", label: "Base URL", type: "url", required: false, placeholder: "例如 https://your-domain.example.com" },
  ],
  inputValues: {
    apiKey: "",
    textKey: "",
    imageKey: "",
    videoKey: "",
    baseUrl: "https://your-domain.example.com",
  },
  models: [
    { name: "GPT-4o Mini", type: "text", modelName: "gpt-4o-mini", think: false },
    { name: "GPT-5", type: "text", modelName: "gpt-5", think: true },
    { name: "Image 2", type: "image", modelName: "image2", mode: ["text", "singleImage", "multiReference"] },
    { name: "GPT Image 1", type: "image", modelName: "gpt-image-1", mode: ["text", "singleImage", "multiReference"] },
    {
      name: "Sora 2",
      type: "video",
      modelName: "sora-2",
      mode: ["text"],
      audio: false,
      durationResolutionMap: [{ duration: [4, 8, 12], resolution: ["720p"] }],
    },
    {
      name: "Veo",
      type: "video",
      modelName: "veo",
      mode: ["text", "singleImage"],
      audio: false,
      durationResolutionMap: [{ duration: [4, 6, 8], resolution: ["720p", "1080p"] }],
    },
    {
      name: "Grok Imagine Video",
      type: "video",
      modelName: "grok-imagine-video",
      mode: ["text"],
      audio: false,
      durationResolutionMap: [{ duration: [4, 6, 8], resolution: ["720p", "1080p"] }],
    },
    {
      name: "Omni Flash",
      type: "video",
      modelName: "omni_flash",
      mode: ["text", ["imageReference:7"]],
      audio: false,
      durationResolutionMap: [{ duration: [4, 6, 8], resolution: ["1080p"] }],
    },
  ],
};

const getBaseUrl = () => {
  const raw = vendor.inputValues.baseUrl || "https://your-domain.example.com";
  return raw.replace(/\/+$/, "");
};

const getTextUrl = () => `${getBaseUrl()}/v1`;
const getImageUrl = () => `${getBaseUrl()}/v1/images/generations`;
const getImageEditUrl = () => `${getBaseUrl()}/v1/images/edits`;
const getVideoCreateUrl = () => `${getBaseUrl()}/v1/video/generations`;
const getVideoQueryUrl = (taskId: string) => `${getBaseUrl()}/v1/video/generations/${encodeURIComponent(taskId)}`;

const getApiKey = (type?: "text" | "image" | "video") => {
  const keyMap: Record<string, string> = {
    text: "textKey",
    image: "imageKey",
    video: "videoKey",
  };
  const specificKey = type ? vendor.inputValues[keyMap[type]] : "";
  return specificKey || vendor.inputValues.apiKey;
};

const getAuthorization = (type?: "text" | "image" | "video") => {
  const apiKey = getApiKey(type);
  if (!apiKey) {
    throw new Error("请先填写 API 密钥");
  }
  return apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
};

const normalizeBase64 = (completeBase64?: string) => {
  if (!completeBase64 || typeof completeBase64 !== "string") {
    throw new Error("参考文件 base64 为空或格式不正确");
  }
  return completeBase64.replace(/^data:[^;]+;base64,/, "");
};

const base64ToBuffer = (base64: string) => Buffer.from(base64, "base64");

const getFileMeta = (completeBase64: string, defaultName: string) => {
  const match = completeBase64.match(/^data:([^;]+);base64,/);
  const mimeType = match?.[1] || "image/png";
  const extensionMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
  };
  return {
    mimeType,
    filename: `${defaultName}.${extensionMap[mimeType] || "bin"}`,
  };
};

const parseJsonResponse = async (response: any) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口返回了非 JSON 内容: ${text}`);
  }
};

const throwIfBodyError = (data: any, action: string) => {
  const errorMessage = data?.error?.message || (data?.success === false ? data?.message : "");
  if (errorMessage) {
    throw new Error(`${action}失败: ${errorMessage}`);
  }
};

const throwIfPreviewModeResponse = (data: any, action: string) => {
  if (data?.object !== "channel_request_preview") return;

  const channelId = data?.channel?.id;
  const baseUrl = data?.channel?.base_url;
  const upstreamModel = data?.channel?.upstream_model || data?.channel?.origin_model;
  const relayMode = data?.relay?.relay_mode;

  throw new Error(
    `${action}失败: 当前渠道开启了 request preview 模式，不会真正提交任务，也不会返回 task id。` +
      ` channel=${channelId ?? "-"}, model=${upstreamModel ?? "-"}, relay_mode=${relayMode ?? "-"}, base_url=${baseUrl ?? "-"}`
  );
};

const throwIfNotOk = async (response: any, action: string) => {
  if (response.ok) return;
  const rawText = await response.text();
  try {
    const data = JSON.parse(rawText);
    const message = data?.error?.message || data?.message || rawText;
    throw new Error(`${action}失败: ${response.status}, ${message}`);
  } catch {
    throw new Error(`${action}失败: ${response.status}, ${rawText}`);
  }
};

const extractImageResult = (data: any): string | undefined => {
  const candidates = [
    data?.data?.[0]?.url,
    data?.data?.[0]?.b64_json,
    data?.data?.url,
    data?.data?.b64_json,
    data?.output?.images?.[0]?.url,
    data?.output?.images?.[0]?.b64_json,
    data?.output?.url,
    data?.output?.b64_json,
    data?.url,
    data?.b64_json,
  ];
  return candidates.find((item) => typeof item === "string" && item.length > 0);
};

const extractVideoTaskId = (data: any): string | undefined => {
  const candidates = [
    data?.id,
    data?.task_id,
    data?.taskId,
    data?.data?.id,
    data?.data?.task_id,
    data?.data?.taskId,
    data?.result?.id,
    data?.result?.task_id,
  ];
  return candidates.find((item) => typeof item === "string" && item.length > 0);
};

const extractVideoResult = (data: any): string | undefined => {
  const candidates = [
    data?.content?.video_url,
    data?.content?.url,
    data?.content?.download_url,
    data?.content?.file_url,
    data?.metadata?.url,
    data?.metadata?.download_url,
    data?.metadata?.file_url,
    data?.data?.metadata?.url,
    data?.data?.metadata?.download_url,
    data?.data?.metadata?.file_url,
    data?.result?.metadata?.url,
    data?.result?.metadata?.download_url,
    data?.result?.metadata?.file_url,
    data?.video_url,
    data?.data?.video_url,
    data?.data?.content?.video_url,
    data?.data?.content?.url,
    data?.data?.content?.download_url,
    data?.data?.content?.file_url,
    data?.result?.content?.video_url,
    data?.result?.content?.url,
    data?.result?.content?.download_url,
    data?.result?.content?.file_url,
    data?.output?.video_url,
    data?.output?.url,
    data?.output?.download_url,
    data?.output?.file_url,
    data?.output?.video?.url,
    data?.output?.video?.download_url,
    data?.output?.video?.file_url,
    Array.isArray(data?.data) ? data.data?.[0]?.video_url : undefined,
    Array.isArray(data?.data) ? data.data?.[0]?.url : undefined,
    Array.isArray(data?.data) ? data.data?.[0]?.download_url : undefined,
    Array.isArray(data?.data) ? data.data?.[0]?.file_url : undefined,
    Array.isArray(data?.output) ? data.output?.[0]?.video_url : undefined,
    Array.isArray(data?.output) ? data.output?.[0]?.url : undefined,
    Array.isArray(data?.output) ? data.output?.[0]?.download_url : undefined,
    Array.isArray(data?.output) ? data.output?.[0]?.file_url : undefined,
    data?.url,
    data?.data?.url,
    data?.result?.url,
    data?.download_url,
    data?.data?.download_url,
    data?.result?.download_url,
    data?.file_url,
    data?.data?.file_url,
    data?.result?.file_url,
  ];
  return candidates.find((item) => typeof item === "string" && item.length > 0);
};

const getTaskStatus = (data: any) =>
  String(
    data?.status ||
      data?.data?.status ||
      data?.task_status ||
      data?.data?.task_status ||
      data?.state ||
      ""
  ).toLowerCase();

const queryVideoResult = async (taskId: string, model: VideoModel): Promise<{ status: string; url?: string; error?: string; raw?: any }> => {
  const queryResponse = await fetch(getVideoQueryUrl(taskId), {
    method: "GET",
    headers: {
      Authorization: getAuthorization("video"),
    },
  });
  await throwIfNotOk(queryResponse, "视频任务查询");

  const queryData = await parseJsonResponse(queryResponse);
  throwIfBodyError(queryData, "视频任务查询");
  const status = getTaskStatus(queryData);
  logger(`[reborn_ai queryVideoResult] ${model.modelName} 状态: ${status}`);

  if (["completed", "success", "succeeded"].includes(status)) {
    const url = extractVideoResult(queryData);
    if (!url) {
      logger(`[reborn_ai queryVideoResult] ${model.modelName} success payload: ${JSON.stringify(queryData).slice(0, 4000)}`);
    }
    return { status: "succeeded", url, raw: queryData };
  }
  if (["failed", "failure", "error"].includes(status)) {
    return {
      status: "failed",
      error: queryData?.error?.message || queryData?.message || `${model.modelName} 视频生成失败`,
      raw: queryData,
    };
  }
  return { status: status || "running", raw: queryData };
};

const getVideoDimensions = (resolution: string, aspectRatio: "16:9" | "9:16") => {
  const normalizedResolution = String(resolution || "").toLowerCase();
  const isPortrait = aspectRatio === "9:16";

  if (normalizedResolution === "1080p") {
    return { width: isPortrait ? 1080 : 1920, height: isPortrait ? 1920 : 1080 };
  }
  if (normalizedResolution === "720p") {
    return { width: isPortrait ? 720 : 1280, height: isPortrait ? 1280 : 720 };
  }
  return { width: isPortrait ? 720 : 1280, height: isPortrait ? 1280 : 720 };
};

const getGenericImageSize = (imageConfig: ImageConfig, modelName: string) => {
  const normalizedAspectRatio =
    imageConfig.aspectRatio === "9:16"
      ? "9:16"
      : imageConfig.aspectRatio === "16:9"
        ? "16:9"
        : "1:1";

  if (modelName === "image2" || modelName.startsWith("gpt-image-2")) {
    const sizeMap: Record<string, Record<string, string>> = {
      "1:1": { "1k": "1024x1024", "2k": "2048x2048", "4k": "3840x3840" },
      "16:9": { "1k": "1536x1024", "2k": "2048x1152", "4k": "3840x2160" },
      "9:16": { "1k": "1024x1536", "2k": "1152x2048", "4k": "2160x3840" },
    };
    return sizeMap[normalizedAspectRatio]?.[imageConfig.size.toLowerCase()] || sizeMap["1:1"]["1k"];
  }

  if (modelName.startsWith("gpt-image-")) {
    return normalizedAspectRatio === "16:9"
      ? "1536x1024"
      : normalizedAspectRatio === "9:16"
        ? "1024x1536"
        : "1024x1024";
  }

  return normalizedAspectRatio === "16:9"
    ? "1536x1024"
    : normalizedAspectRatio === "9:16"
      ? "1024x1536"
      : "1024x1024";
};

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  const apiKey = getAuthorization("text").replace(/^Bearer\s+/, "");
  const enableThinking = model.think && think && thinkLevel > 0;
  const effortMap: Record<0 | 1 | 2 | 3, "low" | "medium" | "high"> = {
    0: "low",
    1: "low",
    2: "medium",
    3: "high",
  };

  const extraBody: Record<string, any> = {};
  if (enableThinking) {
    extraBody.reasoning_effort = effortMap[thinkLevel];
  }

  return createOpenAI({
    baseURL: getTextUrl(),
    apiKey,
    extraBody,
  }).chat(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const imageRefs = (config.referenceList ?? [])
    .map((item) => item?.base64)
    .filter((item): item is string => typeof item === "string" && item.length > 0);

  logger(`[reborn_ai imageRequest] 提交图片任务，模型: ${model.modelName}`);

  const qualityMap: Record<string, string> = {
    "1K": "low",
    "2K": "medium",
    "4K": "high",
  };
  const imageSize = getGenericImageSize(config, model.modelName);

  if (imageRefs.length > 0) {
    const formData = new FormData();
    formData.append("model", model.modelName);
    formData.append("prompt", config.prompt);
    formData.append("size", imageSize);
    formData.append("n", "1");
    formData.append("quality", qualityMap[config.size] || "medium");

    for (const [index, completeBase64] of imageRefs.entries()) {
      const normalized = normalizeBase64(completeBase64);
      const { filename } = getFileMeta(completeBase64, `image-${index + 1}`);
      formData.append("image", base64ToBuffer(normalized), filename);
    }

    const response = await axios.post(getImageEditUrl(), formData, {
      headers: {
        Authorization: getAuthorization("image"),
        ...(typeof formData.getHeaders === "function" ? formData.getHeaders() : {}),
      },
    });

    const data = response?.data;
    throwIfBodyError(data, "图片编辑");
    const result = extractImageResult(data);
    if (!result) {
      throw new Error(`图片编辑成功但未返回可用结果: ${JSON.stringify(data)}`);
    }
    return result.startsWith("data:")
      ? result
      : result.startsWith("http")
        ? await urlToBase64(result)
        : `data:image/png;base64,${result}`;
  }

  const body = {
    model: model.modelName,
    prompt: config.prompt,
    size: imageSize,
    n: 1,
    quality: qualityMap[config.size] || "medium",
  };

  const response = await fetch(getImageUrl(), {
    method: "POST",
    headers: {
      Authorization: getAuthorization("image"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(response, "图片生成");

  const data = await parseJsonResponse(response);
  throwIfBodyError(data, "图片生成");
  const result = extractImageResult(data);
  if (!result) {
    throw new Error(`图片生成成功但未返回可用结果: ${JSON.stringify(data)}`);
  }
  return result.startsWith("data:")
    ? result
    : result.startsWith("http")
      ? await urlToBase64(result)
      : `data:image/png;base64,${result}`;
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  logger(`[reborn_ai videoRequest] 提交视频任务，模型: ${model.modelName}`);

  const imageRefs = (config.referenceList ?? [])
    .filter((item) => item.type === "image")
    .map((item) => item.base64)
    .filter((item): item is string => typeof item === "string" && item.length > 0);

  if (model.modelName === "omni_flash" && imageRefs.length > 7) {
    throw new Error("omni_flash 最多支持 7 张参考图");
  }

  const { width, height } = getVideoDimensions(config.resolution, config.aspectRatio);

  const body: Record<string, any> = {
    model: model.modelName,
    prompt: config.prompt,
    duration: config.duration,
    width,
    height,
  };

  const metadata: Record<string, any> = {
    resolution: config.resolution,
    aspect_ratio: config.aspectRatio,
  };

  if (model.modelName === "sora-2" && config.duration === 12) {
    metadata.variant = "pro";
  }

  if (model.modelName === "veo") {
    metadata.speed = "standard";
  }

  if (typeof config.audio === "boolean") {
    metadata.audio = config.audio;
  }

  if (model.modelName === "omni_flash") {
    metadata.images = imageRefs;
  } else if (imageRefs.length === 1) {
    body.image = imageRefs[0];
  } else if (imageRefs.length > 1) {
    body.image = imageRefs[0];
    metadata.images = imageRefs;
  }

  if (Object.keys(metadata).length > 0) {
    body.metadata = metadata;
  }

  const createResponse = await fetch(getVideoCreateUrl(), {
    method: "POST",
    headers: {
      Authorization: getAuthorization("video"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(createResponse, "视频任务创建");

  const createData = await parseJsonResponse(createResponse);
  throwIfBodyError(createData, "视频任务创建");
  throwIfPreviewModeResponse(createData, "视频任务创建");

  const taskId = extractVideoTaskId(createData);
  if (!taskId) {
    throw new Error(`视频任务创建成功但未返回 task id: ${JSON.stringify(createData)}`);
  }
  await config.onTaskId?.(taskId);

  const result = await pollTask(async () => {
    const taskResult = await queryVideoResult(taskId, model);
    const status = taskResult.status;
    logger(`[reborn_ai videoRequest] ${model.modelName} 状态: ${status}`);

    if (status === "succeeded") {
      return { completed: true, data: taskResult.url };
    }
    if (status === "failed") {
      return { completed: true, error: taskResult.error || `${model.modelName} 视频生成失败` };
    }
    return { completed: false };
  }, 5000, 20 * 60 * 1000);

  if (result.error) {
    throw new Error(result.error);
  }
  if (!result.data) {
    throw new Error(`${model.modelName} 任务完成，但未返回视频地址`);
  }
  return await urlToBase64(result.data);
};

const ttsRequest = async (_config: TTSConfig, _model: TTSModel): Promise<string> => {
  throw new Error("reborn_ai 模板暂未实现 TTS，请按你的 new-api 实例能力补充");
};

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.queryVideoResult = queryVideoResult;
exports.ttsRequest = ttsRequest;

export {};
