# Codex consumes enabled product Project Skills

Status: resolved
Type: task
Blocked by:

## Spec

Story 2: each Project keeps its own Agent workspace and Skill. Pi already injects `listSkills` into the system prompt. Codex adapter must consume the same product skills. Out of scope: hosting the nine node Skills.

## Work

Before `thread/start` or `thread/resume`, write enabled skills from `store.listSkills` to `workspace/.agents/skills/<safe-name>/SKILL.md`. Rebuild that directory each turn so disabled skills disappear. Do not write `AGENTS.md`.

## Test

`saveSkill` enabled → runTurn → file exists with definition. Disabled skill is not written.

## Answer

Enabled skills are written to `workspace/.agents/skills/<name>/SKILL.md` each turn, serialized per runtime. Covered by “启用的 Project Skill 写入 Codex workspace，停用的不写”.

