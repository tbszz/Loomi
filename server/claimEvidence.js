const ACTIVE_STATUSES = new Set(['verified', 'user_asserted']);
const SECTION_TYPES = {name:['identity'],contact:['contact'],education:['education'],skills:['skill','project','experience'],projects:['project'],experience:['experience'],awards:['achievement']};

// Grounding supports faithful editorial transformations rather than a similarity
// score: equivalent verbs, whitespace/punctuation changes, supported clause
// reordering and deletion. New propositions must first become sourced facts.
function canonical(text) {
  return String(text || '').toLowerCase()
    .replace(/(?<=[a-z0-9])[\s，,；;。：:、]+(?=[a-z0-9])/gu, '\u0001')
    .replace(/构建|搭建|编写/g,'开发').replace(/采用|基于|运用/g,'使用')
    .replace(/功能实现/g,'实现功能').replace(/[\s，,；;。：:、]/gu,'');
}

export function factualClaims(content = {}) {
  const claims = [];
  const add = (field,value) => { if (typeof value === 'string' && value.trim()) claims.push({field,claimText:value.trim()}); };
  add('name',content.name);
  add('summary',content.summary);
  for (const [key,value] of Object.entries(content.contact || {})) add(`contact.${key}`,value);
  for (const section of ['education','skills','projects','experience','awards','links']) {
    for (const [index,value] of (Array.isArray(content[section]) ? content[section] : []).entries()) add(`${section}.${index}`,value);
  }
  return claims;
}

function clauses(text) {
  return String(text).split(/[，,；;。：\n]/u).map(value=>value.trim()).filter(Boolean);
}

function factSupports(text,fact,field) {
  if (!ACTIVE_STATUSES.has(fact.status)) return false;
  const types=SECTION_TYPES[field.split('.')[0]];
  if (types && !types.includes(fact.type)) return false;
  const source = String(fact.sourceQuote || fact.value || '');
  const needle=canonical(text);
  const haystack=canonical(source);
  if (!needle) return false;
  let from=0;
  while (from <= haystack.length - needle.length) {
    const at=haystack.indexOf(needle,from);
    if (at<0) return false;
    const before=haystack.slice(Math.max(0,at-12),at);
    const after=haystack[at+needle.length] || '';
    const first=needle[0], last=needle.at(-1);
    const boundary=(!/[a-z0-9]/.test(first) || !/[a-z0-9]/.test(haystack[at-1] || '')) && (!/[a-z0-9]/.test(last) || !/[a-z0-9]/.test(after));
    const negated=/(?:没有|尚未|未|不会|不)(?:使用|掌握|熟悉|参与|负责)?$/.test(before);
    if(boundary && !negated) return true;
    from=at+1;
  }
  return false;
}

export function buildClaimEvidence(content,evidencePack = {}) {
  const facts=Array.isArray(evidencePack) ? evidencePack : evidencePack.facts || [];
  const claims=factualClaims(content).map(claim=>{
    const ids=new Set();
    for (const clause of clauses(claim.claimText)) {
      const supported=facts.filter(fact=>factSupports(clause,fact,claim.field));
      if (!supported.length) throw new Error(`简历事实缺少有效证据（${claim.field}）：${clause}`);
      for (const fact of supported) ids.add(fact.factId || fact.id);
    }
    if (!ids.size || ids.has(undefined)) throw new Error(`简历事实缺少证据ID：${claim.field}`);
    return {...claim,factIds:[...ids]};
  });
  verifyClaimEvidence(content,claims,facts);
  return claims;
}

export function verifyClaimEvidence(content,claims,facts) {
  const expected=factualClaims(content);
  if(!expected.length) throw new Error('简历缺少可核验的事实内容。');
  const actual=Array.isArray(claims) ? claims : [];
  const active=new Map((facts || []).filter(f=>ACTIVE_STATUSES.has(f.status)).map(f=>[f.factId || f.id,f]));
  if (actual.length !== expected.length) throw new Error('简历事实证据覆盖不完整。');
  for (const claim of expected) {
    const link=actual.find(item=>item.field===claim.field && item.claimText===claim.claimText);
    if (!link || !Array.isArray(link.factIds) || !link.factIds.length) throw new Error(`简历事实缺少证据：${claim.field}`);
    const linked=link.factIds.map(id=>active.get(id));
    if (linked.some(f=>!f)) throw new Error(`简历事实引用不存在、非当前求职者或已失效证据：${claim.field}`);
    for (const clause of clauses(claim.claimText)) {
      if (!linked.some(f=>factSupports(clause,f,claim.field))) throw new Error(`简历事实未获来源证据支持：${claim.field} ${clause}`);
    }
  }
  return true;
}
