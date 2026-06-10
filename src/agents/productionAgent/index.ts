import { Socket } from "socket.io";
import { z } from "zod";
import { tool, jsonSchema } from "ai";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { createSkillTools, parseFrontmatter, scanSkills, useSkill } from "@/utils/agent/skillsTools";
import useTools from "@/agents/productionAgent/tools";
import ResTool from "@/socket/resTool";
import { getDirectorSkillPaths } from "@/utils/storySkills";
import { resolveStoryboardPanelWriteMode } from "@/utils/videoModelRouting";
import * as fs from "fs";
import path from "path";

export interface AgentContext {
  socket: Socket;
  isolationKey: string;
  text: string;
  userMessageTime?: number;
  abortSignal?: AbortSignal;
  resTool: ResTool;
  msg: ReturnType<ResTool["newMessage"]>;
  messages?: { role: "user" | "assistant" | "system"; content: string }[];
  thinkConfig: {
    think: boolean;
    thinlLevel: 0 | 1 | 2 | 3;
  };
}

function buildMemPrompt(mem: Awaited<ReturnType<Memory["get"]>>): string {
  let memoryContext = "";
  if (mem.rag.length) {
    memoryContext += `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`;
  }
  if (mem.summaries.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`;
  }
  if (mem.shortTerm.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`;
  }
  return `## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`;
}

function normalizeProductionSupervisionPrompt(prompt: string) {
  const normalized = String(prompt || "").trim();
  if (!normalized) return normalized;

  if (/审核对象\s*[:：]\s*(导演规划|拍摄计划|scriptPlan|script plan)/i.test(normalized)) {
    return normalized;
  }
  if (/审核对象\s*[:：]\s*(分镜表|storyboardTable|storyboard table)/i.test(normalized)) {
    return normalized;
  }

  if (/(导演规划审核|拍摄计划审核|审核导演规划|审核拍摄计划|导演规划|拍摄计划|scriptPlan|script plan|director plan)/i.test(normalized)) {
    return `审核对象：导演规划审核\n${normalized}`;
  }
  if (/(分镜表审核|审核分镜|分镜表|storyboardTable|storyboard table|review storyboard)/i.test(normalized)) {
    return `审核对象：分镜表审核\n${normalized}`;
  }
  return normalized;
}

function shouldAutoRecoverStoryboardPanel(prompt: string) {
  const normalized = String(prompt || "").trim();
  if (!normalized) return false;
  if (/(审核|审查|review|分镜表|storyboardTable|storyboard table)/i.test(normalized)) return false;
  return /(继续|下一步|生成故事板|故事板生成|生成分镜图|分镜图生成|生成分镜|故事板|分镜图)/i.test(normalized);
}

async function getProductionStageSnapshot(projectId: number, scriptId: number) {
  const sqlData = await u
    .db("o_agentWorkData")
    .where("projectId", String(projectId))
    .andWhere("episodesId", String(scriptId))
    .where("key", "productionAgent")
    .select("data")
    .first();

  let storyboardTable = "";
  try {
    const parsed = JSON.parse(sqlData?.data ?? "{}");
    storyboardTable = parsed?.storyboardTable ?? "";
  } catch {
    storyboardTable = "";
  }

  const storyboardCountRecord = (await u
    .db("o_storyboard")
    .where({ projectId, scriptId })
    .count("* as total")
    .first()) as { total?: number | string } | undefined;

  return {
    hasStoryboardTable: Boolean(String(storyboardTable || "").trim()),
    storyboardCount: Number(storyboardCountRecord?.total ?? 0),
  };
}

export async function runDecisionAI(ctx: AgentContext) {
  const { isolationKey, abortSignal } = ctx;
  let text = ctx.text;
  const memory = new Memory("productionAgent", isolationKey);
  await memory.add("user", text);

  const skill = path.join(u.getPath("skills"), "production_agent_decision.md");
  const prompt = await fs.promises.readFile(skill, "utf-8");

  const projectInfo = await u.db("o_project").where("id", ctx.resTool.data.projectId).first();
  if (!projectInfo) throw new Error(`项目不存在，ID: ${ctx.resTool.data.projectId}`);
  const [_, imageModelName] = projectInfo.imageModel!.split(/:(.+)/);
  const [id, videoModelName] = projectInfo.videoModel!.split(/:(.+)/);
  const storyboardWriteMode = resolveStoryboardPanelWriteMode(videoModelName);
  const models = await u.vendor.getModelList(id);
  if (!models.length) throw new Error(`项目使用的模型不存在，ID: ${projectInfo.videoModel}`);

  const modelInfo = `项目使用的模型如下：\n图像模型：${imageModelName}\n视频模型：${videoModelName}\n分镜面板写入模式：${storyboardWriteMode}`;

  const stageSnapshot = await getProductionStageSnapshot(ctx.resTool.data.projectId, ctx.resTool.data.scriptId);
  if (stageSnapshot.hasStoryboardTable && stageSnapshot.storyboardCount === 0 && shouldAutoRecoverStoryboardPanel(text)) {
    text =
      `【系统纠偏】当前分镜表已存在，但分镜面板为空。` +
      `本轮必须先执行阶段5「分镜面板写入」，完成后如果用户目的是生成故事板，再继续执行阶段6「分镜图生成」。` +
      `不要只回复“无法生成”。\n用户请求：${text}`;
  }

  const mem = buildMemPrompt(await memory.get(text));

  const { fullStream } = await u.Ai.Text("productionAgent:decisionAgent", ctx.thinkConfig.think, ctx.thinkConfig.thinlLevel).stream({
    messages: [
      { role: "system", content: prompt },
      { role: "assistant", content: mem + "\n" + modelInfo },
      { role: "user", content: text },
    ],
    abortSignal,
    tools: {
      ...memory.getTools(),
      ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
      ...(await createSubAgent(ctx)),
    },
    onFinish: async (completion) => {
      await memory.add("assistant:decision", removeAllXmlTags(completion.text));
    },
  });

  let currentMsg = ctx.msg;
  await consumeFullStream(fullStream, currentMsg, () => {
    if (ctx.msg === currentMsg) return currentMsg;
    currentMsg.complete();
    currentMsg = ctx.msg;
    return currentMsg;
  });
}

async function createSubAgent(parentCtx: AgentContext) {
  const { resTool, abortSignal } = parentCtx;
  const memory = new Memory("productionAgent", parentCtx.isolationKey);
  const readOnlyTools = useTools({ resTool, msg: parentCtx.msg, toolsNames: ["get_flowData"] });
  async function runAgent({
    key,
    prompt,
    system,
    name,
    memoryKey,
    tools: extraTools,
    includeDefaultTools = true,
    messages,
  }: {
    key: `${string}:${string}`;
    prompt: string;
    system: string;
    name: string;
    memoryKey: string;
    tools?: Record<string, any>;
    includeDefaultTools?: boolean;
    messages?: { role: "user" | "assistant" | "system"; content: string }[];
  }) {
    parentCtx.msg.complete();
    const subMsg = resTool.newMessage("assistant", name);
    const defaultTools = includeDefaultTools ? useTools({ resTool, msg: subMsg }) : {};

    const { fullStream } = await u.Ai.Text(key, parentCtx.thinkConfig.think, parentCtx.thinkConfig.thinlLevel).stream({
      system,
      messages: messages ?? [{ role: "user", content: prompt }],
      abortSignal,
      tools: { ...defaultTools, ...extraTools },
    });

    const fullResponse = await consumeFullStream(fullStream, subMsg);

    if (fullResponse.trim()) {
      await memory.add(memoryKey, removeAllXmlTags(fullResponse), {
        name,
        createTime: new Date(subMsg.datetime).getTime(),
      });
    }

    parentCtx.msg = resTool.newMessage("assistant", "视频策划");
    return fullResponse;
  }

  const promptInput = z
    .object({
      prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
    })
    .toJSONSchema();

  const projectInfo = await u.db("o_project").where("id", resTool.data.projectId).first();
  if (!projectInfo) throw new Error(`项目不存在，ID: ${resTool.data.projectId}`);
  const artSkills = await createArtSkills(projectInfo?.artStyle!, projectInfo?.directorManual!);

  const [_, imageModelName] = projectInfo.imageModel!.split(/:(.+)/);
  const [id, videoModelName] = projectInfo.videoModel!.split(/:(.+)/);
  const storyboardWriteMode = resolveStoryboardPanelWriteMode(videoModelName);
  const models = await u.vendor.getModelList(id);
  if (!models.length) throw new Error(`项目使用的模型不存在，ID: ${projectInfo.videoModel}`);

  const modelInfo = `项目使用的模型如下：\n图像模型：${imageModelName}\n视频模型：${videoModelName}\n分镜面板写入模式：${storyboardWriteMode}`;

  // const run_sub_agent_execution = tool({
  //   description: "执行层子Agent，负责衍生资产、",
  //   inputSchema: promptInput,
  //   execute: async ({ prompt }) => {
  //     const skill = path.join(u.getPath("skills"), "production_agent_execution.md");
  //     const systemPrompt = await fs.promises.readFile(skill, "utf-8");
  //     const addPrompt =
  //       "\n" +
  //       [
  //         "你必须使用如下XML格式写入工作区：\n```",
  //         "拍摄计划：<scriptPlan>内容</scriptPlan>",
  //         "分镜表：<storyboardTable>内容</storyboardTable>",
  //         "分镜面板：<storyboardItem videoDesc='视频描述' prompt=提示词内容 track='分组' duration='视频推荐时间' associateAssetsIds='[该分镜所需的资产ID列表]'></storyboardItem>",
  //         "```",
  //       ].join("\n");

  //     return runAgent({
  //       prompt,
  //       system: systemPrompt + addPrompt,
  //       name: "执行导演",
  //       memoryKey: "assistant:execution",
  //       messages: [
  //         { role: "assistant", content: artSkills.prompt + `\n${modelInfo}` },
  //         { role: "user", content: prompt + addPrompt },
  //       ],
  //       tools: { ...artSkills.tools },
  //     });
  //   },
  // });

  //衍生资产分析与信息写入
  const run_sub_agent_derive_assets = tool({
    description: "运行执行subAgent来完成衍生资产分析与信息写入相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "production_execution_derive_assets.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");
      return runAgent({
        key: "productionAgent:deriveAssetsAgent",
        prompt,
        system: systemPrompt,
        name: "执行导演",
        memoryKey: "assistant:execution",
        messages: [
          { role: "assistant", content: artSkills.prompt + `\n${modelInfo}` },
          { role: "user", content: prompt },
        ],
        tools: { activate_skill: artSkills.tools.activate_skill },
      });
    },
  });

  //衍生资产图片生成
  const run_sub_agent_generate_assets = tool({
    description: "运行执行subAgent来完成衍生资产图片生成相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "production_execution_generate_assets.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");
      return runAgent({
        key: "productionAgent:generateAssetsAgent",
        prompt,
        system: systemPrompt,
        name: "执行导演",
        memoryKey: "assistant:execution",
        messages: [
          { role: "assistant", content: artSkills.prompt + `\n${modelInfo}` },
          { role: "user", content: prompt },
        ],
        tools: { activate_skill: artSkills.tools.activate_skill },
      });
    },
  });

  //拍摄计划
  const run_sub_agent_director_plan = tool({
    description: "运行执行subAgent来完成导演规划相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "production_execution_director_plan.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");

      const addPrompt = "\n你必须使用如下XML格式写入工作区：\n```\n<scriptPlan>内容</scriptPlan>\n```";

      return runAgent({
        key: "productionAgent:directorPlanAgent",
        prompt,
        system: systemPrompt + addPrompt,
        name: "执行导演",
        memoryKey: "assistant:execution",
        messages: [
          { role: "assistant", content: artSkills.prompt + `\n${modelInfo}` },
          { role: "user", content: prompt + addPrompt },
        ],
        tools: { activate_skill: artSkills.tools.activate_skill },
      });
    },
  });

  // const mainSkills: { path: string; name: string; description: string }[] = [];
  // for (const skill of mainSkill) {
  //   const skillPath = path.join(rootDir, skill + ".md");
  //   if (!fs.existsSync(skillPath)) throw new Error(`主技能文件不存在: ${skillPath}`);
  //   if (!isPathInside(skillPath, normalizedRootDir)) throw new Error(`技能名称无效：检测到路径穿越。${skillPath}`);
  //   const content = await fs.promises.readFile(skillPath, "utf-8");
  //   const parsed = parseFrontmatter(content);
  //   mainSkills.push({ path: skillPath, ...parsed });
  // }

  const productionSkills = await useProductionSkills(projectInfo?.artStyle!, projectInfo?.directorManual!);

  async function runStoryboardPanelAgent(prompt: string) {
    const skill = path.join(u.getPath("skills"), "production_execution_storyboard_panel.md");
    const systemPrompt = await fs.promises.readFile(skill, "utf-8");
    const stagePrompt = `写入模式：${storyboardWriteMode}\n${prompt}`;

    return runAgent({
      key: "productionAgent:storyboardPanelAgent",
      prompt: stagePrompt,
      system: systemPrompt,
      name: "执行导演",
      memoryKey: "assistant:execution",
      messages: [
        { role: "assistant", content: productionSkills.prompt + `\n${modelInfo}` },
        { role: "user", content: stagePrompt },
      ],
      tools: { activate_skill: productionSkills.tools.activate_skill },
    });
  }

  async function ensureStoryboardPanelReady(userPrompt: string) {
    const snapshot = await getProductionStageSnapshot(resTool.data.projectId, resTool.data.scriptId);
    if (!snapshot.hasStoryboardTable || snapshot.storyboardCount > 0) return;

    await runStoryboardPanelAgent(
      [
        "当前分镜表已存在，但分镜面板为空。",
        "请严格依据当前工作区里的现有分镜表写入分镜面板。",
        "不要重写导演计划，不要重写分镜表。",
        "完成分镜面板写入后即可结束本轮子任务。",
        `用户当前目标：${userPrompt}`,
      ].join("\n"),
    );

    const refreshedSnapshot = await getProductionStageSnapshot(resTool.data.projectId, resTool.data.scriptId);
    if (refreshedSnapshot.storyboardCount <= 0) {
      throw new Error("分镜面板补齐失败，当前仍没有可用的分镜数据");
    }
  }

  //分镜图生成
  const run_sub_agent_storyboard_gen = tool({
    description: "运行执行subAgent来完成分镜图生成相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      await ensureStoryboardPanelReady(prompt);
      const skill = path.join(u.getPath("skills"), "production_execution_storyboard_gen.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");
      return runAgent({
        key: "productionAgent:storyboardGenAgent",
        prompt,
        system: systemPrompt,
        name: "执行导演",
        memoryKey: "assistant:execution",
        messages: [
          { role: "assistant", content: artSkills.prompt + `\n${modelInfo}` },
          { role: "user", content: prompt },
        ],
        tools: { activate_skill: artSkills.tools.activate_skill },
      });
    },
  });

  //分镜面板写入
  const run_sub_agent_storyboard_panel = tool({
    description: "运行执行subAgent来完成分镜面板写入相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => runStoryboardPanelAgent(prompt),
  });

  //分镜表写入
  const run_sub_agent_storyboard_table = tool({
    description: "运行执行subAgent来完成分镜表构建相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "production_execution_storyboard_table.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");

      const addPrompt = "\n你必须使用如下XML格式写入工作区：\n```\n<storyboardTable>内容</storyboardTable>\n```";

      return runAgent({
        key: "productionAgent:storyboardTableAgent",
        prompt,
        system: systemPrompt + addPrompt,
        name: "执行导演",
        memoryKey: "assistant:execution",
        messages: [
          { role: "assistant", content: productionSkills.prompt + `\n${modelInfo}` },
          { role: "user", content: prompt + addPrompt },
        ],
        tools: { activate_skill: productionSkills.tools.activate_skill },
      });
    },
  });

  const run_sub_agent_supervision = tool({
    description: "运行监督层subAgent执行独立任务，完成后返回结果",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "production_agent_supervision.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");
      const normalizedPrompt = normalizeProductionSupervisionPrompt(prompt);
      return runAgent({
        key: "productionAgent:supervisionAgent",
        prompt: normalizedPrompt,
        system: systemPrompt,
        name: "监制",
        memoryKey: "assistant:supervision",
        includeDefaultTools: false,
        tools: readOnlyTools,
      });
    },
  });

  return {
    run_sub_agent_derive_assets,
    run_sub_agent_generate_assets,
    run_sub_agent_director_plan,
    run_sub_agent_storyboard_gen,
    run_sub_agent_storyboard_panel,
    run_sub_agent_storyboard_table,
    run_sub_agent_supervision,
  };
}

async function createArtSkills(artName: string, storyName: string) {
  const artWorkerPath = u.getPath(["skills", "art_skills", artName, "driector_skills"]);
  const storySkillPaths = getDirectorSkillPaths(storyName);
  const storySkillGroups = await Promise.all(storySkillPaths.map(async (skillPath) => await scanSkills(skillPath + "/*.md")));
  const skillList = [...(await scanSkills(artWorkerPath + "/*.md")), ...storySkillGroups.flat()];
  const mainSkills: { path: string; name: string; description: string }[] = [];
  for (const skillPath of skillList) {
    if (!fs.existsSync(skillPath)) throw new Error(`主技能文件不存在: ${skillPath}`);
    const content = await fs.promises.readFile(skillPath, "utf-8");
    const parsed = parseFrontmatter(content);
    mainSkills.push({ path: skillPath, ...parsed });
  }
  const res = {
    prompt: `## Skills
以下技能提供了专业任务的专用指令。
当任务与某个技能的描述匹配时，调用 activate_skill 工具并传入技能名称来加载完整指令。
${buildSkillPrompt(mainSkills)}`,
    tools: createSkillTools(mainSkills, { mainSkill: mainSkills, secondarySkills: [], tertiarySkills: [] }),
  };
  return res;
}
async function consumeFullStream(
  fullStream: AsyncIterable<any>,
  initialMsg: ReturnType<ResTool["newMessage"]>,
  syncMsg?: () => ReturnType<ResTool["newMessage"]>,
): Promise<string> {
  let msg = initialMsg;
  let text = msg.text();
  let thinking: ReturnType<typeof msg.thinking> | null = null;
  let thinkTime = 0;
  let fullResponse = "";

  try {
    for await (const chunk of fullStream) {
      if (syncMsg) {
        const newMsg = syncMsg();
        if (newMsg !== msg) {
          msg = newMsg;
          text = msg.text();
        }
      }
      if (chunk.type === "reasoning-start") {
        thinkTime = Date.now();
        thinking = msg.thinking("思考中...");
      } else if (chunk.type === "reasoning-delta") {
        thinking?.append(chunk.text);
      } else if (chunk.type === "reasoning-end") {
        thinkTime = Date.now() - thinkTime;
        thinking?.updateTitle(`思考完毕（${(thinkTime / 1000).toFixed(1)} 秒）`);
        thinking?.complete();
        thinking = null;
      } else if (chunk.type === "text-delta") {
        text.append(chunk.text);
        fullResponse += chunk.text;
      } else if (chunk.type === "error") {
        throw chunk.error;
      } else if (chunk.type == "finish") {
        break;
      }
    }
    text.complete();
    msg.complete();
  } catch (err: any) {
    thinking?.complete();
    const errMsg = err?.message ?? String(err);
    text.append(errMsg);
    text.error();
    msg.error();
    throw err;
  }

  return fullResponse;
}
function removeAllXmlTags(text: string): string {
  text = text.replace(/<([a-zA-Z][\w-]*)(\s+[^>]*)?>([\s\S]*?)<\/\1>/g, "");
  text = text.replace(/<([a-zA-Z][\w-]*)(\s+[^>]*)?\/>/g, "");
  text = text.replace(/<\/?[a-zA-Z][\w-]*(\s+[^>]*)?>/g, "");
  return text.trim();
}

export function buildSkillPrompt(skills: { name: string; description: string }[]): string {
  const skillEntries = skills
    .map((s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`)
    .join("\n");
  return `
<available_skills>
${skillEntries}
</available_skills>`;
}

async function useProductionSkills(artName: string, storyName: string) {
  const artWorkerPath = u.getPath(["skills", "art_skills", artName, "driector_skills"]);
  const productionPath = u.getPath(["skills", "production_skills"]);
  const storySkillPaths = getDirectorSkillPaths(storyName);
  const storySkillGroups = await Promise.all(storySkillPaths.map(async (skillPath) => await scanSkills(skillPath + "/*.md")));
  const skillList = [
    ...(await scanSkills(artWorkerPath + "/*.md")),
    ...storySkillGroups.flat(),
    ...(await scanSkills(productionPath + "/*.md")),
  ];
  const mainSkills: { path: string; name: string; description: string }[] = [];
  for (const skillPath of skillList) {
    if (!fs.existsSync(skillPath)) throw new Error(`主技能文件不存在: ${skillPath}`);
    const content = await fs.promises.readFile(skillPath, "utf-8");
    const parsed = parseFrontmatter(content);
    mainSkills.push({ path: skillPath, ...parsed });
  }
  const res = {
    prompt: `## Skills
以下技能提供了专业任务的专用指令。
当任务与某个技能的描述匹配时，调用 activate_skill 工具并传入技能名称来加载完整指令。
${buildSkillPrompt(mainSkills)}`,
    tools: createSkillTools(mainSkills, { mainSkill: mainSkills, secondarySkills: [], tertiarySkills: [] }),
  };
  return res;
}
