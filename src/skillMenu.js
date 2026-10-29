// Slash completion applies only to the first token while the cursor edits it.
export function skillCommandQuery(text, cursor = text.length) {
  const token = text.match(/^\/([^\s]*)/);
  if (!token || !/^[\p{L}\p{N}_-]*$/u.test(token[1]) || cursor < 1 || cursor > token[0].length) return null;
  return token[1].toLocaleLowerCase();
}

export function filterSkills(skills, query) {
  return skills.filter(skill => [skill.name, skill.label, skill.description].some(value => String(value || '').toLocaleLowerCase().includes(query)));
}

export function insertSkillCommand(text, name) {
  return `/${name} ${text.replace(/^\/[^\s]*\s*/, '')}`;
}
