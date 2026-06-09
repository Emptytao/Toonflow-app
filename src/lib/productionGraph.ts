import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import u from "@/utils";

export type GraphNodeType =
  | "script"
  | "scriptPlan"
  | "assets"
  | "storyboardTable"
  | "storyboard"
  | "workbench"
  | "media"
  | "prompt"
  | "loop"
  | "imageGroup";

export type GraphRuntimeStatus = "idle" | "queued" | "running" | "success" | "error" | "stopped";
export type GraphEdgeChannel = "legacy" | "image" | "prompt" | "loop";

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphRuntime {
  status: GraphRuntimeStatus;
  jobId?: string | number | null;
  jobType?: "image" | "video" | "prompt" | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  elapsedMs?: number | null;
  errorMessage?: string;
  resultUrl?: string;
}

export interface GraphMediaItem {
  id: string;
  fileType: "image" | "video" | "audio";
  url: string;
  label?: string;
  prompt?: string;
  sourceNodeId?: string;
  createdAt?: number;
}

export interface GraphMediaGroup {
  id: string;
  label: string;
  items: GraphMediaItem[];
  createdAt: number;
}

export interface GraphNode<T = Record<string, any>> {
  id: string;
  type: GraphNodeType;
  position: {
    x: number;
    y: number;
  };
  width?: number;
  height?: number;
  data: T & Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: {
    channel?: GraphEdgeChannel;
  };
}

export interface GraphDocument {
  viewport: GraphViewport;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: Record<string, any>;
}

interface LegacyNodeSeed {
  id: string;
  type: Extract<GraphNodeType, "script" | "scriptPlan" | "assets" | "storyboardTable" | "storyboard" | "workbench">;
  position: {
    x: number;
    y: number;
  };
  width?: number;
  height?: number;
}

const DEFAULT_VIEWPORT: GraphViewport = {
  x: 80,
  y: 80,
  zoom: 0.85,
};

const LEGACY_NODE_SEEDS: LegacyNodeSeed[] = [
  { id: "script", type: "script", position: { x: 0, y: 0 }, width: 520, height: 360 },
  { id: "scriptPlan", type: "scriptPlan", position: { x: 920, y: 0 }, width: 420, height: 320 },
  { id: "assets", type: "assets", position: { x: 1180, y: 860 }, width: 560, height: 520 },
  { id: "storyboardTable", type: "storyboardTable", position: { x: 1760, y: 0 }, width: 520, height: 360 },
  { id: "storyboard", type: "storyboard", position: { x: 2580, y: 0 }, width: 760, height: 520 },
  { id: "workbench", type: "workbench", position: { x: 3480, y: 0 }, width: 720, height: 420 },
];

const LEGACY_EDGES: GraphEdge[] = [
  createEdge("script", "assets", "image", "script-assets", "assets-target"),
  createEdge("script", "scriptPlan", "legacy", "script-source", "scriptPlan-target"),
  createEdge("scriptPlan", "storyboardTable", "legacy", "scriptPlan-source", "storyboardTable-target"),
  createEdge("storyboardTable", "storyboard", "legacy", "storyboardTable-source", "storyboard-target"),
  createEdge("storyboard", "workbench", "legacy", "storyboard-source", "workbench-target"),
];

function createEdge(
  source: string,
  target: string,
  channel: GraphEdgeChannel,
  sourceHandle?: string,
  targetHandle?: string,
): GraphEdge {
  return {
    id: `${source}-${target}-${channel}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    data: { channel },
  };
}

export function getEpisodeId(body: Record<string, any>) {
  const value = body.episodeId ?? body.episodesId;
  const episodeId = Number(value);
  if (!Number.isFinite(episodeId)) throw new Error("episodeId 不合法");
  return episodeId;
}

export function createHandleIds(nodeId: string, nodeType: GraphNodeType) {
  switch (nodeType) {
    case "script":
      return {
        assets: `${nodeId}-assets`,
        source: `${nodeId}-source`,
      };
    case "scriptPlan":
    case "storyboardTable":
    case "storyboard":
    case "workbench":
      return {
        target: `${nodeId}-target`,
        source: `${nodeId}-source`,
      };
    case "assets":
      return {
        target: `${nodeId}-target`,
      };
    case "prompt":
      return {
        source: `${nodeId}-prompt-source`,
      };
    case "loop":
      return {
        source: `${nodeId}-loop-source`,
      };
    case "imageGroup":
      return {
        target: `${nodeId}-target`,
        source: `${nodeId}-image-source`,
      };
    case "media":
      return {
        prompt: `${nodeId}-prompt-target`,
        image: `${nodeId}-image-target`,
        loop: `${nodeId}-loop-target`,
        source: `${nodeId}-image-source`,
      };
    default:
      return {};
  }
}

function buildLegacyNode(seed: LegacyNodeSeed): GraphNode {
  return {
    id: seed.id,
    type: seed.type,
    position: seed.position,
    width: seed.width,
    height: seed.height,
    data: {
      label: seed.id,
      handleIds: createHandleIds(seed.id, seed.type),
      runtime: { status: "idle" } as GraphRuntime,
    },
  };
}

function normalizeRuntime(runtime?: Partial<GraphRuntime>): GraphRuntime {
  return {
    status: runtime?.status ?? "idle",
    jobId: runtime?.jobId ?? null,
    jobType: runtime?.jobType ?? null,
    startedAt: runtime?.startedAt ?? null,
    finishedAt: runtime?.finishedAt ?? null,
    elapsedMs: runtime?.elapsedMs ?? null,
    errorMessage: runtime?.errorMessage ?? "",
    resultUrl: runtime?.resultUrl ?? "",
  };
}

function ensureMediaData(node: GraphNode) {
  node.data = {
    label: node.data?.label ?? "媒体节点",
    mode: node.data?.mode === "video" ? "video" : "image",
    prompt: node.data?.prompt ?? "",
    draftPrompt: node.data?.draftPrompt ?? node.data?.prompt ?? "",
    items: Array.isArray(node.data?.items) ? node.data.items : [],
    historyGroups: Array.isArray(node.data?.historyGroups) ? node.data.historyGroups : [],
    selectedGroupId: node.data?.selectedGroupId ?? "",
    selectedItemId: node.data?.selectedItemId ?? "",
    params: {
      model: node.data?.params?.model ?? "",
      ratio: node.data?.params?.ratio ?? "16:9",
      quality: node.data?.params?.quality ?? "1K",
      resolution: node.data?.params?.resolution ?? "720p",
      duration: Number(node.data?.params?.duration ?? 5),
      count: Number(node.data?.params?.count ?? 1),
      audio: Boolean(node.data?.params?.audio),
      mode: node.data?.params?.mode ?? "text",
    },
    composer: {
      upstreamImageOrder: Array.isArray(node.data?.composer?.upstreamImageOrder) ? node.data.composer.upstreamImageOrder : [],
      draftSavedAt: node.data?.composer?.draftSavedAt ?? null,
    },
    runtime: normalizeRuntime(node.data?.runtime),
    handleIds: createHandleIds(node.id, "media"),
  };
}

function ensurePromptData(node: GraphNode) {
  node.data = {
    label: node.data?.label ?? "提示词节点",
    rawPrompt: node.data?.rawPrompt ?? node.data?.prompt ?? "",
    resolvedPrompt: node.data?.resolvedPrompt ?? "",
    systemPrompt: node.data?.systemPrompt ?? "",
    rewriteInstruction: node.data?.rewriteInstruction ?? "",
    rewriteEnabled: Boolean(node.data?.rewriteEnabled),
    llmProvider: node.data?.llmProvider ?? "",
    llmModel: node.data?.llmModel ?? "",
    runtime: normalizeRuntime(node.data?.runtime),
    handleIds: createHandleIds(node.id, "prompt"),
  };
}

function ensureLoopData(node: GraphNode) {
  node.data = {
    label: node.data?.label ?? "循环节点",
    enableImageInput: node.data?.enableImageInput !== false,
    enablePromptInput: node.data?.enablePromptInput !== false,
    count: Number(node.data?.count ?? 1),
    startIndex: Number(node.data?.startIndex ?? 1),
    mode: node.data?.mode === "parallel" ? "parallel" : "serial",
    takeCount: Number(node.data?.takeCount ?? 1),
    prompts: Array.isArray(node.data?.prompts) && node.data.prompts.length ? node.data.prompts : [""],
    runtime: normalizeRuntime(node.data?.runtime),
    handleIds: createHandleIds(node.id, "loop"),
  };
}

function ensureImageGroupData(node: GraphNode) {
  node.data = {
    label: node.data?.label ?? "图片组",
    items: Array.isArray(node.data?.items) ? node.data.items : [],
    runtime: normalizeRuntime(node.data?.runtime),
    handleIds: createHandleIds(node.id, "imageGroup"),
  };
}

function ensureLegacyData(node: GraphNode) {
  node.data = {
    label: node.data?.label ?? node.type,
    handleIds: createHandleIds(node.id, node.type),
    runtime: normalizeRuntime(node.data?.runtime),
  };
}

export function createDefaultGraphDocument(projectId: number, episodeId: number): GraphDocument {
  return {
    viewport: { ...DEFAULT_VIEWPORT },
    nodes: LEGACY_NODE_SEEDS.map((seed) => buildLegacyNode(seed)),
    edges: LEGACY_EDGES.map((edge) => ({ ...edge })),
    meta: {
      graphId: `${projectId}-${episodeId}`,
      projectId,
      episodeId,
      migratedFromLegacy: true,
      migratedAt: Date.now(),
    },
  };
}

export function normalizeGraphDocument(raw: any, projectId: number, episodeId: number): GraphDocument {
  const fallback = createDefaultGraphDocument(projectId, episodeId);
  const graph: GraphDocument = {
    viewport: {
      x: Number(raw?.viewport?.x ?? fallback.viewport.x),
      y: Number(raw?.viewport?.y ?? fallback.viewport.y),
      zoom: Number(raw?.viewport?.zoom ?? fallback.viewport.zoom),
    },
    nodes: Array.isArray(raw?.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw?.edges) ? raw.edges : [],
    meta: {
      ...(raw?.meta ?? {}),
      graphId: raw?.meta?.graphId ?? `${projectId}-${episodeId}`,
      projectId,
      episodeId,
    },
  };

  const nodeMap = new Map<string, GraphNode>();
  graph.nodes.forEach((node: GraphNode) => {
    if (!node?.id || !node?.type) return;
    nodeMap.set(node.id, {
      ...node,
      position: {
        x: Number(node.position?.x ?? 0),
        y: Number(node.position?.y ?? 0),
      },
      width: node.width != null ? Number(node.width) : undefined,
      height: node.height != null ? Number(node.height) : undefined,
      data: node.data ?? {},
    });
  });

  for (const seed of LEGACY_NODE_SEEDS) {
    if (!nodeMap.has(seed.id)) {
      nodeMap.set(seed.id, buildLegacyNode(seed));
    }
  }

  graph.nodes = Array.from(nodeMap.values()).map((node) => {
    switch (node.type) {
      case "media":
        ensureMediaData(node);
        break;
      case "prompt":
        ensurePromptData(node);
        break;
      case "loop":
        ensureLoopData(node);
        break;
      case "imageGroup":
        ensureImageGroupData(node);
        break;
      default:
        ensureLegacyData(node);
        break;
    }
    return node;
  });

  const edgeMap = new Map<string, GraphEdge>();
  graph.edges
    .filter((edge: GraphEdge) => edge?.id && edge?.source && edge?.target)
    .forEach((edge: GraphEdge) => {
      edgeMap.set(edge.id, {
        ...edge,
        data: {
          channel: edge.data?.channel ?? inferEdgeChannel(nodeMap.get(edge.source)?.type as GraphNodeType, edge),
        },
      });
    });

  for (const edge of LEGACY_EDGES) {
    if (!edgeMap.has(edge.id)) {
      edgeMap.set(edge.id, { ...edge });
    }
  }

  graph.edges = Array.from(edgeMap.values());
  return graph;
}

function inferEdgeChannel(sourceType: GraphNodeType, edge: GraphEdge): GraphEdgeChannel {
  if (edge.data?.channel) return edge.data.channel;
  if (sourceType === "prompt") return "prompt";
  if (sourceType === "loop") return "loop";
  if (sourceType === "media" || sourceType === "imageGroup" || sourceType === "assets" || sourceType === "storyboard") return "image";
  return "legacy";
}

export async function getGraphRecord(projectId: number, episodeId: number) {
  return u.db("o_productionGraph").where({ projectId, episodeId }).first();
}

export async function loadGraphDocument(projectId: number, episodeId: number) {
  const record = await getGraphRecord(projectId, episodeId);
  if (!record?.graphData) {
    return {
      version: 0,
      graphData: createDefaultGraphDocument(projectId, episodeId),
      created: false,
    };
  }
  return {
    version: Number(record.version ?? 1),
    graphData: normalizeGraphDocument(JSON.parse(record.graphData), projectId, episodeId),
    created: true,
  };
}

export async function saveGraphDocument(projectId: number, episodeId: number, graph: GraphDocument) {
  const normalized = normalizeGraphDocument(graph, projectId, episodeId);
  const now = Date.now();
  const existing = await getGraphRecord(projectId, episodeId);
  const payload = {
    projectId,
    episodeId,
    version: Number(existing?.version ?? 0) + 1,
    graphData: JSON.stringify(normalized),
    updatedAt: now,
  };

  if (!existing) {
    const [graphId] = await u.db("o_productionGraph").insert({
      graphId: `${projectId}-${episodeId}`,
      createdAt: now,
      ...payload,
    });
    return { graphId, version: payload.version, graphData: normalized };
  }

  await u.db("o_productionGraph").where({ projectId, episodeId }).update(payload);
  return {
    graphId: existing.graphId,
    version: payload.version,
    graphData: normalized,
  };
}

export function findNode(graph: GraphDocument, nodeId: string) {
  return graph.nodes.find((node) => node.id === nodeId);
}

export function getIncomingEdges(graph: GraphDocument, nodeId: string) {
  return graph.edges.filter((edge) => edge.target === nodeId);
}

export function getOutgoingEdges(graph: GraphDocument, nodeId: string) {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

export function getUpstreamNodes(graph: GraphDocument, nodeId: string, channel?: GraphEdgeChannel) {
  return getIncomingEdges(graph, nodeId)
    .filter((edge) => !channel || edge.data?.channel === channel)
    .map((edge) => findNode(graph, edge.source))
    .filter((node): node is GraphNode => Boolean(node));
}

export function getReachableNodeIds(graph: GraphDocument, startNodeId: string) {
  const queue = [startNodeId];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    getOutgoingEdges(graph, current).forEach((edge) => {
      if (!visited.has(edge.target)) queue.push(edge.target);
    });
  }
  return Array.from(visited);
}

export function getTopologicalOrder(graph: GraphDocument, nodeIds: string[]) {
  const nodeSet = new Set(nodeIds);
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  graph.edges.forEach((edge) => {
    if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  });

  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    graph.edges.forEach((edge) => {
      if (edge.source !== current || !nodeSet.has(edge.target)) return;
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) - 1);
      if ((indegree.get(edge.target) ?? 0) === 0) queue.push(edge.target);
    });
  }

  return order.length === nodeIds.length ? order : nodeIds;
}

export function parseVideoMode(mode: unknown) {
  if (Array.isArray(mode)) return mode;
  if (typeof mode === "string") {
    try {
      const parsed = JSON.parse(mode);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return mode;
  }
  return "text";
}

export function getActiveMediaItems(node: GraphNode): GraphMediaItem[] {
  if (node.type === "imageGroup") {
    return (node.data?.items ?? []) as GraphMediaItem[];
  }
  if (node.type !== "media") {
    return [];
  }
  const selectedGroup = (node.data?.historyGroups ?? []).find((group: GraphMediaGroup) => group.id === node.data?.selectedGroupId);
  if (selectedGroup?.items?.length) {
    return selectedGroup.items;
  }
  if (Array.isArray(node.data?.items) && node.data.items.length) {
    return node.data.items;
  }
  return [];
}

export function resolveMediaPrompt(graph: GraphDocument, node: GraphNode) {
  const upstreamPrompts = getUpstreamNodes(graph, node.id, "prompt")
    .map((promptNode) => promptNode.data?.resolvedPrompt || promptNode.data?.rawPrompt || "")
    .filter(Boolean);
  const selfPrompt = node.data?.draftPrompt || node.data?.prompt || "";
  return [...upstreamPrompts, selfPrompt].filter(Boolean).join("\n\n");
}

export function collectNodeReferences(graph: GraphDocument, node: GraphNode) {
  const upstreamMedia = getUpstreamNodes(graph, node.id, "image")
    .flatMap((upstreamNode) => getActiveMediaItems(upstreamNode))
    .filter((item) => item?.url);
  const ownItems = Array.isArray(node.data?.items) ? node.data.items.filter((item: GraphMediaItem) => item?.url) : [];
  const deduped = new Map<string, GraphMediaItem>();
  [...ownItems, ...upstreamMedia].forEach((item) => {
    if (!item?.url) return;
    deduped.set(item.url, item);
  });
  return Array.from(deduped.values());
}

async function fetchExternalAsDataUrl(url: string) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const contentType = response.headers["content-type"] || "application/octet-stream";
  const base64 = Buffer.from(response.data).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

export async function mediaUrlToDataUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  const normalized = u.replaceUrl(url);
  if (normalized) {
    try {
      return await u.oss.getImageBase64(normalized);
    } catch {}
    try {
      return await u.oss.getImageBase64(`smallImage/${normalized}`);
    } catch {}
  }
  return fetchExternalAsDataUrl(url);
}

export async function runPromptNode(node: GraphNode) {
  const startedAt = Date.now();
  const rawPrompt = node.data?.rawPrompt ?? "";
  const rewriteEnabled = Boolean(node.data?.rewriteEnabled);

  if (!rewriteEnabled) {
    node.data.resolvedPrompt = rawPrompt;
    node.data.runtime = normalizeRuntime({
      status: "success",
      jobType: "prompt",
      startedAt,
      finishedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
    });
    return node;
  }

  const llmProvider = node.data?.llmProvider;
  const llmModel = node.data?.llmModel;
  if (!llmProvider || !llmModel) {
    throw new Error("提示词节点未配置 LLM 提供商或模型");
  }

  node.data.runtime = normalizeRuntime({
    status: "running",
    jobType: "prompt",
    startedAt,
  });

  const systemPrompt =
    node.data?.systemPrompt ||
    "你是提示词改写助手。请保留原意，提升画面表达、结构清晰度和模型可执行性，只输出改写后的提示词正文。";
  const rewriteInstruction = node.data?.rewriteInstruction || "请改写下面的提示词。";

  const { text } = await u.Ai.Text(`${llmProvider}:${llmModel}`).invoke({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${rewriteInstruction}\n\n${rawPrompt}` },
    ],
  });

  node.data.resolvedPrompt = text?.trim() || rawPrompt;
  node.data.runtime = normalizeRuntime({
    status: "success",
    jobType: "prompt",
    startedAt,
    finishedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
  });
  return node;
}

function makeHistoryGroup(node: GraphNode, item: GraphMediaItem): GraphMediaGroup {
  const timestamp = Date.now();
  return {
    id: uuidv4(),
    label: `${node.data?.mode === "video" ? "视频结果" : "图片结果"} ${new Date(timestamp).toLocaleString("zh-CN", { hour12: false })}`,
    items: [{ ...item, createdAt: timestamp }],
    createdAt: timestamp,
  };
}

async function getProjectSettings(projectId: number) {
  return u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "videoModel", "videoRatio", "mode").first();
}

export async function runMediaNodeImage(projectId: number, episodeId: number, graph: GraphDocument, node: GraphNode) {
  const startedAt = Date.now();
  node.data.runtime = normalizeRuntime({
    status: "running",
    jobType: "image",
    startedAt,
  });

  const settings = await getProjectSettings(projectId);
  const prompt = resolveMediaPrompt(graph, node);
  if (!prompt) throw new Error("媒体节点缺少可执行提示词");
  const references = collectNodeReferences(graph, node).filter((item) => item.fileType === "image");
  const model = node.data?.params?.model || settings?.imageModel;
  if (!model) throw new Error("未配置图片模型");
  const quality = node.data?.params?.quality || settings?.imageQuality || "1K";
  const ratio = node.data?.params?.ratio || settings?.videoRatio || "16:9";

  const imageClass = await u.Ai.Image(model).run(
    {
      prompt,
      referenceList: await Promise.all(
        references.map(async (item) => ({
          type: "image" as const,
          base64: await mediaUrlToDataUrl(item.url),
        })),
      ),
      size: quality,
      aspectRatio: ratio,
    },
    {
      taskClass: "生产画布图片生成",
      describe: "生产画布媒体节点图片生成",
      relatedObjects: JSON.stringify({ nodeId: node.id, episodeId, prompt }),
      projectId,
    },
  );
  const savePath = `/${projectId}/productionGraph/${episodeId}/${node.id}/${uuidv4()}.jpg`;
  await imageClass.save(savePath);
  const url = await u.oss.getSmallImageUrl(savePath);
  const item: GraphMediaItem = {
    id: uuidv4(),
    fileType: "image",
    url,
    prompt,
    sourceNodeId: node.id,
    createdAt: Date.now(),
  };
  const historyGroup = makeHistoryGroup(node, item);
  node.data.historyGroups = [historyGroup, ...(node.data?.historyGroups ?? [])];
  node.data.selectedGroupId = historyGroup.id;
  node.data.selectedItemId = item.id;
  node.data.runtime = normalizeRuntime({
    status: "success",
    jobType: "image",
    startedAt,
    finishedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    resultUrl: url,
  });
  node.data.prompt = prompt;
  node.data.draftPrompt = prompt;
  return {
    node,
    resultItem: item,
  };
}

export async function runMediaNodeVideo(projectId: number, episodeId: number, graph: GraphDocument, node: GraphNode) {
  const startedAt = Date.now();
  const settings = await getProjectSettings(projectId);
  const prompt = resolveMediaPrompt(graph, node);
  if (!prompt) throw new Error("媒体节点缺少可执行提示词");
  const model = node.data?.params?.model || settings?.videoModel;
  if (!model) throw new Error("未配置视频模型");

  const referenceItems = collectNodeReferences(graph, node);
  const referenceList = await Promise.all(
    referenceItems.map(async (item) => ({
      type: item.fileType,
      base64: await mediaUrlToDataUrl(item.url),
    })),
  );
  const videoPath = `/${projectId}/productionGraph/${episodeId}/${node.id}/${uuidv4()}.mp4`;
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
  node.data.prompt = prompt;
  node.data.draftPrompt = prompt;

  const mode = parseVideoMode(node.data?.params?.mode ?? settings?.mode ?? "text");
  const duration = Number(node.data?.params?.duration ?? 5);
  const resolution = node.data?.params?.resolution || "720p";
  const audio = Boolean(node.data?.params?.audio);
  const aspectRatio = (settings?.videoRatio as "16:9" | "9:16") || "16:9";

  void u.Ai.Video(model)
    .run(
      {
        prompt,
        referenceList,
        mode: Array.isArray(mode) ? mode : [mode],
        duration,
        aspectRatio,
        resolution,
        audio,
      },
      {
        taskClass: "生产画布视频生成",
        describe: "生产画布媒体节点视频生成",
        relatedObjects: JSON.stringify({ nodeId: node.id, episodeId, prompt }),
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
    videoId,
  };
}

export async function queryVideoJob(jobId: number) {
  const record = await u.db("o_video").where("id", jobId).first();
  if (!record) throw new Error("视频任务不存在");
  const url = record.filePath ? await u.oss.getFileUrl(record.filePath) : "";
  const finishedAt = record.state === "已完成" || record.state === "生成失败" ? Date.now() : null;
  const status: GraphRuntimeStatus =
    record.state === "已完成" ? "success" : record.state === "生成失败" ? "error" : record.state === "生成中" ? "running" : "queued";

  return {
    jobId,
    status,
    url,
    errorMessage: record?.errorReason ?? "",
    finishedAt,
  };
}
