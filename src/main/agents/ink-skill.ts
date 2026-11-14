import INK_SKILL from './ink-skill.md?raw'

export { INK_SKILL }

/**
 * What a chat's agent gets on top of its own system prompt: Ink's own skill, always,
 * then any skills the person enabled from outside Ink. Ink's comes first, and its rules
 * hold whatever the others say.
 */
export function sessionSkills(external: string | null): string {
  return external ? `${INK_SKILL.trim()}\n\n---\n\n${external}` : INK_SKILL.trim()
}
