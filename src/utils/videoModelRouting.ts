export type StoryboardPanelWriteMode = "纯文本多参模式" | "首位帧模式";

export function isSeedance20Model(modelName: string) {
  return /seedance.*2[.\-]0/i.test(modelName);
}

export function resolveStoryboardPanelWriteMode(modelName: string): StoryboardPanelWriteMode {
  return isSeedance20Model(modelName) ? "纯文本多参模式" : "首位帧模式";
}
