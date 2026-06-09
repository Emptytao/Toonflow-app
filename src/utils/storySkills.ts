import getPath from "@/utils/getPath";

export const COMMON_DIRECTOR_MANUAL = "_Common_director";
export const DIRECTOR_SKILLS_DIR_NAME = "driector_skills";

export function isReservedDirectorManual(name: string): boolean {
  return name === COMMON_DIRECTOR_MANUAL;
}

export function getStorySkillsRootPath() {
  return getPath(["skills", "story_skills"]);
}

export function getDirectorManualPath(directorManual: string) {
  return getPath(["skills", "story_skills", directorManual]);
}

export function getDirectorSkillPaths(directorManual: string) {
  const paths = [getPath(["skills", "story_skills", COMMON_DIRECTOR_MANUAL, DIRECTOR_SKILLS_DIR_NAME])];
  if (directorManual && directorManual !== COMMON_DIRECTOR_MANUAL) {
    paths.push(getPath(["skills", "story_skills", directorManual, DIRECTOR_SKILLS_DIR_NAME]));
  }
  return paths;
}
