import { readFileSync } from 'node:fs';

// One audited resource owns template styles and default section order.
const templates = JSON.parse(readFileSync(new URL('./resume_layouts.json', import.meta.url), 'utf8')).templates;
// Layout changes presentation only. All confirmed sections and strings survive.
export const RESUME_TEMPLATES = ['auto', ...Object.keys(templates)];
export const RESUME_SECTIONS = ['education', 'skills', 'projects', 'experience', 'awards'];
const orders = Object.fromEntries(Object.entries(templates).map(([key, value]) => [key, value.sectionOrder]));

export function resolveResumeLayout(resume, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('无效的简历布局。');
  const requested = options.template ?? 'auto';
  if (!RESUME_TEMPLATES.includes(requested)) throw new Error('不支持的简历模板。');
  const order = options.sectionOrder;
  if (order !== undefined && (!Array.isArray(order) || order.length > 5 || new Set(order).size !== order.length || order.some(key => !RESUME_SECTIONS.includes(key)))) throw new Error('无效的简历模块顺序。');
  const count = key => (resume?.[key] || []).filter(Boolean).join('').length;
  const total = RESUME_SECTIONS.reduce((sum, key) => sum + count(key), 0) + String(resume?.summary || '').length;
  const template = requested === 'auto'
    ? total < 450 ? 'minimal' : count('experience') > count('projects') ? 'experienced' : 'campus-project'
    : requested;
  return { template, sectionOrder: order ? [...order, ...orders[template].filter(key => !order.includes(key))] : [...orders[template]] };
}

export function resumeLayoutQuery(layout) {
  return new URLSearchParams({ template: layout.template, sectionOrder: layout.sectionOrder.join(',') }).toString();
}
