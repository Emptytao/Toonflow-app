# Production Video Prompt Style API

本文档整理本次后端新增的 `promptStyle` 能力，供前端对接工作台与工作流相关页面时使用。

## 1. 新增枚举

统一枚举值：

```ts
type PromptStyle = "general" | "high_energy" | "lyrical";
```

语义说明：

- `general`：通用润色
- `high_energy`：高能戏剧化
- `lyrical`：慢节奏细腻质感

默认值：

- 后端默认值固定为 `general`
- 老数据没有该字段时，查询接口会自动回退成 `general`

---

## 2. 单条生成提示词

接口文件：
[generateVideoPrompt.ts](/Users/tao/Documents/code/Toonflow-app/src/routes/production/workbench/generateVideoPrompt.ts:1)

请求体新增字段：

```json
{
  "trackId": 123,
  "projectId": 1,
  "info": [
    { "id": 1001, "sources": "storyboard" },
    { "id": 2001, "sources": "assets" }
  ],
  "model": "vendor:model",
  "mode": "text",
  "promptStyle": "general"
}
```

字段说明：

- `promptStyle`：可选，未传时后端按 `general` 处理

返回体新增字段：

```json
{
  "success": true,
  "data": {
    "prompt": "最终视频提示词",
    "bgmSuggestion": "BGM 建议",
    "aiTrace": {
      "promptStyle": "general",
      "styleSkillName": "单视频提示词润色",
      "systemLayers": ["template", "visualManual", "styleSkill"]
    },
    "promptStyle": "general"
  }
}
```

---

## 3. 批量生成提示词

接口文件：
[batchGeneratePrompt.ts](/Users/tao/Documents/code/Toonflow-app/src/routes/production/workbench/batchGeneratePrompt.ts:1)

请求体新增字段：

```json
{
  "projectId": 1,
  "trackData": [
    {
      "trackId": 123,
      "info": [
        { "id": 1001, "sources": "storyboard" }
      ]
    }
  ],
  "model": "vendor:model",
  "mode": "text",
  "promptStyle": "high_energy",
  "concurrentCount": 5
}
```

说明：

- `promptStyle` 为整批统一值
- 当前后端不支持逐轨不同风格

返回体不变，仍是：

```json
{
  "success": true,
  "data": "开始生成提示词"
}
```

后续通过查询接口读取各轨道状态与 `promptStyle`。

---

## 4. 工作台生成数据查询

接口文件：
[getGenerateData.ts](/Users/tao/Documents/code/Toonflow-app/src/routes/production/workbench/getGenerateData.ts:1)

请求体：

```json
{
  "projectId": 1,
  "scriptId": 10
}
```

返回体新增两部分：

### 4.1 `trackList[].promptStyle`

每条轨道新增：

```json
{
  "id": 123,
  "prompt": "",
  "bgmSuggestion": "",
  "promptStyle": "general",
  "aiTrace": null,
  "state": "未生成"
}
```

### 4.2 `promptStyleOptions`

返回体顶层新增：

```json
{
  "success": true,
  "data": {
    "storyboardList": [],
    "trackList": [],
    "promptStyleOptions": [
      { "value": "general", "label": "通用润色" },
      { "value": "high_energy", "label": "高能戏剧化" },
      { "value": "lyrical", "label": "慢节奏细腻质感" }
    ]
  }
}
```

前端建议：

- 下拉选项优先使用后端返回的 `promptStyleOptions`
- 不要在前端硬编码中文名

---

## 5. 提示词状态轮询

接口文件：
[checkVideoPrompt.ts](/Users/tao/Documents/code/Toonflow-app/src/routes/production/workbench/checkVideoPrompt.ts:1)

请求体：

```json
{
  "projectId": 1,
  "scriptId": 10,
  "trackIds": [123, 124]
}
```

返回项新增：

```json
[
  {
    "id": 123,
    "state": "已完成",
    "reason": "",
    "prompt": "最终提示词",
    "bgmSuggestion": "BGM 建议",
    "promptStyle": "lyrical",
    "aiTrace": {
      "promptStyle": "lyrical",
      "styleSkillName": "慢节奏细腻质感润色"
    }
  }
]
```

---

## 6. 手动更新提示词

接口文件：
[updateVideoPrompt.ts](/Users/tao/Documents/code/Toonflow-app/src/routes/production/workbench/updateVideoPrompt.ts:1)

请求体新增：

```json
{
  "id": 123,
  "prompt": "人工修改后的 prompt",
  "bgmSuggestion": "人工修改后的建议",
  "promptStyle": "high_energy"
}
```

说明：

- `promptStyle` 可单独传，也可与 `prompt` / `bgmSuggestion` 一起传
- 用于前端人工编辑后保留“最后使用的风格记录”

---

## 7. 轨道默认值与回显约定

相关文件：

- [addTrack.ts](/Users/tao/Documents/code/Toonflow-app/src/routes/production/workbench/addTrack.ts:1)
- [addStoryboard.ts](/Users/tao/Documents/code/Toonflow-app/src/routes/production/storyboard/addStoryboard.ts:1)
- [batchAddStoryboardInfo.ts](/Users/tao/Documents/code/Toonflow-app/src/routes/production/storyboard/batchAddStoryboardInfo.ts:1)

约定如下：

- 新建轨道时，后端默认写入 `promptStyle: "general"`
- 即使旧轨道数据库里没有 `promptStyle` 字段值，查询接口也会回退成 `general`

---

## 8. 工作流节点对接说明

相关文件：
[productionCanvasV2.ts](/Users/tao/Documents/code/Toonflow-app/src/lib/productionCanvasV2.ts:85)

工作流视频节点新增字段：

```ts
interface VideoNodeDataV2 {
  promptStyle: "general" | "high_energy" | "lyrical";
}
```

后端行为：

- 节点未配置时自动回退 `general`
- 节点生成 prompt 时，和 workbench 共用同一套后端组合逻辑

前端建议：

- 视频节点表单中增加 `promptStyle` 选择器
- 新建节点默认值设为 `general`

---

## 9. 前端最小开发清单

- 工作台单条生成请求增加 `promptStyle`
- 工作台批量生成请求增加整批 `promptStyle`
- 轨道卡片展示当前 `promptStyle`
- 提示词编辑弹窗保存时支持回写 `promptStyle`
- 查询接口读取 `promptStyleOptions` 生成下拉项
- 工作流视频节点增加 `promptStyle` 字段与默认值
