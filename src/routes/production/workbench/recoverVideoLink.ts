import express from "express";
import axios from "axios";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();
const SUCCESS_STATUSES = new Set(["completed", "success", "succeeded"]);
const FAILED_STATUSES = new Set(["failed", "failure", "error", "cancelled", "expired"]);
type VideoQueryResponse = { status: string; url?: string; error?: string; raw?: any };

async function urlToBase64(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const mime = res.headers["content-type"] || "video/mp4";
  const b64 = Buffer.from(res.data).toString("base64");
  return `data:${mime};base64,${b64}`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value: string): string {
  if (!value) return "";
  return value.startsWith("Bearer ") ? value : `Bearer ${value}`;
}

function safeJsonParseRecord(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const data = JSON.parse(value);
    if (!data || Array.isArray(data) || typeof data !== "object") return {};
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(data)) {
      if (typeof key === "string" && typeof item === "string") {
        result[key] = item;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function readPath(obj: any, path: string): any {
  const normalizedPath = path.replace(/\[(\d+)\]/g, ".$1");
  return normalizedPath.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function pickFirstString(obj: any, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(obj, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function extractVideoStatus(data: any): string {
  const rawStatus = pickFirstString(data, ["status", "data.status", "task_status", "data.task_status", "state"]);
  return String(rawStatus || "").toLowerCase();
}

function extractVideoUrl(data: any): string | undefined {
  return pickFirstString(data, [
    "url",
    "video_url",
    "result_url",
    "download_url",
    "file_url",
    "data.url",
    "data.video_url",
    "data.result_url",
    "data.download_url",
    "data.file_url",
    "data.data.url",
    "data.data.video_url",
    "data.data.result_url",
    "content.video_url",
    "content.url",
    "content.download_url",
    "content.file_url",
    "data.content.video_url",
    "data.content.url",
    "data.content.download_url",
    "data.content.file_url",
    "result.url",
    "result.video_url",
    "result.download_url",
    "result.file_url",
    "result.content.video_url",
    "result.content.url",
    "result.content.download_url",
    "result.content.file_url",
    "metadata.url",
    "metadata.download_url",
    "metadata.file_url",
    "data.metadata.url",
    "data.metadata.download_url",
    "data.metadata.file_url",
    "output.url",
    "output.video_url",
    "output.download_url",
    "output.file_url",
    "output.video.url",
    "output.video.download_url",
    "output.video.file_url",
    "data[0].url",
    "data[0].video_url",
    "data[0].download_url",
    "data[0].file_url",
    "output[0].url",
    "output[0].video_url",
    "output[0].download_url",
    "output[0].file_url",
  ]);
}

function extractVideoError(data: any): string {
  return (
    pickFirstString(data, ["error.message", "message", "msg", "data.error.message", "data.message", "result.error.message"]) ||
    "远端视频任务生成失败"
  );
}

function summarizeResponseKeys(data: any): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "non-object";
  const keys = Object.keys(data).slice(0, 10);
  return keys.length ? keys.join(", ") : "empty-object";
}

function buildMissingVideoUrlMessage(data: any): string {
  const status = extractVideoStatus(data) || "unknown";
  const keys = summarizeResponseKeys(data);
  return `远端任务已完成，但响应中未找到视频地址。status=${status}，keys=${keys}`;
}

async function getVendorInputValues(model: unknown): Promise<Record<string, string>> {
  const modelValue = normalizeText(model);
  if (!modelValue.includes(":")) return {};
  const [vendorId] = modelValue.split(/:(.+)/);
  if (!vendorId) return {};
  const vendorConfig = await u.db("o_vendorConfig").where("id", vendorId).select("inputValues").first();
  return safeJsonParseRecord(vendorConfig?.inputValues);
}

async function getDefaultVideoQueryConfig(model: unknown): Promise<{ baseUrl: string; authToken: string; vendorId?: string }> {
  const candidates: Array<{ vendorId: string; baseUrl: string; authToken: string; priority: number }> = [];
  const seenVendorIds = new Set<string>();

  const appendCandidate = (vendorId: string, inputValues: Record<string, string>, priority: number) => {
    if (!vendorId || seenVendorIds.has(vendorId)) return;
    const baseUrl = normalizeText(inputValues.baseUrl);
    const authToken = normalizeText(inputValues.videoKey) || normalizeText(inputValues.apiKey);
    if (!baseUrl || !authToken) return;
    seenVendorIds.add(vendorId);
    candidates.push({ vendorId, baseUrl, authToken, priority });
  };

  const modelValue = normalizeText(model);
  if (modelValue.includes(":")) {
    const [vendorId] = modelValue.split(/:(.+)/);
    if (vendorId) {
      appendCandidate(vendorId, await getVendorInputValues(modelValue), 100);
    }
  }

  const enabledVendors = await u.db("o_vendorConfig").where("enable", 1).select("id", "inputValues");
  for (const vendor of enabledVendors) {
    const vendorId = normalizeText(vendor.id);
    const inputValues = safeJsonParseRecord(vendor.inputValues);
    const priority = vendorId === "reborn_ai" ? 90 : 50;
    appendCandidate(vendorId, inputValues, priority);
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const target = candidates[0];
  return target ? { baseUrl: target.baseUrl, authToken: target.authToken, vendorId: target.vendorId } : { baseUrl: "", authToken: "" };
}

async function queryVideoGenerationDirect(options: {
  taskId: string;
  baseUrl: string;
  authToken: string;
}): Promise<{ status: string; url?: string; error?: string; raw?: any }> {
  const requestUrl = `${options.baseUrl.replace(/\/+$/, "")}/v1/video/generations/${encodeURIComponent(options.taskId)}`;
  const headers = {
    Authorization: normalizeToken(options.authToken),
  };
  const response = await axios.get(requestUrl, {
    headers,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const message = extractVideoError(response.data) || `请求失败，状态码 ${response.status}`;
    throw new Error(`远端视频任务查询失败: ${message}`);
  }

  const data = response.data;
  const status = extractVideoStatus(data);
  if (SUCCESS_STATUSES.has(status)) {
    return { status: "succeeded", url: extractVideoUrl(data), raw: data };
  }
  if (FAILED_STATUSES.has(status)) {
    return { status: "failed", error: extractVideoError(data), raw: data };
  }
  return { status: status || "running", raw: data };
}

export default router.post(
  "/",
  validateFields({
    videoId: z.number(),
    taskId: z.string().optional(),
  }),
  async (req, res) => {
    const { videoId, taskId } = req.body;
    const video = await u
      .db("o_video")
      .where("id", videoId)
      .select("id", "filePath", "remoteTaskId", "model", "state", "errorReason")
      .first();

    const inputTaskId = normalizeText(taskId);

    if (!video) return res.status(404).send(error("未找到该视频记录"));
    const savedTaskId = normalizeText(video.remoteTaskId);
    const effectiveTaskId = inputTaskId || savedTaskId;
    if (!effectiveTaskId) return res.status(400).send(error("这条视频记录缺少远端任务ID，无法重新获取链接"));
    if (!video.filePath) return res.status(400).send(error("这条视频记录缺少本地保存路径，无法重新获取链接"));

    try {
      const defaultQueryConfig = await getDefaultVideoQueryConfig(video.model);
      const effectiveBaseUrl = defaultQueryConfig.baseUrl;
      const effectiveAuthToken = defaultQueryConfig.authToken;
      const hasDirectCredentials = !!effectiveBaseUrl && !!effectiveAuthToken;
      const canUseVendorQuery = !!video.model && String(video.model).includes(":");

      let result: VideoQueryResponse;

      if (hasDirectCredentials) {
        result = await queryVideoGenerationDirect({
          taskId: effectiveTaskId,
          baseUrl: effectiveBaseUrl,
          authToken: effectiveAuthToken,
        });
      } else {
        if (!canUseVendorQuery) {
          return res.status(400).send(error("这条视频记录缺少可用的默认查询配置，请先在供应商配置中完善视频查询所需的 Base URL 和 Token"));
        }
        const aiVideo = u.Ai.Video(video.model as `${string}:${string}`);
        result = await aiVideo.queryResult(effectiveTaskId);
      }

      if (result.status === "failed") {
        const message = result.error || "远端视频任务生成失败";
        await u.db("o_video").where("id", videoId).update({ state: "生成失败", errorReason: message });
        return res.status(400).send(error(message));
      }

      if (result.status !== "succeeded") {
        return res.status(200).send(success({ id: videoId, state: "生成中", message: "远端任务仍在生成中，请稍后再试" }));
      }

      if (!result.url) {
        const message = buildMissingVideoUrlMessage(result.raw);
        await u.db("o_video").where("id", videoId).update({ state: "生成失败", errorReason: message });
        return res.status(400).send(error(message));
      }

      const fileData = result.url.startsWith("http") ? await urlToBase64(result.url) : result.url;
      await u.oss.writeFile(video.filePath, fileData);
      await u.db("o_video").where("id", videoId).update({ state: "生成成功", errorReason: null, remoteTaskId: effectiveTaskId });

      res.status(200).send(
        success({
          id: videoId,
          state: "已完成",
          src: await u.oss.getFileUrl(video.filePath),
        }),
      );
    } catch (e) {
      const message = u.error(e).message || "重新获取视频链接失败";
      await u.db("o_video").where("id", videoId).update({ state: "生成失败", errorReason: message });
      res.status(400).send(error(message));
    }
  },
);
