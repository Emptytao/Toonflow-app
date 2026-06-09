import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import u from "@/utils";

export type CanvasV2NodeType = "media" | "prompt" | "loop" | "video";
export type CanvasV2RuntimeStatus = "idle" | "queued" | "running" | "success" | "error" | "stopped";
export type CanvasV2EdgeKind = "media" | "prompt" | "loop";
export type CanvasV2FileType = "image" | "video" | "audio";
export type CanvasV2MediaSourceType = "upload" | "assets" | "storyboard" | "videoResult";
export type CanvasV2WorkflowAction = "generatePrompt" | "generateVideo";
type ProviderVideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

export interface CanvasV2Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasV2Runtime {
  status: CanvasV2RuntimeStatus;
  jobType?: "prompt" | "video" | null;
  jobId?: number | string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  elapsedMs?: number | null;
  errorMessage?: string;
  resultUrl?: string;
}

export interface CanvasV2MediaItem {
  id: string;
  fileType: CanvasV2FileType;
  url: string;
  label: string;
  sourceType: CanvasV2MediaSourceType;
  sourceId?: number | null;
  prompt?: string;
  createdAt?: number;
}

export interface CanvasV2VideoResult {
  id: string;
  url: string;
  state: CanvasV2RuntimeStatus;
  createdAt: number;
  prompt?: string;
  errorMessage?: string;
}

export interface MediaNodeDataV2 {
  title: string;
  items: CanvasV2MediaItem[];
  note: string;
}

export interface PromptNodeDataV2 {
  title: string;
  rawPrompt: string;
  resolvedPrompt: string;
  rewriteEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  systemPrompt: string;
  rewriteInstruction: string;
  runtime: CanvasV2Runtime;
}

export interface LoopNodeDataV2 {
  title: string;
  enableImageInput: boolean;
  enablePromptInput: boolean;
  count: number;
  startIndex: number;
  executionMode: "serial" | "parallel";
  takeCount: number;
  prompts: string[];
}

export interface VideoNodeDataV2 {
  title: string;
  model: string;
  mode: string;
  resolution: string;
  duration: number;
  audio: boolean;
  prompt: string;
  referenceItems: CanvasV2MediaItem[];
  runtime: CanvasV2Runtime;
  videoResults: CanvasV2VideoResult[];
  selectedResultId: string;
}

export type VideoWorkflowNodeDataV2 = VideoNodeDataV2;

export interface CanvasV2Node<T = Record<string, any>> {
  id: string;
  type: CanvasV2NodeType;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  data: T;
}

export interface CanvasV2Edge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  kind: CanvasV2EdgeKind;
}

export interface CanvasV2Document {
  viewport: CanvasV2Viewport;
  nodes: CanvasV2Node[];
  edges: CanvasV2Edge[];
  meta: Record<string, any>;
}

const DEFAULT_VIEWPORT: CanvasV2Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

function normalizeRuntime(runtime?: Partial<CanvasV2Runtime>): CanvasV2Runtime {
  return {
    status: runtime?.status ?? "idle",
    jobType: runtime?.jobType ?? null,
    jobId: runtime?.jobId ?? null,
    startedAt: runtime?.startedAt ?? null,
    finishedAt: runtime?.finishedAt ?? null,
    elapsedMs: runtime?.elapsedMs ?? null,
    errorMessage: runtime?.errorMessage ?? "",
    resultUrl: runtime?.resultUrl ?? "",
  };
}

function createMediaDefaults(data?: Partial<MediaNodeDataV2>): MediaNodeDataV2 {
  return {
    title: data?.title ?? "图片节点",
    items: Array.isArray(data?.items) ? data.items : [],
    note: data?.note ?? "",
  };
}

function createPromptDefaults(data?: Partial<PromptNodeDataV2>): PromptNodeDataV2 {
  return {
    title: data?.title ?? "Prompt",
    rawPrompt: data?.rawPrompt ?? "",
    resolvedPrompt: data?.resolvedPrompt ?? "",
    rewriteEnabled: Boolean(data?.rewriteEnabled),
    llmProvider: data?.llmProvider ?? "",
    llmModel: data?.llmModel ?? "",
    systemPrompt: data?.systemPrompt ?? "",
    rewriteInstruction: data?.rewriteInstruction ?? "",
    runtime: normalizeRuntime(data?.runtime),
  };
}

function createLoopDefaults(data?: Partial<LoopNodeDataV2>): LoopNodeDataV2 {
  return {
    title: data?.title ?? "Loop",
    enableImageInput: data?.enableImageInput !== false,
    enablePromptInput: data?.enablePromptInput !== false,
    count: Number(data?.count ?? 3),
    startIndex: Number(data?.startIndex ?? 1),
    executionMode: data?.executionMode === "parallel" ? "parallel" : "serial",
    takeCount: Number(data?.takeCount ?? 1),
    prompts: Array.isArray(data?.prompts) && data.prompts.length ? data.prompts : [""],
  };
}

function createVideoDefaults(data?: Partial<VideoNodeDataV2>): VideoNodeDataV2 {
  const normalizedTitle = data?.title && data.title !== "Video Workflow" ? data.title : "视频节点";
  return {
    title: normalizedTitle,
    model: data?.model ?? "",
    mode: data?.mode ?? "text",
    resolution: data?.resolution ?? "720p",
    duration: Number(data?.duration ?? 5),
    audio: Boolean(data?.audio),
    prompt: data?.prompt ?? "",
    referenceItems: Array.isArray(data?.referenceItems) ? data.referenceItems : [],
    runtime: normalizeRuntime(data?.runtime),
    videoResults: Array.isArray(data?.videoResults) ? data.videoResults : [],
    selectedResultId: data?.selectedResultId ?? "",
  };
}

export function getEpisodeId(body: Record<string, any>) {
  const value = body.episodeId ?? body.episodesId;
  const episodeId = Number(value);
  if (!Number.isFinite(episodeId)) throw new Error("episodeId 不合法");
  return episodeId;
}

export function createEmptyCanvasV2Document(projectId: number, episodeId: number): CanvasV2Document {
  return {
    viewport: { ...DEFAULT_VIEWPORT },
    nodes: [],
    edges: [],
    meta: {
      graphId: `${projectId}-${episodeId}`,
      projectId,
      episodeId,
      version: 1,
      createdAt: Date.now(),
    },
  };
}

export function normalizeCanvasV2Document(raw: any, projectId: number, episodeId: number): CanvasV2Document {
  const fallback = createEmptyCanvasV2Document(projectId, episodeId);
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw?.edges) ? raw.edges : [];

  return {
    viewport: {
      x: Number(raw?.viewport?.x ?? fallback.viewport.x),
      y: Number(raw?.viewport?.y ?? fallback.viewport.y),
      zoom: Number(raw?.viewport?.zoom ?? fallback.viewport.zoom),
    },
    nodes: nodes
      .filter((node: any) => node?.id && node?.type)
      .map((node: any) => {
        const normalizedType = node.type === "videoWorkflow" ? "video" : node.type;
        const baseNode: CanvasV2Node = {
          id: String(node.id),
          type: normalizedType,
          position: {
            x: Number(node?.position?.x ?? 0),
            y: Number(node?.position?.y ?? 0),
          },
          size: {
            width: Math.max(220, Number(node?.size?.width ?? 280)),
            height: Math.max(120, Number(node?.size?.height ?? 180)),
          },
          data: node?.data ?? {},
        };
        if (baseNode.type === "media") {
          baseNode.data = createMediaDefaults(baseNode.data);
        } else if (baseNode.type === "prompt") {
          baseNode.data = createPromptDefaults(baseNode.data);
        } else if (baseNode.type === "loop") {
          baseNode.data = createLoopDefaults(baseNode.data);
        } else if (baseNode.type === "video") {
          baseNode.data = createVideoDefaults(baseNode.data);
        }
        return baseNode;
      }),
    edges: edges
      .filter((edge: any) => edge?.id && edge?.source && edge?.target)
      .map((edge: any) => ({
        id: String(edge.id),
        source: String(edge.source),
        target: String(edge.target),
        sourcePort: edge.sourcePort ? String(edge.sourcePort) : undefined,
        targetPort: edge.targetPort ? String(edge.targetPort) : undefined,
        kind: (edge.kind || inferEdgeKind(edge.sourcePort, edge.targetPort)) as CanvasV2EdgeKind,
      })),
    meta: {
      ...(raw?.meta ?? {}),
      graphId: raw?.meta?.graphId ?? `${projectId}-${episodeId}`,
      projectId,
      episodeId,
    },
  };
}

function inferEdgeKind(sourcePort?: string, targetPort?: string): CanvasV2EdgeKind {
  const raw = `${sourcePort ?? ""}:${targetPort ?? ""}`.toLowerCase();
  if (raw.includes("prompt")) return "prompt";
  if (raw.includes("loop")) return "loop";
  return "media";
}

async function getCanvasRecord(projectId: number, episodeId: number) {
  return (u.db as any)("o_productionCanvasV2").where({ projectId, episodeId }).first();
}

export async function loadCanvasV2Document(projectId: number, episodeId: number) {
  const record = await getCanvasRecord(projectId, episodeId);
  if (!record?.graphData) {
    return {
      version: 0,
      created: false,
      graphData: createEmptyCanvasV2Document(projectId, episodeId),
    };
  }
  return {
    version: Number(record.version ?? 1),
    created: true,
    graphData: normalizeCanvasV2Document(JSON.parse(record.graphData), projectId, episodeId),
  };
}

export async function saveCanvasV2Document(projectId: number, episodeId: number, graph: CanvasV2Document) {
  const normalized = normalizeCanvasV2Document(graph, projectId, episodeId);
  const now = Date.now();
  const existing = await getCanvasRecord(projectId, episodeId);
  const payload = {
    projectId,
    episodeId,
    version: Number(existing?.version ?? 0) + 1,
    graphData: JSON.stringify(normalized),
    updatedAt: now,
  };

  if (!existing) {
    const graphId = `${projectId}-${episodeId}`;
    await (u.db as any)("o_productionCanvasV2").insert({
      graphId,
      createdAt: now,
      ...payload,
    });
    return { graphId, version: payload.version, graphData: normalized };
  }

  await (u.db as any)("o_productionCanvasV2").where({ projectId, episodeId }).update(payload);
  return {
    graphId: existing.graphId,
    version: payload.version,
    graphData: normalized,
  };
}

export function findNode(graph: CanvasV2Document, nodeId: string) {
  return graph.nodes.find((node) => node.id === nodeId);
}

export function getIncomingEdges(graph: CanvasV2Document, nodeId: string, kind?: CanvasV2EdgeKind) {
  return graph.edges.filter((edge) => edge.target === nodeId && (!kind || edge.kind === kind));
}

export function getUpstreamNodes(graph: CanvasV2Document, nodeId: string, kind?: CanvasV2EdgeKind) {
  return getIncomingEdges(graph, nodeId, kind)
    .map((edge) => findNode(graph, edge.source))
    .filter((node): node is CanvasV2Node => Boolean(node));
}

export function validateEdge(sourceNode?: CanvasV2Node, targetNode?: CanvasV2Node) {
  if (!sourceNode || !targetNode) return null;
  if (sourceNode.id === targetNode.id) return null;
  if (sourceNode.type === "prompt" && ["prompt", "media", "video"].includes(targetNode.type)) return "prompt";
  if (sourceNode.type === "media" && ["prompt", "media", "video"].includes(targetNode.type)) return "media";
  return null;
}

function dedupeItems(items: CanvasV2MediaItem[]) {
  const seen = new Map<string, CanvasV2MediaItem>();
  items.forEach((item) => {
    const key = `${item.sourceType}:${item.sourceId ?? item.url}:${item.fileType}`;
    if (!seen.has(key)) seen.set(key, item);
  });
  return Array.from(seen.values());
}

async function fetchExternalAsDataUrl(url: string) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const contentType = response.headers["content-type"] || "application/octet-stream";
  const base64 = Buffer.from(response.data).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

async function resolveAssetRow(item: CanvasV2MediaItem) {
  if (item.sourceType === "storyboard" && item.sourceId) {
    const storyboard = await u.db("o_storyboard").where("id", item.sourceId).select("id", "filePath", "videoDesc", "prompt", "duration").first();
    return storyboard
      ? {
          type: "storyboard" as const,
          id: storyboard.id,
          label: item.label,
          fileType: "image" as const,
          filePath: storyboard.filePath ?? "",
          videoDesc: storyboard.videoDesc ?? "",
          prompt: storyboard.prompt ?? "",
          duration: storyboard.duration ?? "",
        }
      : null;
  }
  if (item.sourceType === "assets" && item.sourceId) {
    const asset = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.id", item.sourceId)
      .select("o_assets.id", "o_assets.type", "o_assets.name", "o_assets.prompt", "o_assets.describe", "o_image.filePath")
      .first();
    return asset
      ? {
          type: "asset" as const,
          id: asset.id,
          label: asset.name ?? item.label,
          fileType: asset.type === "audio" ? ("audio" as const) : ("image" as const),
          assetType: asset.type ?? "image",
          filePath: asset.filePath ?? "",
          prompt: asset.prompt ?? "",
          describe: asset.describe ?? "",
        }
      : null;
  }
  return null;
}

async function itemToDataUrl(item: CanvasV2MediaItem) {
  if (item.url?.startsWith("data:")) return item.url;
  const row = await resolveAssetRow(item);
  if (row?.filePath) {
    const normalized = u.replaceUrl(row.filePath);
    if (row.fileType === "image" && normalized) {
      try {
        return await u.oss.getImageBase64(normalized);
      } catch {}
      try {
        return await u.oss.getImageBase64(`smallImage/${normalized}`);
      } catch {}
    }
    const publicUrl =
      row.fileType === "image" && normalized
        ? await u.oss.getSmallImageUrl(normalized)
        : normalized
          ? await u.oss.getFileUrl(normalized)
          : item.url;
    return fetchExternalAsDataUrl(publicUrl || item.url);
  }
  return fetchExternalAsDataUrl(item.url);
}

async function collectMediaReferences(graph: CanvasV2Document, node: CanvasV2Node<VideoWorkflowNodeDataV2>) {
  const upstreamItems = getUpstreamNodes(graph, node.id, "media")
    .filter((upstream): upstream is CanvasV2Node<MediaNodeDataV2> => upstream.type === "media")
    .flatMap((mediaNode) => mediaNode.data.items ?? []);
  return dedupeItems([...(node.data.referenceItems ?? []), ...upstreamItems]);
}

function collectPromptInputs(graph: CanvasV2Document, node: CanvasV2Node<VideoWorkflowNodeDataV2>) {
  const upstreamPrompts = getUpstreamNodes(graph, node.id, "prompt")
    .filter((upstream): upstream is CanvasV2Node<PromptNodeDataV2> => upstream.type === "prompt")
    .map((promptNode) => promptNode.data.resolvedPrompt || promptNode.data.rawPrompt)
    .filter(Boolean);
  return upstreamPrompts;
}

function composePromptText(parts: Array<string | undefined | null>) {
  const seen = new Set<string>();
  return parts
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .join("\n\n");
}

function resolvePromptText(graph: CanvasV2Document, node: CanvasV2Node<VideoWorkflowNodeDataV2>) {
  return composePromptText([...collectPromptInputs(graph, node), node.data.prompt]);
}

function collectLoopSummaries(graph: CanvasV2Document, node: CanvasV2Node<VideoWorkflowNodeDataV2>) {
  return getUpstreamNodes(graph, node.id, "loop")
    .filter((upstream): upstream is CanvasV2Node<LoopNodeDataV2> => upstream.type === "loop")
    .map((loopNode) => {
      const prompts = (loopNode.data.prompts ?? []).map((item) => String(item || "").trim()).filter(Boolean);
      return {
        nodeId: loopNode.id,
        count: Number(loopNode.data.count || 1),
        startIndex: Number(loopNode.data.startIndex || 1),
        executionMode: loopNode.data.executionMode || "serial",
        takeCount: Number(loopNode.data.takeCount || 1),
        enableImageInput: Boolean(loopNode.data.enableImageInput),
        enablePromptInput: Boolean(loopNode.data.enablePromptInput),
        prompts,
      };
    });
}

async function getVideoPromptSystem(model: string) {
  const [vendorId, modelName] = String(model || "").split(/:(.+)/);
  const dbPrompt = await u.db("o_prompt").where("type", "videoPromptGeneration").first();
  const boundPrompt = vendorId && modelName ? await u.db("o_modelPrompt").where({ vendorId, model: modelName }).first() : null;
  if (boundPrompt?.path) {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const fullPath = path.join(u.getPath(["modelPrompt"]), boundPrompt.path);
      return await fs.readFile(fullPath, "utf-8");
    } catch {}
  }
  return dbPrompt?.useData || dbPrompt?.data || "你是视频提示词生成助手，请根据输入素材整理成适合视频模型的提示词。";
}

async function generateVideoPromptForWorkflow(
  projectId: number,
  graph: CanvasV2Document,
  node: CanvasV2Node<VideoWorkflowNodeDataV2>,
) {
  const promptSystem = await getVideoPromptSystem(node.data.model);
  const project = await u.db("o_project").where("id", projectId).select("artStyle").first();
  const artStyle = project?.artStyle || "无";
  const visualManual = u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video");
  const promptText = resolvePromptText(graph, node);
  const items = await collectMediaReferences(graph, node);
  const loops = collectLoopSummaries(graph, node);
  const resolved = await Promise.all(items.map((item) => resolveAssetRow(item)));
  const assetEntries = resolved.filter((row) => row?.type === "asset");
  const storyboardEntries = resolved.filter((row) => row?.type === "storyboard");
  const uploadEntries = items.filter((item) => item.sourceType === "upload" || item.sourceType === "videoResult");
  const content = `
模型名称：${node.data.model}

资产信息：${assetEntries
  .map((asset: any) => `[${asset.id},${asset.assetType},${asset.label}]`)
  .join("，")}

分镜信息：${storyboardEntries
  .map(
    (storyboard: any) => `<storyboardItem videoDesc='${storyboard.videoDesc || storyboard.prompt || storyboard.label}' duration='${storyboard.duration || ""}'></storyboardItem>`,
  )
  .join("\n")}

上传素材：${uploadEntries.map((item) => `[${item.fileType},${item.label}]`).join("，")}

上游提示词：${promptText || "无"}

循环输入：${
    loops.length
      ? loops
          .map(
            (loop) =>
              `[count=${loop.count},start=${loop.startIndex},mode=${loop.executionMode},take=${loop.takeCount},image=${loop.enableImageInput},prompt=${loop.enablePromptInput},prompts=${loop.prompts.join(" | ") || "无"}]`,
          )
          .join("\n")
      : "无"
  }
`;

  const { text } = await u.Ai.Text("universalAi").invoke({
    system: promptSystem,
    messages: [
      {
        role: "assistant",
        content: visualManual || "",
      },
      {
        role: "user",
        content,
      },
    ],
  });
  return text?.trim() || promptText;
}

export async function runPromptNode(node: CanvasV2Node<PromptNodeDataV2>) {
  const startedAt = Date.now();
  if (!node.data.rewriteEnabled) {
    node.data.resolvedPrompt = node.data.rawPrompt;
    node.data.runtime = normalizeRuntime({
      status: "success",
      jobType: "prompt",
      startedAt,
      finishedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
    });
    return node;
  }
  if (!node.data.llmProvider || !node.data.llmModel) {
    throw new Error("提示词节点未配置 LLM 模型");
  }
  node.data.runtime = normalizeRuntime({
    status: "running",
    jobType: "prompt",
    startedAt,
  });
  const { text } = await u.Ai.Text(`${node.data.llmProvider}:${node.data.llmModel}`).invoke({
    messages: [
      {
        role: "system",
        content:
          node.data.systemPrompt ||
          "你是提示词改写助手。请保留原意，提升结构和画面表达，只输出改写后的提示词正文。",
      },
      {
        role: "user",
        content: `${node.data.rewriteInstruction || "请改写下面的提示词。"}\n\n${node.data.rawPrompt}`,
      },
    ],
  });
  node.data.resolvedPrompt = text?.trim() || node.data.rawPrompt;
  node.data.runtime = normalizeRuntime({
    status: "success",
    jobType: "prompt",
    startedAt,
    finishedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
  });
  return node;
}

export async function runVideoWorkflowNode(
  projectId: number,
  episodeId: number,
  graph: CanvasV2Document,
  node: CanvasV2Node<VideoWorkflowNodeDataV2>,
  action: CanvasV2WorkflowAction,
) {
  if (action === "generatePrompt") {
    const startedAt = Date.now();
    node.data.runtime = normalizeRuntime({
      status: "running",
      jobType: "prompt",
      startedAt,
    });
    const prompt = await generateVideoPromptForWorkflow(projectId, graph, node);
    node.data.prompt = prompt;
    node.data.runtime = normalizeRuntime({
      status: "success",
      jobType: "prompt",
      startedAt,
      finishedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
    });
    return {
      node,
      resultType: "prompt",
    };
  }

  const startedAt = Date.now();
  const finalPrompt = resolvePromptText(graph, node);
  if (!finalPrompt) throw new Error("视频节点缺少提示词");
  if (!node.data.model) throw new Error("视频节点未选择模型");
  const modelKey = node.data.model as `${string}:${string}`;

  const project = await u.db("o_project").where("id", projectId).select("videoRatio").first();
  const referenceItems = await collectMediaReferences(graph, node);
  const loopSummaries = collectLoopSummaries(graph, node);
  const referenceList = await Promise.all(
    referenceItems.map(async (item) => ({
      type: item.fileType,
      base64: await itemToDataUrl(item),
    })),
  );
  const videoPath = `/${projectId}/productionCanvasV2/${episodeId}/${node.id}/${uuidv4()}.mp4`;
  const [videoId] = await u.db("o_video").insert({
    filePath: videoPath,
    time: Date.now(),
    state: "生成中",
    scriptId: episodeId,
    projectId,
    videoTrackId: null,
  });

  node.data.runtime = normalizeRuntime({
    status: "queued",
    jobType: "video",
    jobId: videoId,
    startedAt,
  });

  const parsedMode = (() => {
    try {
      const value = JSON.parse(node.data.mode);
      return Array.isArray(value) ? ([value as ProviderVideoMode] as ProviderVideoMode[]) : ([node.data.mode as ProviderVideoMode] as ProviderVideoMode[]);
    } catch {
      return [node.data.mode as ProviderVideoMode];
    }
  })();

  void u.Ai.Video(modelKey)
    .run(
      {
        prompt: finalPrompt,
        referenceList,
        mode: parsedMode.length ? parsedMode : (["text"] as ProviderVideoMode[]),
        duration: Number(node.data.duration || 5),
        aspectRatio: (project?.videoRatio as "16:9" | "9:16") || "16:9",
        resolution: node.data.resolution || "720p",
        audio: Boolean(node.data.audio),
      },
      {
        taskClass: "Production V2 视频生成",
        describe: "Production V2 视频节点生成视频",
        relatedObjects: JSON.stringify({ nodeId: node.id, episodeId, prompt: finalPrompt, loopSummaries, referenceCount: referenceItems.length }),
        projectId,
      },
    )
    .then(async (videoClass) => {
      await videoClass.save(videoPath);
      await u.db("o_video").where("id", videoId).update({ state: "已完成" });
    })
    .catch(async (err: any) => {
      await u.db("o_video").where("id", videoId).update({
        state: "生成失败",
        errorReason: u.error(err).message,
      });
    });

  return {
    node,
    jobId: videoId,
    resultType: "video",
  };
}

export async function queryVideoWorkflowJob(jobId: number) {
  const record = await u.db("o_video").where("id", jobId).first();
  if (!record) throw new Error("视频任务不存在");
  const status: CanvasV2RuntimeStatus =
    record.state === "已完成" || record.state === "生成成功"
      ? "success"
      : record.state === "生成失败"
        ? "error"
        : record.state === "生成中"
          ? "running"
          : "queued";
  const resultUrl = record.filePath ? await u.oss.getFileUrl(record.filePath) : "";
  return {
    jobId,
    status,
    resultUrl,
    errorMessage: record.errorReason ?? "",
    finishedAt: status === "success" || status === "error" ? Date.now() : null,
  };
}
