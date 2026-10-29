import { uiMessage, resolveUiMessage } from '../i18n.js';
import { useI18n } from '../i18nContext.js';
import React, { useEffect, useRef, useState } from 'react';
import { requestJson } from '../api.js';
import { Crossfade, MotionDetails, MotionRecord } from '../motionHooks.jsx';
import './applicationPanel.css';

const MULTI_FIELDS = new Set(['preferredRoles','preferredTeams','preferredLocation','languages']);

export function ApplicationPanel({ conversation, disabled = false }) {
  const { t } = useI18n();
  const PROFILE_FIELDS = [
    ['name', t("workspace.name")], ['phone', t("application.phoneNumber")], ['email', t("login.email")],
    ['identityNumber', t("application.nationalIdNumber"), true], ['address', t("application.mailingAddress"), true],
    ['householdRegistration', t("application.householdRegistration"), true], ['birthDate', t("application.dateOfBirth"), true],
    ['ethnicity', t("application.ethnicity"), true], ['politicalStatus', t("application.politicalAffiliation"), true],
    ['nationality', t("application.nationality")], ['gender', t("application.gender")], ['degree', t("application.highestQualification")],
    ['expectedSalary', t("application.expectedSalary")], ['availableDate', t("application.availableStartDate")],
    ['preferredLocation', t("application.preferredCities")], ['leaveReason', t("application.reasonForLeaving")], ['website', t("application.portfolioUrl")],
    ['nativePlace', t("application.placeOfOrigin"), true], ['studentNumber', t("application.studentId"), true], ['degreeName', t("application.degreeName")],
    ['preferredRoleCategory', t("application.preferredRoleCategory")], ['preferredRoles', t("application.preferredRoles")], ['preferredTeams', t("application.preferredTeams")],
    ['languages', t("application.languages")], ['recruitmentChannel', t("application.recruitmentChannel")], ['referralCode', t("application.referralCode")]
  ];
  const BOOLEAN_FIELDS = [['willingToRelocate',t("application.willingToRelocate")],['acceptRoleAdjustment',t("application.acceptRoleReassignment")],['referred',t("application.referredBySomeone")],['hasAwards',t("application.haveAwards")],['hasCampusLeadership',t("application.haveCampusLeadershipExperience")],['hasInternship',t("application.haveInternshipExperience")]];
  const RECORDS = [
    ['education', t("resume.education"), [['school',t("application.school")],['major',t("application.major")],['degree',t("application.qualification")],['startDate',t("application.enrollmentDate")],['endDate',t("application.graduationDate")],['ranking',t("application.academicRanking")],['description',t("application.description")]]],
    ['employment', t("application.workInternships"), [['company',t("application.company")],['title',t("application.jobTitle")],['startDate',t("application.startDate")],['endDate',t("application.endDate")],['description',t("application.actualResponsibilities")]]],
    ['projects', t("resume.projects"), [['name',t("workspace.projectNameField")],['role',t("application.yourRole")],['startDate',t("application.startDate")],['endDate',t("application.endDate")],['description',t("application.actualProjectDescription")]]],
    ['awards', t("application.awards"), [['type',t("application.awardType")],['level',t("application.awardLevel")],['name',t("application.awardName")],['date',t("application.awardDate")]]],
    ['campusLeadership', t("application.campusLeadership"), [['organization',t("application.organizationName")],['title',t("application.jobTitle")],['startDate',t("application.startDate")],['endDate',t("application.endDate")],['description',t("application.actualResponsibilities")]]]
  ];
  const RESULT_LABELS = { filled: t("application.filled"), preserved: t("application.existingContentKept"), missing: t("application.missingInformation"), missing_evidence: t("application.missingFactualEvidence"), unsupported: t("application.fillManually"), manual_required: t("application.requiresYourAction"), failed: t("application.fillFailed"), changed: t("application.fieldChanged"), attachment_uploaded: t("application.websiteReceivedTheOriginalFile"), attachment_selected: t("application.originalFileSelectedConfirmWebsiteReceipt"), attachment_required: t("application.selectAnAttachmentExplicitlyOrUploadManually"), attachment_mismatch: t("application.attachmentFormatDoesNotMeetPageRequirements"), attachment_too_large: t("application.attachmentExceedsPageLimit"), too_large: t("application.attachmentExceedsPageLimit"), no_match: t("application.noMatchingOptionOnPage"), options_unavailable: t("application.optionsNotLoadedOrPrerequisitesNotMet"), too_long: t("application.characterLimitExceeded") };

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
  const [noticeValue, setNotice] = useState('');
  const notice = resolveUiMessage(noticeValue, t);
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
  const request = (route, body, signal) => requestJson(base + route, { signal, timeoutMs: 120000, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }, t);

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

  return <section className="application-panel" data-connected={Boolean(status?.connected)} aria-label={t("workspace.applicationFormLabel")} onClickCapture={event => setActiveButton(event.target.closest('button'))} onSubmitCapture={event => setActiveButton(event.nativeEvent.submitter)}>
    <div className="application-rule"><strong>{t("application.fillBlanksAndKeepExistingContent")}</strong><p>{t("application.startWhenYouNeedToYouReview")}</p></div>
    {notice && <p role="alert">{notice}</p>}
    <MotionDetails className="application-profile">
      <summary>{t("application.localApplicationProfile")}</summary>
      <p>{t("application.sensitiveInformationIsEncryptedOnThisComputer")}</p>
      <form onSubmit={event => { event.preventDefault(); act(async signal => { const normalized = Object.fromEntries(Object.entries(patch).map(([key,value]) => [key, MULTI_FIELDS.has(key) && Array.isArray(value) ? value.map(item => item.trim()).filter(Boolean) : value])); const saved = await request('/profile', { profile: normalized }, signal); setProfile(saved.profile); setPatch({}); setNotice(uiMessage("application.localApplicationProfileSaved")); }); }}>
        <fieldset disabled={locked}>
          {PROFILE_FIELDS.map(([name, label, sensitive]) => <label key={name}>{label}{MULTI_FIELDS.has(name) ? <textarea aria-label={label} maxLength={6000} value={Array.isArray(patch[name] ?? profile[name]) ? (patch[name] ?? profile[name]).join('\n') : patch[name] ?? profile[name] ?? ''} placeholder={t("application.oneCompleteOptionPerLineLeaveUnknown")} onChange={event => change(name, event.target.value.split('\n'))} /> : <input aria-label={label} type={sensitive ? 'password' : 'text'} autoComplete="off" maxLength={name === 'leaveReason' ? 2000 : 300} value={patch[name] ?? (sensitive ? '' : profile[name] ?? '')} placeholder={sensitive && profile.sensitiveConfigured?.includes(name) ? t("application.savedLeaveBlankToKeep") : t("application.leaveBlankIfUnknown")} onChange={event => change(name, event.target.value)} />}{sensitive && profile.sensitiveConfigured?.includes(name) && <ActionButton busy={busy} activeButton={activeButton} type="button" onClick={() => change(name, '')}>{t("application.clearSaved", { label })}</ActionButton>}</label>)}
          {BOOLEAN_FIELDS.map(([name,label]) => <label key={name}>{label}<select aria-label={label} value={Object.hasOwn(patch, name) ? patch[name] ?? '' : profile[name] ?? ''} onChange={event => change(name, event.target.value === '' ? null : event.target.value === 'true')}><option value="">{t("application.undecided")}</option><option value="true">{t("application.yes")}</option><option value="false">{t("application.no")}</option></select></label>)}
          {RECORDS.map(([family, label, fields]) => <MotionDetails key={family}><summary>{label}</summary>{(patch[family] ?? profile[family] ?? []).map((record, index) => <MotionRecord key={recordKey(record)} onRemove={() => setPatch(current => ({ ...current, [family]: (current[family] ?? profile[family] ?? []).filter(item => recordKey(item) !== recordKey(record)) }))}><legend>{label} {index + 1}</legend>{fields.map(([key, text]) => <label key={key}>{text}<input value={record[key] || ''} onChange={event => recordChange(family, index, key, event.target.value)} maxLength={4000} /></label>)}</MotionRecord>)}<ActionButton busy={busy} activeButton={activeButton} type="button" onClick={() => change(family, [...(patch[family] ?? profile[family] ?? []), {}])}>{t("application.addRecord", { label })}</ActionButton></MotionDetails>)}
          <ActionButton busy={busy} activeButton={activeButton} type="submit" disabled={!Object.keys(patch).length}>{t("application.saveLocalProfile")}</ActionButton>
        </fieldset>
      </form>
    </MotionDetails>
    <form onSubmit={event => { event.preventDefault(); act(async signal => { setStatus(await request('/start', { url }, signal)); await refreshTabs(signal); }); }}>
      <label>{t("application.companyRecruitingPage")}<input type="url" aria-label={t("application.companyRecruitingPage")} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" disabled={locked || status?.connected} /></label>
      <p>{t("application.signInAndOpenTheApplicationPage")}</p>
      {!status?.connected && <ActionButton busy={busy} activeButton={activeButton} type="submit" disabled={locked}>{t("application.connectPage")}</ActionButton>}
    </form>
    {status?.connected && <>
      <p className="application-current">{t("application.currentPage")}{status.currentUrl || t("application.selectAnApplicationPage")}</p>
      <div className="application-actions"><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked} onClick={() => act(refreshTabs)}>{t("application.refreshPageList")}</ActionButton><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked} onClick={() => act(async signal => { setStatus(await request('/close', {}, signal)); setTabs([]); resetPage(); })}>{t("application.disconnectBrowser")}</ActionButton></div>
      {tabs.length > 0 && <label>{t("application.selectPageToFill")}<select aria-label={t("application.selectPageToFill")} value={status.tabId || ''} disabled={locked} onChange={event => { const tabId = event.target.value; act(async signal => { setStatus(await request('/tab', { tabId }, signal)); resetPage(); }); }}>{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.url || t("application.blankPage")}</option>)}</select></label>}
      <div className="application-actions"><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked} onClick={() => act(scanPage)}>{t("application.scanCurrentForm")}</ActionButton><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked} onClick={() => act(async signal => { const expanded = await request('/rows', {}, signal); await scanPage(signal); setRowsResult(expanded); })}>{t("application.addExperienceRows")}</ActionButton><ActionButton busy={busy} activeButton={activeButton} type="button" disabled={locked || !scan} onClick={() => act(async signal => { const attachments = Object.entries(attachmentSelections).filter(([, documentId]) => documentId).map(([fieldId, documentId]) => ({ fieldId, documentId })); setResult(await request('/fill', { scanId: scan.scanId, attachments }, signal)); setAttachmentSelections({}); })}>{t("application.fillBlankFields")}</ActionButton></div>
    </>}
    {busy && <p role="status">{t("application.processingApplicationStep")}</p>}
    {rowsResult && <p role="status">{t("application.rowsSummary", { added: rowsResult.added || 0, pending: rowsResult.pending || 0 })}</p>}
    {result && <p role="status">{t("application.fillSummary", { filled: result.filled || 0, attachments: result.uploadedAttachments > 0 ? t("application.websiteReceivedAttachments", { count: result.uploadedAttachments }) : "", preserved: result.preserved || 0, pending: result.pending || 0, selected: result.selectedAttachments > 0 ? t("application.originalFilesSelectedConfirmWebsiteReceipt", { count: result.selectedAttachments }) : "" })}</p>}
    {scan && <ul className="application-fields">{scan.fields.map((field, index) => {
      const state = result?.results.find(item => item.fieldId === field.id)?.status;
      return <li key={field.id} style={{ '--enter-delay': `calc(var(--stagger) * ${Math.min(index, 7)})` }}><span>{field.section ? `${field.section} · ` : ''}{field.label || t("application.unnamedField")}</span><FieldState stateKey={state || `${field.occupied}-${field.unsupported}`}>{state ? RESULT_LABELS[state] || t("application.needsChecking") : field.occupied ? t("application.existingContentKept") : field.unsupported ? t("application.requiresYourAction") : t("application.blank")}</FieldState>{field.type === 'file' && !field.occupied && !field.unsupported && <label className="application-attachment">{t("application.selectAttachmentFor", { label: field.label || t("application.unnamedField") })}<select aria-label={t("application.selectAttachmentFor", { label: field.label || t("application.unnamedField") })} disabled={locked} value={attachmentSelections[field.id] || ''} onChange={event => { const documentId = event.target.value; setAttachmentSelections(current => ({ ...current, [field.id]: documentId })); }}><option value="">{t("application.skipUploadIWillHandleItManually")}</option>{documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select><small>{t("application.onlyThisCandidateSUploadedOriginalFiles")}{field.accept ? t("application.pageRequirements", { accept: field.accept }) : ''}</small></label>}</li>;
    })}</ul>}
    <p>{t("application.selectEachAttachmentExplicitlyUnselectedFilesAre")}</p>
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
