export type StoryboardPanelWriteMode = "纯文本多参模式" | "首位帧模式";

export function isSeedance20Model(modelName: string) {
  return /seedance.*2[.\-]0/i.test(modelName);
}

export function isOmniFlashModel(modelName: string) {
  return /omni[\s_-]*flash/i.test(modelName);
}

export function getVideoModelPromptFamily(modelName: string) {
  if (isSeedance20Model(modelName)) return "Seedance 2.0 多参模式";
  if (isOmniFlashModel(modelName)) return "Omni Flash 多参模式";
  return "首位帧/故事板模型";
}

export function resolveStoryboardPanelWriteMode(modelName: string): StoryboardPanelWriteMode {
  return isSeedance20Model(modelName) || isOmniFlashModel(modelName) ? "纯文本多参模式" : "首位帧模式";
}
