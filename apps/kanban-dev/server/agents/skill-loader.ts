import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Loads all SKILL.md files from an agent's skills/ directory
 * and concatenates them into a single prompt section.
 */
export function loadSkills(agentDir: string): string {
  const skillsDir = path.join(agentDir, 'skills');
  if (!fs.existsSync(skillsDir)) return '';

  const files = fs.readdirSync(skillsDir)
    .filter(f => f.endsWith('.md'))
    .sort();

  if (files.length === 0) return '';

  const sections = files.map(f => {
    const content = fs.readFileSync(path.join(skillsDir, f), 'utf8').trim();
    const name = f.replace('.md', '');
    return `## Skill: ${name}\n\n${content}`;
  });

  return '\n\n--- SKILLS ---\n\n' + sections.join('\n\n');
}
