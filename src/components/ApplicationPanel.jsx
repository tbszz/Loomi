import React, { useEffect, useRef, useState } from 'react';
import { requestJson } from '../api.js';
import { Crossfade, MotionDetails, MotionRecord } from '../motionHooks.jsx';
import './applicationPanel.css';

const PROFILE_FIELDS = [
  ['name', '姓名'], ['phone', '手机号'], ['email', '邮箱'],
  ['identityNumber', '身份证号码', true], ['address', '通讯地址', true],
  ['householdRegistration', '户籍', true], ['birthDate', '出生日期', true],
  ['ethnicity', '民族', true], ['politicalStatus', '政治面貌', true],
  ['nationality', '国籍'], ['gender', '性别'], ['degree', '最高学历'],
  ['expectedSalary', '期望薪资'], ['availableDate', '可到岗日期'],
  ['preferredLocation', '意向城市'], ['leaveReason', '离职原因'], ['website', '作品链接'],
  ['nativePlace', '籍贯', true], ['studentNumber', '学号', true], ['degreeName', '学位'],
  ['preferredRoleCategory', '意向岗位大类'], ['preferredRoles', '意向岗位'], ['preferredTeams', '意向团队'],
  ['languages', '语言特长'], ['recruitmentChannel', '获知招聘的渠道'], ['referralCode', '内推码']
];
const BOOLEAN_FIELDS = [['willingToRelocate','接受异地工作'],['acceptRoleAdjustment','接受岗位调剂'],['referred','是否内推'],['hasAwards','是否有获奖经历'],['hasCampusLeadership','是否有社团干部经历'],['hasInternship','是否有实习经历']];
const MULTI_FIELDS = new Set(['preferredRoles','preferredTeams','preferredLocation','languages']);
const RECORDS = [
  ['education', '教育经历', [['school','学校'],['major','专业'],['degree','学历'],['startDate','入学日期'],['endDate','毕业日期'],['ranking','成绩排名'],['description','说明']]],
  ['employment', '工作与实习', [['company','公司'],['title','职位'],['startDate','开始日期'],['endDate','结束日期'],['description','真实职责']]],
  ['projects', '项目经历', [['name','项目名称'],['role','个人角色'],['startDate','开始日期'],['endDate','结束日期'],['description','真实项目描述']]],
  ['awards', '获奖经历', [['type','获奖类型'],['level','奖项级别'],['name','奖项名称'],['date','获奖日期']]],
  ['campusLeadership', '社团干部经历', [['organization','社团名称'],['title','职位'],['startDate','开始日期'],['endDate','结束日期'],['description','真实职责']]]
];
const RESULT_LABELS = { filled: '已填写', preserved: '保留已有内容', missing: '资料缺失', missing_evidence: '缺少事实依据', unsupported: '需手动填写', manual_required: '需本人操作', failed: '填写失败', changed: '字段已变化', attachment_uploaded: '网站已接收原文件', attachment_selected: '已选择原文件，待确认网站接收', attachment_required: '请明确选择附件或手动上传', attachment_mismatch: '附件格式不符合网页要求', attachment_too_large: '附件超过网页限制', too_large: '附件超过网页限制', no_match: '网页没有对应选项', options_unavailable: '选项尚未加载或联动条件未满足', too_long: '超出字数限制' };

export function ApplicationPanel({ conversation, disabled = false }) {
  const [profile, setProfile] = useState({});
  const [patch, setPatch] = useState({});
  const [status, setStatus] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [url, setUrl] = useState('');
  const [scan, setScan] = useState(null);
  const [result, setResult] = useState(null);
  const [rowsResult, setRowsResult] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [attachmentSelections, setAttachmentSelections] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeButton, setActiveButton] = useState(null);
  const recordIds = useRef(new WeakMap());
  const nextRecordId = useRef(0);
  function recordKey(record) {
    if (!recordIds.current.has(record)) recordIds.current.set(record, ++nextRecordId.current);
    return recordIds.current.get(record);
  }
  const controller = useRef(null);
  const base = `/api/conversations/${encodeURIComponent(conversation.id)}/application`;
  const locked = busy || disabled;
  const request = (route, body, signal) => requestJson(base + route, { signal, timeoutMs: 120000, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });

  useEffect(() => {
    const initial = new AbortController();
    Promise.all([request('/profile', null, initial.signal), request('/status', null, initial.signal)])
      .then(([saved, current]) => { setProfile(saved.profile); setStatus(current); })
      .catch(error => { if (!initial.signal.aborted) setNotice(error.message); });
    return () => { initial.abort(); controller.current?.abort(); };
  }, [base]);

  async function act(work) {
    if (locked || controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setNotice('');
    try { await work(active.signal); }
    catch (error) { if (!active.signal.aborted) setNotice(error.message); }
    finally { if (controller.current === active) { controller.current = null; setBusy(false); } }
  }
  function change(name, value) { setPatch(current => ({ ...current, [name]: value })); }
  function recordChange(family, index, field, value) {
    const records = [...(patch[family] ?? profile[family] ?? [])];
    const previous = records[index];
    records[index] = { ...previous, [field]: value };
    recordIds.current.set(records[index], recordKey(previous));
    change(family, records);
  }
  async function refreshTabs(signal) { const data = await request('/tabs', null, signal); setTabs(data.tabs); }
  function resetPage() { setScan(null); setResult(null); setRowsResult(null); setDocuments([]); setAttachmentSelections({}); }
  async function scanPage(signal) {
    resetPage();
    const [current, available] = await Promise.all([request('/scan', {}, signal), request('/attachments', null, signal)]);
    if (signal.aborted) return;
    setScan(current); setDocuments(available.documents);
  }

  return <section className="application-panel" data-connected={Boolean(status?.connected)} aria-label="网申填表" onClickCapture={event => setActiveButton(event.target.closest('button'))} onSubmitCapture={event => setActiveButton(event.nativeEvent.submitter)}>
    <div className="application-rule"><strong>只填空白，已有内容保留</strong><p>你需要时再开始。最后检查和提交由你完成；网页可能在填写时自动保存资料。</p></div>
    {notice && <p role="alert">{notice}</p>}
    <MotionDetails className="application-profile">
      <summary>本地申请资料</summary>
      <p>敏感资料加密保存在本机，不作为聊天内容发送给模型。未改动的字段保持原值；日期请用 YYYY-MM-DD，出生年月可用 YYYY-MM。多选资料每行写一个网页中的完整选项。</p>
      <form onSubmit={event => { event.preventDefault(); act(async signal => { const normalized = Object.fromEntries(Object.entries(patch).map(([key,value]) => [key, MULTI_FIELDS.has(key) && Array.isArray(value) ? value.map(item => item.trim()).filter(Boolean) : value])); const saved = await request('/profile', { profile: normalized }, signal); setProfile(saved.profile); setPatch({}); setNotice('本地申请资料已保存。'); }); }}>
        <fieldset disabled={locked}>
          {PROFILE_FIELDS.map(([name, label, sensitive]) => <label key={name}>{label}{MULTI_FIELDS.has(name) ? <textarea aria-label={label} maxLength={6000} value={Array.isArray(patch[name] ?? profile[name]) ? (patch[name] ?? profile[name]).join('\n') : patch[name] ?? profile[name] ?? ''} placeholder="每行一个完整选项，未知可留空" onChange={event => change(name, event.target.value.split('\n'))} /> : <input aria-label={label} type={sensitive ? 'password' : 'text'} autoComplete="off" maxLength={name === 'leaveReason' ? 2000 : 300} value={patch[name] ?? (sensitive ? '' : profile[name] ?? '')} placeholder={sensitive && profile.sensitiveConfigured?.includes(name) ? '已保存，留空保留' : '未知可留空'} onChange={event => change(name, event.target.value)} />}{sensitive && profile.sensitiveConfigured?.includes(name) && <ActionButton busy={busy} activeButton={activeButton} type="button" onClick={() => change(name, '')}>清除已保存的{label}</ActionButton>}</label>)}
          {BOOLEAN_FIELDS.map(([name,label]) => <label key={name}>{label}<select aria-label={label} value={Object.hasOwn(patch, name) ? patch[name] ?? '' : profile[name] ?? ''} onChange={event => change(name, event.target.value === '' ? null : event.target.value === 'true')}><option value="">未确定</option><option value="true">是</option><option value="false">否</option></select></label>)}
          {RECORDS.map(([family, label, fields]) => <MotionDetails key={family}><summary>{label}</summary>{(patch[family] ?? profile[family] ?? []).map((record, index) => <MotionRecord key={recordKey(record)} onRemove={() => setPatch(current => ({ ...current, [family]: (current[family] ?? profile[family] ?? []).filter(item => recordKey(item) !== recordKey(record)) }))}><legend>{label} {index + 1}</legend>{fields.map(([key, text]) => <label key={key}>{text}<input value={record[key] || ''} onChange={event => recordChange(family, index, key, event.target.value)} maxLength={4000} /></label>)}</MotionRecord>)}<ActionButton busy={busy} activeButton={activeButton} type="button" onClick={() => change(family, [...(patch[family] ?? profile[family] ?? []), {}])}>添加{label}</ActionButton></MotionDetails>)}
          <ActionButton busy={busy} activeButton={activeButton} type="submit" disabled={!Object.keys(patch).length}>保存本地资料</ActionButton>
        </fieldset>
      </form>
    </MotionDetails>
    <form onSubmit={event => { event.preventDefault(); act(async signal => { setStatus(await request('/start', { url }, signal)); await refreshTabs(signal); }); }}>
      <label>企业校招网页<input type="url" aria-label="企业校招网页" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" disabled={locked || status?.connected} /></label>
      <p>打开专用本机浏览器后，由你登录并进入申请页。不会连接其他正在使用的浏览器窗口。</p>
      {!status?.connected && <ActionButton busy={busy} activeButton={activeButton} type="submit" disabled={locked}>连接网页</ActionButton>}
    </form>
    {status?.connected && <>
      <p className="application-current">当前网页：{status.currentUrl || '请选择申请网页'}</p>
      <div className="application-actions"><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked} onClick={() => act(refreshTabs)}>刷新网页列表</ActionButton><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked} onClick={() => act(async signal => { setStatus(await request('/close', {}, signal)); setTabs([]); resetPage(); })}>断开浏览器</ActionButton></div>
      {tabs.length > 0 && <label>选择填写网页<select aria-label="选择填写网页" value={status.tabId || ''} disabled={locked} onChange={event => { const tabId = event.target.value; act(async signal => { setStatus(await request('/tab', { tabId }, signal)); resetPage(); }); }}>{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.url || '空白页'}</option>)}</select></label>}
      <div className="application-actions"><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked} onClick={() => act(scanPage)}>扫描当前表单</ActionButton><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked} onClick={() => act(async signal => { const expanded = await request('/rows', {}, signal); await scanPage(signal); setRowsResult(expanded); })}>补齐经历行</ActionButton><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked || !scan} onClick={() => act(async signal => { const attachments = Object.entries(attachmentSelections).filter(([, documentId]) => documentId).map(([fieldId, documentId]) => ({ fieldId, documentId })); setResult(await request('/fill', { scanId: scan.scanId, attachments }, signal)); setAttachmentSelections({}); })}>填写空白字段</ActionButton></div>
    </>}
    {busy && <p role="status">正在处理网申步骤…</p>}
    {rowsResult && <p role="status">新增 {rowsResult.added || 0} 行经历 · 待处理 {rowsResult.pending || 0} 行。按已保存的经历条数补齐，已有行保留。</p>}
    {result && <p role="status">已填写 {result.filled || 0} 项{result.uploadedAttachments > 0 && ` · 网站已接收 ${result.uploadedAttachments} 个附件`} · 保留 {result.preserved || 0} 项 · 待处理 {result.pending || 0} 项。{result.selectedAttachments > 0 && `其中 ${result.selectedAttachments} 项已选择原文件，需确认网站接收。`}尚未提交。</p>}
    {scan && <ul className="application-fields">{scan.fields.map((field, index) => {
      const state = result?.results.find(item => item.fieldId === field.id)?.status;
      return <li key={field.id} style={{ '--enter-delay': `calc(var(--stagger) * ${Math.min(index, 7)})` }}><span>{field.section ? `${field.section} · ` : ''}{field.label || '未命名字段'}</span><FieldState stateKey={state || `${field.occupied}-${field.unsupported}`}>{state ? RESULT_LABELS[state] || '需核对' : field.occupied ? '保留已有内容' : field.unsupported ? '需本人操作' : '空白'}</FieldState>{field.type === 'file' && !field.occupied && !field.unsupported && <label className="application-attachment">为{field.label || '未命名字段'}选择附件<select aria-label={`为${field.label || '未命名字段'}选择附件`} disabled={locked} value={attachmentSelections[field.id] || ''} onChange={event => { const documentId = event.target.value; setAttachmentSelections(current => ({ ...current, [field.id]: documentId })); }}><option value="">不上传，由我手动处理</option>{documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select><small>仅当前求职者的已上传原文件；点击“填写空白字段”才上传。{field.accept ? `网页要求：${field.accept}` : ''}</small></label>}</li>;
    })}</ul>}
    <p>附件由你逐项选择，未选就不上传；原文件可能包含敏感资料，网页可能立即接收。支持的下拉会展开核对选项；简道云日期和按已保存经历补齐行可自动处理。未支持的日期面板、级联选择与跨页导航由你操作。不确定的信息留空。</p>
  </section>;
}

function ActionButton({ busy, activeButton, children, ...props }) {
  const ref = useRef(null);
  const working = busy && activeButton === ref.current;
  return <button {...props} ref={ref} aria-busy={working || undefined}>{working && <span className="application-spinner" aria-hidden="true" />}{children}</button>;
}

function FieldState({ stateKey, children }) {
  return <small className="application-field-state"><Crossfade identity={stateKey}>{children}</Crossfade></small>;
}
