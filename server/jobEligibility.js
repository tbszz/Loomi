import { SKILL_LEXICON, SCHOOLS_985, SCHOOLS_211, INDEPENDENT_COLLEGE_SUFFIX, RISK_PATTERNS } from "./jobEligibilityLexicon.js";
import { deadlineEnd } from './jobDataQuality.js';

const DEGREE_ORDER = { bachelor: 1, master: 2, phd: 3 };
const TIER_ORDER = { none: 0, dfc: 1, "211": 2, "985": 3 };
const PREFERRED = /preferred|plus|nice to have|bonus|加分|优先/i;
const MANDATORY = /required|must|必须|硬性/i;
const OVERSEAS_TERMS = ["united states", "usa", "u.s.", "new york", "california", "san francisco", "washington", "canada", "singapore", "london", "uk", "remote us", "remote-us"];
const WORK_AUTH_TERMS = ["work authorization", "authorized to work", "no visa sponsorship", "no sponsorship", "不提供签证", "无需签证", "工作许可"];
const AUTH_EVIDENCE_TERMS = ["work authorization", "authorized to work", "green card", "citizen", "h1b", "opt", "cpt", "工作许可", "绿卡", "公民", "签证", "合法工作"];

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value) => compact(value).toLowerCase();
const SENIOR_TITLE = /资深|高级|专家|负责人|总监|架构师|首席|\b(?:senior|staff|principal|lead|director|head)\b/i;
const INTERNSHIP = /实习|\bintern(?:ship)?\b/i;

// Shared by eligibility and retrieval: only the declared type and posting text
// are career-stage evidence. A portal URL (including /campusrecruitment/) is not.
export function jobCareerSignals(job = {}) {
  const postingText=[job.title,job.description,...(job.requirements||[])].filter(Boolean).join('\n');
  const graduateEvidence=['campus','internship','intern'].includes(job.type)
    ? job.type : postingText.match(/校招|校园招聘|应届|毕业生|(?<!\d)(?:20\d{2}|\d{2})\s*届|秋招|春招|管培|\b(?:graduate|campus|internship)\b/i)?.[0] || '';
  return {
    graduateEvidence,
    seniorityEvidence: String(job.title || '').match(SENIOR_TITLE)?.[0] || '',
    workExperienceRequirements: requiredExperienceRequirements(postingText).filter(isWorkExperienceRequirement)
  };
}

export function evaluateJobEligibility(job = {}, profile = {}, options = {}) {
  const text = jobText(job);
  const material = [options.material, profileText(profile)].filter(Boolean).join("\n");
  const checks = [
    checkSourceCompleteness(job),
    checkJobType(job, options.type, profile, options.now),
    checkRegion(job, options.region),
    checkGraduation(text, profile, options),
    checkFreshness(job, text, options.now),
    checkEducation(text, profile),
    checkExperience(text, profile, options.now, options.type, job.title),
    checkWorkAuthorization(job, text, material),
    checkSkills(text, profile, material)
  ];
  const major = checkMajor(text, profile);
  if (major) checks.splice(3, 0, major);
  // Optional dimensions appear only when the JD (or the user) actually sets them.
  for (const check of [checkSchoolTier(text, profile, material), checkLanguage(text, material), checkExclusion(job, text, options.exclude)]) {
    if (check) checks.push(check);
  }

  const failed = checks.filter((check) => check.status === "fail");
  const unknown = checks.filter((check) => check.status === "unknown");
  const status = failed.length ? "rejected" : unknown.length ? "verify" : "passed";
  return {
    status,
    reason: summarize(status, failed, unknown),
    checks,
    score: score(job, checks)
  };
}

export function filterEligibleJobs(jobs = [], profile = {}, options = {}) {
  const evaluated = jobs.map((job) => {
    const eligibility = evaluateJobEligibility(job, profile, options);
    return { ...job, eligibility };
  });
  const passed = evaluated
    .filter((job) => job.eligibility.status === "passed")
    .sort((a, b) => b.eligibility.score - a.eligibility.score);
  const uncertainties = evaluated.filter((job) => job.eligibility.status === "verify");
  const rejected = evaluated.filter((job) => job.eligibility.status === "rejected");
  return { jobs: passed, uncertainties, rejected };
}

function checkJobType(job, requestedType, profile, now) {
  if (!requestedType) {
    return pass("job_type", "岗位类型未形成排除条件。");
  }
  const graduateOnly=['campus','internship','intern'].includes(job.type) ? job.type
    : String(job.title || '').match(/校招|应届|实习|\b(?:graduate|intern(?:ship)?)\b/i)?.[0];
  if(requestedType==='social' && graduateOnly && candidateWorkExperienceYears(profile,now)>=2) {
    return fail('job_type','候选人已有多年全职工作经验并搜索社招，该岗位明确面向校招、应届或实习。',`${graduateOnly} / ${job.title || ''}`);
  }
  if (!job.type) return unknown('job_type','岗位未明确招聘类型，不能推定是校招或实习。');
  if (job.type !== requestedType) {
    return fail("job_type", `用户搜索${typeLabel(requestedType)}，岗位标注为${typeLabel(job.type)}。`, evidence(job.type));
  }
  return pass("job_type", `岗位类型匹配${typeLabel(requestedType)}。`, evidence(job.type));
}

function checkRegion(job, region) {
  if (!region || region === 'any') return pass('region','用户未设置地区排除条件。');
  const location = String(job.location || job.city || '');
  const detected=detectJobRegion(job);
  const domestic=detected==='domestic'||detected==='mixed';
  const overseas=detected==='overseas'||detected==='mixed';
  if (domestic && overseas) return unknown('region','岗位包含多个国家或地区，需要确认具体申请地点。',location);
  if (!domestic && !overseas) return unknown('region','岗位地点未能确认，不能假定远程岗位允许跨国工作。',location);
  if ((region === 'domestic' && overseas) || (region === 'overseas' && domestic)) return fail('region','岗位地点不符合用户明确的求职地区。',location);
  return pass('region','岗位地区符合当前搜索范围。',location);
}

export function detectJobRegion(job={}) {
  const location=[job.location||job.city||'',job.country||''].join(' ');
  const domestic=/中国|北京|上海|深圳|广州|杭州|南京|成都|武汉|苏州|西安|合肥|郑州|天津|重庆|长沙|厦门|宁波|珠海|东莞|大陆|\b(?:china|beijing|peking|shanghai|shenzhen|guangzhou|hangzhou|chengdu|wuhan|nanjing)\b/i.test(location);
  const overseas=OVERSEAS_TERMS.some(term=>lower(location).includes(term)) || /\b(?:india|germany|france|japan|korea|australia|netherlands|switzerland|sweden|ireland|israel|spain|italy|poland|brazil|mexico|toronto|vancouver|berlin|paris|bengaluru|bangalore|mumbai|seattle|boston|austin|san jose|santa clara|palo alto|united kingdom|united states|usa)\b|美国|英国|加拿大|印度|德国|法国|日本|韩国|澳大利亚/i.test(location);
  return domestic&&overseas?'mixed':domestic?'domestic':overseas?'overseas':'unknown';
}

function checkGraduation(text, profile, { userStatements = [], educationFacts = [] } = {}) {
  const cohorts=[...text.matchAll(/(?<!\d)(?:20\d{2}|\d{2})(?:\s*届)?(?:\s*[/、,，\-–—~～至]\s*(?:20\d{2}|\d{2})(?:\s*届)?)*\s*届/g)];
  if (!cohorts.length) return pass('graduation','未提取到明确毕业届别限制。');
  const normalizeYear=value=>value.length===2?2000+Number(value):Number(value);
  const years=new Set();
  for(const [cohort] of cohorts) {
    for(const part of cohort.matchAll(/20\d{2}|\d{2}/g)) years.add(normalizeYear(part[0]));
    for(const range of cohort.matchAll(/(20\d{2}|\d{2})\s*(?:届\s*)?[-–—~～至]\s*(20\d{2}|\d{2})/g)) {
      for(let year=normalizeYear(range[1]);year<=normalizeYear(range[2]);year++) years.add(year);
    }
  }
  const requirement=cohorts.map(match=>match[0]).join('、');
  let education=profile.education || [];
  let candidateYears=graduationYears(education.join('\n'));
  let selfReported=false;
  if(!candidateYears.size && education.length<=1) {
    const facts=educationFacts.filter(f=>f.type==='education' && ['verified','user_asserted'].includes(f.status));
    if(facts.length) {
      education=facts.map(f=>f.value);
      candidateYears=graduationYears(education.join('\n'));
      selfReported=facts.some(f=>f.status==='user_asserted');
    }
    if(!candidateYears.size && education.length<=1) {
      // Only the caller's current-conversation user messages belong here.
      candidateYears=graduationYears(userStatements.join('\n'), false);
      selfReported=true;
    }
  }
  const source=`${requirement} / ${education.join('\n')}`;
  if(education.length>1 || candidateYears.size>1) return unknown('graduation','候选人存在多个毕业年份或教育记录，需要按当前申请学历核对，不能用第一段学历直接排除。',source);
  const [year]=candidateYears;
  if(!year) return unknown('graduation',`岗位限${requirement}，材料没有明确毕业年份。`,requirement);
  const basis=selfReported?`按你自述的${year}届`:`材料毕业年份为${year}`;
  if(!years.has(year)) return fail('graduation',`岗位要求${requirement}，${basis}，不符合届别要求。`,`${source} / ${year}`);
  if(selfReported) return unknown('graduation',`${basis}符合岗位${requirement}范围，毕业年份尚待材料核实。`,`${source} / ${year}`);
  return pass('graduation','毕业届别符合要求。',source);
}

function graduationYears(text, includeEducationRanges = true) {
  if(!includeEducationRanges) {
    // Chat can contain pasted JDs and search requests. Only explicit self-
    // descriptions within one clause supply candidate graduation evidence.
    const selfDescription=/(?:我|本人)\s*(?:是\s*)?(?:预计\s*|预期\s*)?(?:(?:20\d{2}|\d{2})\s*届|20\d{2}\s*年\s*(?:毕业|应届))|(?<!\d)(?:20\d{2}|\d{2})\s*届\s*的\s*我/g;
    text=text.split(/[。；;，,\r\n]/).flatMap(clause=>clause.match(selfDescription)||[]).join('\n');
  }
  const years=new Set();
  for(const match of text.matchAll(/(?:预计|预期)?毕业(?:时间)?[:：\s]*(20\d{2})|(?<!\d)(20\d{2}|\d{2})\s*届|(20\d{2})\s*年?\s*(?:毕业|应届)/g)) {
    const year=match[1]||match[2]||match[3];
    years.add(year.length===2?2000+Number(year):Number(year));
  }
  if(includeEducationRanges) for(const match of text.matchAll(/20\d{2}(?:[.\/-]\d{1,2})?\s*[-–—~～至]\s*(20\d{2})/g)) years.add(Number(match[1]));
  return years;
}

function checkFreshness(job, text, now = new Date().toISOString()) {
  if(job.closed || job.expiryReason) return fail('freshness','来源明确标记岗位关闭或已过期。',job.expiryReason||'closed');
  if (/(closed|filled|no longer|applications closed|已关闭|停止招聘|已截止|招满)/i.test(text)) {
    return fail("freshness", "岗位文本显示已关闭或已截止。", evidence(text.match(/closed|filled|no longer|applications closed|已关闭|停止招聘|已截止|招满/i)?.[0]));
  }
  const deadline = String(job.deadline || text.match(/(?:deadline|截止|申请截止)[:：]?\s*([^\n]+)/i)?.[1] || '').trim();
  if (deadline) {
    const end=deadlineEnd({deadline});
    if(end===null) return unknown('freshness','截止日期存在歧义或延期信息，需要核实当前开放状态。',deadline);
    if (end <= new Date(now).getTime()) {
      return fail("freshness", `岗位截止日期${deadline}早于当前日期。`, evidence(deadline));
    }
    return pass("freshness", `岗位截止日期${deadline}尚未过期。`, evidence(deadline));
  }
  if(job.source==='official-career-site') {
    const observed=Number(job.officialListingVerifiedAt),current=new Date(now).getTime();
    if(Number.isFinite(observed) && observed>0 && observed<=current && current-observed<=7*86400000) {
      return pass('freshness','近期在官方招聘列表中观察到该岗位；投递前仍以官方页面为准。',new Date(observed).toISOString());
    }
    return unknown('freshness','尚无近期官方在招列表证据，需核实岗位开放状态。');
  }
  if (!job.postingAge && (!job.updatedAt || job.source === 'github-job-source') && !job.deadline) {
    return unknown("freshness", "聚合记录未提供发布日期、岗位年龄或截止日期，需打开原投递页核实是否仍开放。");
  }
  const days = Number(text.match(/(\d+)\s*d\b/i)?.[1] || 0);
  if (days > 90) return fail("freshness", `GitHub源显示岗位年龄${days}天，时效风险过高。`, evidence(`${days}d`));
  return pass("freshness", "没有发现关闭或过期信号。");
}

function checkSourceCompleteness(job) {
  if(job.recordKind==='recruitment_batch') return unknown('source_completeness','这是一条招聘批次或公告，需确认具体岗位及其完整职责和要求。');
  if(job.source === 'domestic-feed' && !job.fullDescriptionVerified) return unknown('source_completeness','后台同步的聚合资料尚未核实完整官方JD，不能把摘要或职责段落当作全部招聘门槛。');
  if (job.source === 'github-job-source' && !job.fullDescriptionVerified) return unknown('source_completeness', '此来源仅提供岗位标题、地点等聚合信息，自动生成的摘要不是完整招聘要求，需查看官方JD。');
  if (job.source === 'official-career-site' && !job.fullDescriptionVerified) return unknown('source_completeness', '官方招聘页当前只提取到职位摘要或列表链接，需打开官方岗位详情核对完整要求。');
  const hasDescription = compact(job.description).length >= 20;
  const hasRequirements = Array.isArray(job.requirements) && job.requirements.some((item) => compact(item).length >= 3);
  if (hasDescription || hasRequirements) return pass("source_completeness", "聚合记录包含可审计岗位描述或要求。");
  return unknown("source_completeness", "聚合记录只有标题等摘要信息，缺少完整JD，需核实后才能称为可投递。");
}

function checkEducation(text, profile) {
  const required = requiredDegree(text);
  if(required==='conditional') return unknown('education','岗位包含降低学历门槛的例外条件，需结合项目、实习或竞赛证据核实。');
  if (!required) {
    if (/phd\s+(intern|internship)|博士.{0,4}实习/i.test(text)) return candidateDegree(profile) === 'phd' ? pass('education','学历符合博士实习方向。','PhD Internship') : unknown('education','岗位标题是博士实习，材料未证明博士在读资格，不能作为推荐，需核实完整学历要求。','PhD Internship');
    return pass("education", "岗位未提取到明确学历硬门槛。");
  }
  const candidate = candidateDegree(profile);
  if (candidate === "unknown") {
    return unknown("education", `岗位要求${degreeLabel(required)}，候选人材料没有明确学历层级。`, evidence(required));
  }
  if ((DEGREE_ORDER[candidate] || 0) < DEGREE_ORDER[required]) {
    return fail("education", `岗位明确要求${degreeLabel(required)}，候选人材料最高学历为${degreeLabel(candidate)}。`, evidence(required));
  }
  return pass("education", `学历满足${degreeLabel(required)}要求。`, evidence(required));
}

function checkMajor(text, profile) {
  const required = requiredMajor(text);
  if (!required) return null;
  const edu = lower((profile.education || []).join(" "));
  const candidateMajor = /computer|software|cs\b|计算机|软件/.test(edu) ? 'computer' : /市场营销|广告学|marketing/.test(edu) ? 'marketing' : /会计|财务|accounting/.test(edu) ? 'accounting' : /护理|医学|medical|nursing/.test(edu) ? 'medical' : null;
  if (!candidateMajor) return unknown('major','材料未明确对应专业，需核实专业限制。',required);
  if (required === "computer" && candidateMajor === "computer") {
    return pass("major", "专业方向匹配计算机相关要求。", evidence("计算机"));
  }
  if (required !== candidateMajor) {
    return fail("major", "岗位明确限制专业，候选人教育材料未匹配该专业。", evidence(required));
  }
  return pass("major", "专业方向满足岗位要求。", evidence(required));
}

function checkExperience(text, profile, now, requestedType, title) {
  const requirements = requiredExperienceRequirements(text);
  if (!requirements.length) return SENIOR_TITLE.test(title || '')
    ? unknown('experience','岗位标题包含资深或高级职级，但未提取到明确经验门槛，需核实完整任职要求。',title)
    : pass("experience", "岗位未提取到明确年限硬门槛。");
  const studentEvidence=requestedType==='campus' ? currentStudentEvidence(profile,now) : '';
  const workYears=studentEvidence ? candidateWorkExperienceYears(profile,now) : null;
  if(studentEvidence && (workYears===null || workYears===0)) {
    const workRequirements=requirements.filter(isWorkExperienceRequirement);
    const substantial=workRequirements.find(requirement=>requirement.years>=3);
    if(substantial) return fail('experience',`岗位要求至少${substantial.years}年全职工作经验；候选人仍在读，材料未证明全职年限，实习不能抵算。`,`${substantial.clause} / ${studentEvidence}`);
    if(workRequirements.length) return unknown('experience',`岗位要求至少${workRequirements[0].years}年工作经验，候选人仍在读且未明确全职年限，需要核实。`,`${workRequirements[0].clause} / ${studentEvidence}`);
  }
  const results=requirements.map(requirement=>checkExperienceRequirement(requirement,profile,now));
  return results.find(result=>result.status==='fail') || results.find(result=>result.status==='unknown') || pass('experience',results.map(result=>result.message).join('；'),results.map(result=>result.evidence).join('；'));
}

function checkExperienceRequirement({years,clause,ambiguous}, profile, now, selectedDomain) {
  if(ambiguous) return unknown('experience','年限与相关领域的对应关系不明确，需要核实原始要求。',clause);
  const domains=[
    [/测试.{0,8}经验|testing.{0,15}experience/i,/测试|testing|\bqa\b/i],
    [/芯片.{0,8}(?:工作|经验)|\b(?:chip|ic)\b.{0,15}experience/i,/芯片|集成电路|\b(?:chip|ic|eda)\b/i],
    [/(?:软件|后端|前端|研发|开发|编程).{0,8}(?:经验|经历)|\b(?:frontend|backend|software)\b.{0,20}experience/i,/软件|后端|前端|研发|开发|编程|\b(?:software|frontend|backend|developer)\b/i]
  ];
  const allowed=domains.filter(([requirement])=>requirement.test(clause)).map(([,domain])=>domain);
  if(allowed.length>1 && !/或|\bor\b/i.test(clause)) return unknown('experience','年限要求包含多个领域，需核实各领域的实际年限。',clause);
  if(!selectedDomain && allowed.length>1) {
    const alternatives=allowed.map(domain=>checkExperienceRequirement({years,clause},profile,now,domain));
    return alternatives.find(result=>result.status==='pass') || alternatives.find(result=>result.status==='unknown') || alternatives[0];
  }
  const domain=selectedDomain||allowed[0]||null;
  const fullTimeOnly=years>=3 && isWorkExperienceRequirement({clause,ambiguous});
  // Filter whole entries before splitting: a comma must not detach the word
  // 实习 from the dated range or stated years that belong to that internship.
  const entries=(profile.experience||[]).filter(entry=>!fullTimeOnly || !INTERNSHIP.test(String(entry))).flatMap(entry=>String(entry).split(/[，,；;\n]/)).filter(entry=>!domain || domain.test(entry) && !/没有|尚无|无.{0,12}(?:经验|经历)|未从事|未做过/.test(entry));
  const source = lower(entries.join(" "));
  const stated = candidateExperienceYears(source);
  // Without a stated total, add up the dated experience entries. Projects are
  // left out: a project period is not employment time.
  const months = stated === null ? experienceMonths(entries, now) : 0;
  const candidateYears = stated ?? (months ? Math.round(months / 12 * 10) / 10 : null);
  if (stated === null && candidateYears !== null && candidateYears < years) {
    return fail("experience", `岗位要求${years}年以上经验，按经历时间段合计约${candidateYears}年。`, evidence(`${years}+ years`));
  }
  if (stated === null && candidateYears !== null) {
    return pass("experience", `按经历时间段合计约${candidateYears}年，满足${years}年以上要求。`, evidence(`${years}+ years`));
  }
  if (candidateYears === null) {
    return unknown("experience", `岗位要求${years}年以上经验，候选人材料没有明确经验年限。`, evidence(`${years}+ years`),
      fullTimeOnly ? `岗位要求${years}年以上相关全职工作经验——你在这个方向的全职经历合计多久？（不含实习和个人项目）`
        : `岗位要求${years}年以上相关经验——你在这个方向的实习或工作经历合计多久？（实习也算，个人项目单独说明，直接回复年限或"没有"）`);
  }
  if (candidateYears < years) {
    return fail("experience", `岗位要求${years}年以上经验，候选人材料只有${candidateYears}年经验。`, evidence(`${years}+ years`));
  }
  return pass("experience", `经验年限满足${years}年以上要求。`, evidence(`${years}+ years`));
}

function checkWorkAuthorization(job, text, material) {
  const region=detectJobRegion(job);
  const isOverseas = region==='overseas' || region==='mixed' || OVERSEAS_TERMS.some((term) => lower(`${job.location} ${job.city} ${text}`).includes(term));
  const requiresAuth = WORK_AUTH_TERMS.some((term) => lower(text).includes(term));
  if (!isOverseas) return pass("work_authorization", "岗位未提取到境外工作授权硬门槛。");
  if (/没有.{0,8}(签证|工作许可|工作授权)|无.{0,8}(签证|工作许可|工作授权)|不具备.{0,8}(签证|工作许可|工作授权)/.test(material)) {
    return fail("work_authorization", "用户材料明确缺少签证或海外工作许可，不能投递该境外岗位。", evidence("没有签证"));
  }
  const hasEvidence = hasPositiveAuthorization(material);
  if (!hasEvidence) {
    const message = requiresAuth
      ? "岗位要求境外工作授权，但用户材料没有身份或工作许可证据，需核实后才能投递。"
      : "岗位地点在境外或Remote US，用户材料没有工作授权证据，需核实后才能投递。";
    return unknown("work_authorization", message, evidence(requiresAuth ? "work authorization" : job.location),
      "你的材料里没有签证或工作许可信息——你有哪些身份/签证（如美国OPT、绿卡），还是只考虑国内岗位？");
  }
  return pass("work_authorization", "用户材料包含工作授权相关线索，仍需以岗位申请页为准。", evidence("work authorization"));
}

function checkSkills(text, profile, material) {
  const groups = requiredSkillGroups(text);
  const required = [...new Set(groups.flatMap(group=>group.skills))];
  if (!required.length) return unknown("skills", "岗位未提取到可核对技能，需打开投递页确认要求。");
  const source = lower([material, profileText(profile)].join("\n"));
  const hits = required.filter((term) => hasSkill(source, term));
  if (!hits.length) {
    // Absent evidence in the current material is unverified, not disqualified:
    // the user answers, the answer becomes analyzable material, and the next
    // search re-verifies instead of the job sitting in a dead rejected list.
    return unknown("skills", `岗位技能要求未在用户材料中找到证据：${required.slice(0, 4).join(" / ")}。`, evidence(required[0]),
      `这个岗位要求这些技能：${required.join("、")}——你掌握其中哪些？直接回复即可，我会把你的回答并入材料重新核验。`);
  }
  const unmet=groups.filter(group=>group.ambiguous || group.skills.filter(skill=>hits.includes(skill)).length<group.minimum);
  if (unmet.length) {
    const missing = unmet.map(group=>group.ambiguous?`${group.skills.join(' / ')}的组合条件`:group.minimum===group.skills.length?group.skills.filter(skill=>!hits.includes(skill)).join(' / '):`${group.skills.join(' / ')}中至少${group.minimum}项`);
    return unknown("skills", `用户材料命中${hits.join(" / ")}，仍需核实${missing.join("；")}的技能证据。`, evidence(missing[0]));
  }
  return pass("skills", `用户材料命中技能：${hits.slice(0, 4).join(" / ")}。`, evidence(hits[0]));
}

function requiredDegree(text) {
  text = requirementClauses(text);
  const value = lower(text);
  if(/(?:硕士|博士)[\s\S]{0,100}本科[\s\S]{0,30}(?:也可以|亦可|也可|可接受|考虑|放宽)/.test(text)) return 'conditional';
  if (/(bachelor|本科).{0,20}(or|或|\/).{0,20}(master|硕士)|bs\/ms|bs or ms/.test(value)) return "bachelor";
  for(const [degree,pattern] of [['phd',/博士(?:及以上)?(?:学历|学位)|博士(?:及以上|以上)(?:学历|学位)?/],['master',/硕士(?:及以上)?(?:学历|学位)|硕士(?:及以上|以上)(?:学历|学位)?/],['bachelor',/本科(?:及以上)?(?:学历|学位)|本科(?:及以上|以上)(?:学历|学位)?/]]) if(pattern.test(text)) return degree;
  if (/(must|required|requires|requirement|enrolled in|硬性要求|必须|要求).{0,30}(phd|doctor|博士)|(phd|doctor|博士).{0,20}(required|only|必须|硬性)/i.test(text)) return "phd";
  if (/(must|required|requires|requirement|硬性要求|必须|要求).{0,30}(master|硕士|研究生)|(master|硕士|研究生).{0,20}(required|必须|硬性)/i.test(text)) return "master";
  if (/(must|required|requires|requirement|硬性要求|必须|要求).{0,30}(bachelor|本科)|(bachelor|本科).{0,20}(required|必须|硬性)/i.test(text)) return "bachelor";
  return "";
}

function candidateDegree(profile) {
  const text = lower((profile.education || []).join(" "));
  if (/phd|doctor|博士/.test(text)) return "phd";
  if (/master|硕士|研究生/.test(text)) return "master";
  if (/bachelor|本科|学士/.test(text)) return "bachelor";
  return "unknown";
}

function requiredMajor(text) {
  text = requirementClauses(text);
  const value = lower(text);
  if (/(计算机|computer science|software engineering|cs\b).{0,8}(相关专业|专业|required|requirement)|硬性要求.{0,18}(计算机|软件)/i.test(text)) return "computer";
  if (/(市场营销|广告学|marketing).{0,8}(相关专业|专业|required)|硬性要求.{0,18}(市场营销|广告学|marketing)/i.test(text)) return "marketing";
  if (/(会计|财务|accounting).{0,8}(相关专业|专业|required)|硬性要求.{0,18}(会计|财务|accounting)/i.test(text)) return "accounting";
  if (/(护理|医学|medical|nursing).{0,8}(相关专业|专业|required)|硬性要求.{0,18}(护理|医学|medical|nursing)/i.test(text)) return "medical";
  return value.includes("computer science major required") ? "computer" : "";
}

function requiredExperienceRequirements(text) {
  // Disambiguate before clause splitting loses earlier list markers. Insert
  // the sentence boundary only with a preceding N-1 marker; keep true decimals.
  const source=String(text || '');
  text=source.replace(/(?<![\d.])(\d+)\.(\d+(?:\.\d+)?)(?=\s*(?:[-–—~至]\s*\d+(?:\.\d+)?)?\s*\+?\s*(?:years?|年))/gi,
    (value,marker,years,index)=>Number(marker)>=2 && new RegExp(`(?<![\\d.])${Number(marker)-1}[.、]`).test(source.slice(0,index))
      ? `${marker}. ${years}` : value);
  text = requirementClauses(text);
  const patterns = [
    // A range is a minimum at its lower bound, not the upper endpoint.
    /(\d+(?:\.\d+)?)\s*[-–—~至]\s*\d+(?:\.\d+)?\s*\+?\s*(?:years?|年).{0,25}(?:experience|经验|经历)/i,
    /(\d+(?:\.\d+)?)\+?\s*(?:years?|年).{0,25}(?:experience|经验|经历).{0,12}(?:required|requires|must|要求|必须)/i,
    /(?:required|requires|must|minimum|at least|要求|必须|至少).{0,18}(\d+(?:\.\d+)?)\+?\s*(?:years?|年).{0,10}(?:experience|经验|经历)?/i,
    /(\d+(?:\.\d+)?)\+?\s*(?:years?|年)(?:以上|及以上).{0,10}(?:experience|经验|经历)?/i,
    /(\d+(?:\.\d+)?)\s*年.{0,25}(?:经验|经历)\s*(?:及)?以上/i,
    /(\d+(?:\.\d+)?)\s*\+\s*(?:years?|年).{0,25}(?:experience|经验|经历)/i
  ];
  const requirements=new Map();
  for(const clause of text.split('\n')) {
    for (const pattern of patterns) {
      const match = clause.match(pattern);
      if (match) {const years=Number(match[1]);requirements.set(clause.trim(),{years,clause,ambiguous:!/(?:experience|经验|经历|工作)/i.test(clause)});break;}
    }
  }
  return [...requirements.values()];
}

function isWorkExperienceRequirement({clause,ambiguous}) {
  // Internship/project/research duration alone is not a full-time work minimum.
  return !ambiguous && /工作|经验|经历|\b(?:work|experience)\b/i.test(clause)
    && !/实习|项目(?:经验|经历|实践)|在校|研究经历|\b(?:intern(?:ship)?|project|research)\b/i.test(clause);
}

function candidateWorkExperienceYears(profile,now) {
  const entries=(profile.experience||[]).map(String).filter(entry=>!INTERNSHIP.test(entry));
  const stated=candidateExperienceYears(entries.join('\n'));
  if(stated!==null) return stated;
  const months=experienceMonths(entries,now);
  return months ? months/12 : null;
}

function currentStudentEvidence(profile,now=new Date().toISOString()) {
  const currentYear=new Date(now).getUTCFullYear();
  return (profile.education||[]).map(String).find(entry=>{
    const range=entry.match(/20\d{2}(?:[年./-]\d{1,2}月?)?\s*(?:[-–—~～]|至|到)\s*(20\d{2})/);
    const graduation=entry.match(/(?:预计|预期)?毕业(?:时间)?[:：\s]*(20\d{2})|(20\d{2})\s*(?:年)?(?:毕业|届)/);
    const year=Number(range?.[1] || graduation?.[1] || graduation?.[2]);
    return year>=currentYear;
  }) || '';
}

function candidateExperienceYears(source) {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:years?|年).{0,10}(?:experience|经验|经历)/i,
    /(?:experience|经验|经历).{0,10}(\d+(?:\.\d+)?)\s*(?:years?|年)/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

// Unions month-precise ranges such as "2024.07-2024.10" or "2023年6月 - 至今".
// Year-only ranges are too coarse to count and are ignored.
function experienceMonths(entries, now = new Date().toISOString()) {
  const current = new Date(now);
  const nowIndex = current.getUTCFullYear() * 12 + current.getUTCMonth();
  const date = String.raw`(\d{4})\s*[年./-]\s*(\d{1,2})\s*月?`;
  const pattern = new RegExp(`${date}\\s*(?:[-–—~～]|至|到)\\s*(?:${date}|(至今|现在|今|present|now))`, "gi");
  const spans = [];
  for (const entry of entries) {
    for (const match of String(entry || "").matchAll(pattern)) {
      const start = Number(match[1]) * 12 + Number(match[2]) - 1;
      const end = match[5] ? nowIndex : Number(match[3]) * 12 + Number(match[4]) - 1;
      const months = [match[2], match[4]].filter(Boolean).map(Number);
      if (months.some((month) => month < 1 || month > 12) || end < start || end > nowIndex) continue;
      spans.push([start, end]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0, last = -Infinity;
  for (const [start, end] of spans) {
    const from = Math.max(start, last + 1);
    if (end >= from) total += end - from + 1;
    last = Math.max(last, end);
  }
  return total;
}

function checkSchoolTier(text, profile, material) {
  const requirementText = requirementClauses(text);
  const tiers = [["985", /(?<!\d)985(?!\d)/], ["211", /(?<!\d)211(?!\d)/], ["dfc", /双一流/]].filter(([, pattern]) => pattern.test(requirementText)).map(([tier]) => tier);
  const qs = requirementText.match(/QS.{0,6}?(?:前|top\s*)(\d{1,3})/i);
  if (!tiers.length && !qs) return null;
  const records = educationRecords(profile, material);
  const bachelorOnly = /第一学历|本科院校|本科毕业于|本科为/.test(requirementText);
  const relevant = bachelorOnly ? records.filter((record) => /本科|学士|bachelor/i.test(record)) : records;
  const results = [];
  if (tiers.length) results.push(domesticTierResult(tiers.reduce((a, b) => TIER_ORDER[a] < TIER_ORDER[b] ? a : b), relevant, bachelorOnly || /本硕|本科及研究生阶段/.test(requirementText)));
  if (qs) results.push(qsResult(Number(qs[1]), material));
  // "985/211 或 QS前100": meeting any listed route satisfies the requirement.
  const passed = results.find((item) => item.status === "pass");
  const source = evidence(requirementText.match(/[^\n]*(?:985|211|双一流|QS)[^\n]*/i)?.[0]);
  if (passed) return pass("school_tier", passed.message, source);
  const unknownResult = results.find((item) => item.status === "unknown");
  if (unknownResult) return unknown("school_tier", unknownResult.message, source, `这个岗位对院校层次有要求（${source.slice(0, 40)}）——你${bachelorOnly ? "本科" : "就读"}的学校是985/211/双一流，还是海外院校（QS排名多少）？`);
  return fail("school_tier", results.map((item) => item.message).join("；"), source);
}

// everyRecord: 第一学历 / 本硕 wording means each relevant record must qualify;
// otherwise one qualifying degree is enough, so ambiguity never rejects.
function domesticTierResult(required, records, everyRecord) {
  const label = { "985": "985", "211": "211", dfc: "双一流" }[required];
  if (!records.length) return { status: "unknown", message: `岗位要求${label}院校，材料中没有相应院校信息。` };
  const meets = records.map(schoolTier).map((tier) => tier === "unknown" ? null : TIER_ORDER[tier] >= TIER_ORDER[required]);
  if (everyRecord ? meets.every((ok) => ok === true) : meets.some((ok) => ok === true)) return { status: "pass", message: `院校层次满足${label}要求。` };
  if (meets.includes(null)) return { status: "unknown", message: `岗位要求${label}院校，材料中的院校层次无法确认。` };
  return { status: "fail", message: `岗位要求${label}院校，材料中的院校层次不满足。` };
}

function qsResult(requiredRank, material) {
  const rank = String(material || "").match(/QS.{0,10}?(\d{1,4})/i);
  if (!rank) return { status: "unknown", message: `岗位接受QS前${requiredRank}院校，材料中没有QS排名。` };
  return Number(rank[1]) <= requiredRank
    ? { status: "pass", message: `院校QS排名${rank[1]}，满足前${requiredRank}要求。` }
    : { status: "fail", message: `岗位要求QS前${requiredRank}，材料中的院校QS排名为${rank[1]}。` };
}

function educationRecords(profile, material) {
  const records = (profile.education || []).map(compact).filter(Boolean);
  if (records.length) return records;
  return String(material || "").split(/\n+/).map(compact).filter((line) => /大学|学院|university|college/i.test(line)).slice(0, 4);
}

// Tier of one education record: a recognised school name, or the candidate's
// own explicit marker. 985 membership is definitive because that list is complete.
function schoolTier(record) {
  const named = (list) => list.some((name) => {
    const index = record.indexOf(name);
    return index >= 0 && !INDEPENDENT_COLLEGE_SUFFIX.test(record.slice(index + name.length));
  });
  if (named(SCHOOLS_985)) return "985";
  if (named(SCHOOLS_211)) return "211";
  if (/(?<!\d)985(?!\d)/.test(record)) return "985";
  if (/(?<!\d)211(?!\d)/.test(record)) return "211";
  if (/双一流/.test(record)) return "dfc";
  if (/双非|普通本科|二本|三本|专升本|独立学院/.test(record)) return "none";
  return "unknown";
}

function checkLanguage(text, material) {
  const required = languageRequirements(requirementClauses(text));
  if (!required.length) return null;
  const owned = languageEvidence(material);
  const results = required.map((item) => languageResult(item, owned));
  const source = evidence(required.map((item) => item.label).join(" / "));
  const failed = results.filter((item) => item.status === "fail");
  if (failed.length) return fail("language", failed.map((item) => item.message).join("；"), source);
  const open = results.filter((item) => item.status === "unknown");
  if (open.length) return unknown("language", open.map((item) => item.message).join("；"), source, `这个岗位有外语要求（${source}）——你有哪些外语证书或成绩（如六级分数、雅思/托福、日语等级）？`);
  return pass("language", results.map((item) => item.message).join("；"), source);
}

function languageRequirements(text) {
  const items = [];
  const cet6 = text.match(/(?:CET[-\s]?6|英语六级|大学英语六级)(?:.{0,6}?(\d{3})\s*分)?/i);
  if (cet6) items.push({ kind: "cet6", score: Number(cet6[1]) || 0, label: cet6[0] });
  else {
    const cet4 = text.match(/(?:CET[-\s]?4|英语四级|大学英语四级)(?:.{0,6}?(\d{3})\s*分)?/i);
    if (cet4) items.push({ kind: "cet4", score: Number(cet4[1]) || 0, label: cet4[0] });
  }
  const ielts = text.match(/(?:雅思|IELTS)\D{0,6}(\d(?:\.\d)?)/i);
  if (ielts) items.push({ kind: "ielts", score: Number(ielts[1]), label: ielts[0] });
  const toefl = text.match(/(?:托福|TOEFL)\D{0,6}(\d{2,3})/i);
  if (toefl) items.push({ kind: "toefl", score: Number(toefl[1]), label: toefl[0] });
  const jlpt = text.match(/(?:日语|JLPT)\s*N([1-5])/i);
  if (jlpt) items.push({ kind: "jlpt", score: Number(jlpt[1]), label: jlpt[0] });
  if (!items.some((item) => item.kind !== "jlpt") && /英语.{0,4}(?:流利|良好|熟练|读写|听说|口语)|英文.{0,4}(?:流利|读写|工作语言)|(?:fluent|proficient)\s+(?:in\s+)?english/i.test(text)) {
    items.push({ kind: "english", score: 0, label: "英语能力" });
  }
  // Exam names inside "英语六级或雅思6.5": any one route is enough.
  const alternatives = items.length > 1 && items.every((item) => item.kind !== "jlpt") && hasAlternative(text, items);
  return alternatives ? [{ kind: "any", options: items, label: items.map((item) => item.label).join("或") }] : items;
}

function hasAlternative(text, items) {
  return text.split(/\n/).some((line) => items.filter((item) => line.includes(item.label)).length > 1 && /或|\bor\b|\/|同等/i.test(line));
}

function languageEvidence(material) {
  const value = String(material || "");
  const score = (pattern) => { const match = value.match(pattern); return match ? Number(match[1]) || true : null; };
  return {
    cet6: score(/(?:CET[-\s]?6|英语六级|大学英语六级|六级)\D{0,6}(\d{3})?/i),
    cet4: score(/(?:CET[-\s]?4|英语四级|大学英语四级|四级)\D{0,6}(\d{3})?/i),
    ielts: score(/(?:雅思|IELTS)\D{0,6}(\d(?:\.\d)?)/i),
    toefl: score(/(?:托福|TOEFL)\D{0,6}(\d{2,3})/i),
    jlpt: score(/(?:日语|JLPT)\s*N([1-5])/i)
  };
}

function languageResult(item, owned) {
  if (item.kind === "any") {
    const results = item.options.map((option) => languageResult(option, owned));
    return results.find((result) => result.status === "pass") || results.find((result) => result.status === "unknown") || results[0];
  }
  const scored = (value, min, label, higherIsBetter = true) => {
    if (value === null) return null;
    if (value === true || !min) return { status: "pass", message: `材料包含${label}。` };
    const ok = higherIsBetter ? value >= min : value <= min;
    return ok ? { status: "pass", message: `${label}成绩${value}满足要求。` } : { status: "fail", message: `岗位要求${label}${higherIsBetter ? "≥" : "N"}${min}，材料成绩为${higherIsBetter ? "" : "N"}${value}。` };
  };
  const missing = (label) => ({ status: "unknown", message: `岗位要求${label}，材料中没有对应成绩。` });
  if (item.kind === "cet6") return scored(owned.cet6, item.score, "英语六级") || missing(item.label);
  if (item.kind === "cet4") return scored(owned.cet6, 0, "英语六级") || scored(owned.cet4, item.score, "英语四级") || missing(item.label);
  if (item.kind === "ielts") return scored(owned.ielts, item.score, "雅思") || missing(item.label);
  if (item.kind === "toefl") return scored(owned.toefl, item.score, "托福") || missing(item.label);
  if (item.kind === "jlpt") return scored(owned.jlpt, item.score, "日语", false) || missing(item.label);
  const anyEnglish = owned.cet6 ?? owned.cet4 ?? owned.ielts ?? owned.toefl;
  return anyEnglish !== null ? { status: "pass", message: "材料包含英语证书或成绩。" } : missing("英语能力");
}

// User exclusions are a veto on the job's title or company (not the whole JD,
// where "配合销售团队" would wrongly hide a data role). Charging candidates is
// rejected for everyone.
function checkExclusion(job, text, exclude = []) {
  const risk = RISK_PATTERNS.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  if (risk) return fail("exclusion", "岗位文本要求求职者缴费，疑似招聘风险。", evidence(risk));
  const terms = (Array.isArray(exclude) ? exclude : []).map(compact).filter(Boolean);
  if (!terms.length) return null;
  const target = lower(`${job.title || ""} ${job.company || ""}`);
  const hit = terms.find((term) => target.includes(term.toLowerCase()));
  if (hit) return fail("exclusion", `岗位标题或公司命中你设置的排除词「${hit}」。`, evidence(hit));
  return pass("exclusion", "未命中排除词。");
}

function requiredSkillGroups(text) {
  const groups = new Map();
  for (const { segment, section } of requirementSegments(text)) {
    if (section === "preferred" && !MANDATORY.test(segment)) continue;
    if (isPreferredSegment(segment)) continue;
    // Under a 任职要求 heading every listed skill is a requirement even
    // without 要求/熟悉 on the same line ("1. Java 基础扎实").
    if (section === "required" || /required|requires|must|need|掌握|熟悉|精通|要求|必须|硬性/i.test(segment)) {
      // Keep independent predicates separate, but preserve enumerated language
      // alternatives such as Java、Python中至少一种 rather than requiring both.
      const clauses=segment.split(/[，,](?=\s*(?:(?:同时|并且|还需|并|且|还应|也需)\s*)?(?:熟悉|掌握|精通|了解|具备|有)|[^，,]{0,35}(?:必须|要求|精通|掌握))|(?:同时|并且|还需|还应|也需|以及)(?=\s*(?:熟悉|掌握|精通|了解|具备|有))/);
      for(const clause of clauses) {
        if(/有兴趣|感兴趣|好奇|热情/.test(clause) && !/熟悉|掌握|精通|经验|必须|硬性/.test(clause)) continue;
        const skills=SKILL_LEXICON.filter(skill=>skill.aliases.some(alias=>hasExactTerm(clause,alias))).map(skill=>skill.term);
        if(!skills.length) continue;
        const count=clause.match(/([一二两三四1-4])(?:种|门)(?!项目|实践|经历)/)?.[1];
        const alternatives=!!count || /或者|或|之一|\b(?:one of|either|or)\b/i.test(clause);
        const ambiguous=alternatives && /及|和|\band\b/i.test(clause.replace(/及以上/g,'')) && !count;
        const minimum=count?({'一':1,'二':2,'两':2,'三':3,'四':4}[count]||Number(count)):alternatives?1:skills.length;
        const group={skills,minimum,ambiguous};groups.set(JSON.stringify(group),group);
      }
    }
  }
  return [...groups.values()];
}

function hasSkill(source, term) {
  const skill = SKILL_LEXICON.find((item) => item.term === term);
  return (skill ? skill.aliases : [term]).some((alias) => hasExactTerm(source, alias));
}

// Splits a JD into segments and tracks which heading each falls under, so a
// 加分项 block never turns its skills into hard requirements. A "." only ends
// a sentence when followed by whitespace, keeping Node.js / Vue.js intact.
function requirementSegments(text) {
  let section = null;
  const segments = [];
  for (const raw of String(text || "").split(/[;。；\n]|\.(?=\s|$)/)) {
    const segment = raw.trim();
    if (!segment) continue;
    const heading = segment.match(/^[\s\d.、()（）*#-]*(任职要求|岗位要求|任职资格|职位要求|基本要求|requirements|qualifications|minimum qualifications|basic qualifications|加分项|加分|优先条件|preferred qualifications|preferred|nice to have|bonus points?)\s*[:：]?/i);
    if (heading) section = PREFERRED.test(heading[1]) ? "preferred" : "required";
    segments.push({ segment, section });
  }
  return segments;
}

// Hard-requirement clauses only: a 加分项 section or a clause marked 优先 is
// dropped, so "本科及以上，985院校优先" never makes the school tier mandatory.
function requirementClauses(text) {
  return requirementSegments(text)
    .filter(({ section }) => section !== "preferred")
    .flatMap(({ segment }) => segment.split(/[，,]/))
    .filter((clause) => clause.trim() && !PREFERRED.test(clause))
    .join("\n");
}

function isPreferredSegment(segment) {
  return PREFERRED.test(segment) && !/required|must|必须|要求/i.test(segment.replace(/任职要求|岗位要求|职位要求/g, ""));
}

function hasExactTerm(text, term) {
  const escaped = escapeRegExp(term);
  if (/^[A-Za-z0-9+#. ]+$/.test(term)) {
    return new RegExp(`(?<![A-Za-z0-9+#.])${escaped}(?![A-Za-z0-9+#.])`, "i").test(text);
  }
  return String(text || "").includes(term);
}

function hasPositiveAuthorization(material) {
  const value = lower(material);
  const positivePatterns = [
    /\b(opt|cpt|h1b|h-1b)\b/i,
    /green card|citizen|authorized to work|work authorization|valid work permit/i,
    /绿卡|公民|合法工作许可|已有工作许可|具备工作授权|持有.*签证/
  ];
  return positivePatterns.some((pattern) => pattern.test(value));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function jobText(job) {
  return [
    job.title,
    job.company,
    job.description,
    ...(job.requirements || []),
    job.location,
    job.city,
    job.postingAge,
    job.deadline
  ].filter(Boolean).join("\n");
}

function profileText(profile) {
  return [
    ...(profile.education || []),
    ...(profile.skills || []),
    ...(profile.projects || []),
    ...(profile.experience || [])
  ].filter(Boolean).join("\n");
}

function pass(dimension, message, source = "") {
  return { dimension, status: "pass", message, evidence: source };
}

function fail(dimension, message, source = "") {
  return { dimension, status: "fail", message, evidence: source };
}

function unknown(dimension, message, source = "", question = null) {
  // A candidate-side gap (the material lacks info) carries a question so the Agent
  // can ask the user instead of parking the job in an unverifiable dead list.
  return { dimension, status: "unknown", message, evidence: source, ...(question ? { question } : {}) };
}

function summarize(status, failed, unknownChecks) {
  if (status === "rejected") return failed.map((check) => check.message).join("；");
  if (status === "verify") return unknownChecks.map((check) => check.message).join("；");
  return "硬性资格条件通过，可进入排序。";
}

function score(job, checks) {
  const base = Number(job.opportunityScore || job.matchScore || 70);
  const passCount = checks.filter((check) => check.status === "pass").length;
  return base + passCount;
}

function evidence(value) {
  return String(value || "");
}

function degreeLabel(value) {
  return { phd: "博士/PhD", master: "硕士/Master", bachelor: "本科/Bachelor", unknown: "未知学历" }[value] || "未知学历";
}

function typeLabel(value) {
  return { campus: "校招", internship: "实习", social: "社招" }[value] || value;
}
