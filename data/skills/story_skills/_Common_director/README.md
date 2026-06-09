# 通用型导演技法 · 基础层

## 定位

本技能包是 `story_skills` 的**内部共享基础层**，用于给所有题材导演技法提供统一的底层约束。

- 不作为前端可选题材展示
- 不单独写入项目 `directorManual`
- 自动叠加在当前题材导演技法之上

## 文件结构

```
_Common_director/
├── README.md
└── driector_skills/
    ├── director_planning_foundation.md
    └── director_storyboard_table_foundation.md
```

## 作用范围

- `director_planning_foundation`：约束导演规划阶段的保真、节奏、台词与声音规则
- `director_storyboard_table_foundation`：约束分镜表阶段的拆解、连续性、站位和动作链规则

## 边界

- 不负责题材风格化表达，题材气质仍由当前 `directorManual` 决定
- 不负责光影、色调、质感规划，这些继续由场景资产和视频模型承担
- 不负责 Seedance 2.0 成文格式，Seedance 专属表达仅在最终视频 prompt 层处理
