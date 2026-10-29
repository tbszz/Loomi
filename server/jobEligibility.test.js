import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateJobEligibility, filterEligibleJobs, jobCareerSignals } from "./jobEligibility.js";

const eligibilityNow='2026-10-27T12:00:00Z';
const studentProfile={education:['某大学 计算机 本科 2023-2027'],skills:['Python'],experience:[]};
const experienceJob={title:'软件工程师',type:'campus',location:'北京',postingAge:'1d',description:'负责软件开发维护与系统优化，熟悉Python。',requirements:['熟悉Python']};

test('graduation ranges reject years outside their inclusive bounds',()=>{
  for(const cohort of ['24-26届','2024-2026届','24届-26届','2024~2026届']) {
    const result=evaluateJobEligibility({...experienceJob,title:`【探索者】智能语音测试工程师(${cohort})`},studentProfile);
    const check=result.checks.find(c=>c.dimension==='graduation');
    assert.equal(check.status,'fail',cohort);
    assert.equal(result.status,'rejected');
    assert.ok(check.message.includes(cohort),check.message);
  }
});

test('graduation ranges accept endpoints and intermediate years',()=>{
  for(const cohort of ['24-26届','2024-2026届','24届-26届','2024~2026届']) {
    for(const year of [2024,2025,2026]) {
      const profile={education:[`某大学 本科 毕业时间：${year}`]};
      const result=evaluateJobEligibility({...experienceJob,title:`测试工程师(${cohort})`},profile);
      assert.equal(result.checks.find(c=>c.dimension==='graduation').status,'pass',`${cohort} / ${year}`);
    }
  }
});

test('separate job cohorts are a set rather than candidate ambiguity or a range',()=>{
  for(const [year,status] of [[2026,'pass'],[2027,'pass'],[2025,'fail'],[2028,'fail']]) {
    const result=evaluateJobEligibility({...experienceJob,title:'开发工程师(2026届、2027届)'},{education:[`本科 ${year}年毕业`]});
    assert.equal(result.checks.find(c=>c.dimension==='graduation').status,status);
  }
  const result=evaluateJobEligibility({...experienceJob,title:'开发工程师(2024届、2026届)'},{education:['本科 2025年毕业']});
  assert.equal(result.checks.find(c=>c.dimension==='graduation').status,'fail');
});

test('candidate with two education records still needs graduation verification',()=>{
  const result=evaluateJobEligibility({...experienceJob,title:'开发工程师(24-26届)'},{education:['某大学 本科 2020-2024','某大学 硕士 2024-2027']});
  assert.equal(result.checks.find(c=>c.dimension==='graduation').status,'unknown');
});

test('graduation user statements require explicit first-person self-descriptions',()=>{
  const job={...experienceJob,title:'开发工程师(24-26届)'};
  for(const statement of ['我是27届','我27届','本人2027届','我是2027届本科生','我是27届软件工程本科','我2027年毕业','我预计2027年毕业','我是2027年应届生','27届的我']) {
    const result=evaluateJobEligibility(job,{}, {userStatements:[statement]});
    const graduation=result.checks.find(c=>c.dimension==='graduation');
    assert.equal(graduation.status,'fail',statement);
    assert.match(graduation.message,/自述的2027届/);
    assert.equal(result.status,'rejected',statement);
  }
});

test('graduation user statements ignore job cohorts and search requests',()=>{
  const job={...experienceJob,title:'开发工程师(2026届)'};
  for(const statement of ['帮我看看：面向2026届毕业生，本科及以上','面向2026届毕业生','岗位要求2026届','26届校招岗位','找27届的岗位','我想找27届的岗位','我明年毕业','2027年毕业']) {
    const result=evaluateJobEligibility(job,{}, {userStatements:[statement]});
    const graduation=result.checks.find(c=>c.dimension==='graduation');
    assert.equal(graduation.status,'unknown',statement);
    assert.match(graduation.message,/材料没有明确毕业年份/);
    assert.notEqual(result.status,'rejected',statement);
  }
});

test('graduation self-descriptions never span clauses or user messages',()=>{
  const job={...experienceJob,title:'开发工程师(2026届)'};
  for(const separator of ['。','；',';','，',',','\n']) {
    for(const statement of [`我是${separator}2027届`,`27届${separator}的我`]) {
      const result=evaluateJobEligibility(job,{}, {userStatements:[statement]});
      assert.match(result.checks.find(c=>c.dimension==='graduation').message,/材料没有明确毕业年份/,statement);
    }
  }
  const result=evaluateJobEligibility(job,{}, {userStatements:['我是','2027届']});
  assert.match(result.checks.find(c=>c.dimension==='graduation').message,/材料没有明确毕业年份/);
  const mixed=evaluateJobEligibility(job,{}, {userStatements:['我是27届，帮我看看：面向2026届毕业生，本科及以上']});
  assert.equal(mixed.checks.find(c=>c.dimension==='graduation').status,'fail');
});

test('graduation statements are fallback evidence and conflicting self-reports remain unknown',()=>{
  const job={...experienceJob,title:'开发工程师(2026届)'};
  const check=(profile,options)=>evaluateJobEligibility(job,profile,options).checks.find(c=>c.dimension==='graduation');
  assert.equal(check(studentProfile,{userStatements:['我是2026届']}).status,'fail','profile graduation takes precedence');
  assert.equal(check({education:['某大学 本科']},{userStatements:['我是27届']}).status,'fail','yearless education still uses user statement');
  assert.equal(check({},{userStatements:['我是26届','我是27届']}).status,'unknown');
  assert.equal(check({},{material:'我是27届'}).status,'unknown','unscoped material cannot supply chat evidence');
  assert.equal(check({},{userStatements:['项目时间2024-2027']}).status,'unknown','a general chat date range is not education');
  assert.equal(check({},{educationFacts:[{type:'education',value:'本科2027年毕业',status:'disputed'}]}).status,'unknown');
});

test('numbered JD experience minimums distinguish list markers from decimal years',()=>{
  for(const [requirement,years,status] of [
    ['硬技能基础： 1.计算机相关专业本科及以上学历。 2.3年以上Java服务端开发经验，精通Java生态。',3,'fail'],
    ['任职要求：3年以上Java服务端开发经验',3,'fail'],
    ['1.5年以上相关经验',1.5,'unknown'],
    ['2.3年以上相关经验',2.3,'unknown'],
    ['2.3年以上相关经验；1.本科学历',2.3,'unknown'],
    ['1.本科学历 2.1-3年经验',1,'unknown'],
    ['1、本科学历。2.3年以上工作经验',3,'fail'],
    ['9、本科学历。10.3年以上工作经验',3,'fail']
  ]) {
    const job={...experienceJob,requirements:[requirement,'熟悉Python']};
    const result=evaluateJobEligibility(job,studentProfile,{type:'campus',now:eligibilityNow});
    const check=result.checks.find(c=>c.dimension==='experience');
    assert.equal(check.status,status,requirement);
    assert.equal(result.status,status==='fail'?'rejected':'verify',requirement);
    assert.ok(check.message.includes(`至少${years}年`),check.message);
    assert.equal(jobCareerSignals(job).workExperienceRequirements[0].years,years,requirement);
  }
});

test('experience minimums bind with 以上 after experience or 及以上 after years',()=>{
  for(const requirement of ['本科以上学历，3年工作经验以上','3年相关经验以上','3年软件开发经验以上','3年及以上工作经验','3年及以上']) {
    const result=evaluateJobEligibility({...experienceJob,requirements:[requirement,'熟悉Python']},studentProfile,{type:'campus',now:eligibilityNow});
    const check=result.checks.find(c=>c.dimension==='experience');
    assert.equal(check.status,requirement==='3年及以上'?'unknown':'fail',requirement);
    if(requirement!=='3年及以上') {
      assert.equal(result.status,'rejected',requirement);
      assert.match(check.message,/至少3年/);
      assert.ok(check.evidence.includes(requirement.split('，').at(-1)));
    }
  }
});

test('preferred experience minimums stay non-binding in either word order',()=>{
  for(const requirement of ['5年及以上工作经验优先','3年工作经验以上优先','3年开发经验以上 preferred','3年相关经验以上 is a plus']) {
    const result=evaluateJobEligibility({...experienceJob,requirements:[requirement,'熟悉Python']},studentProfile,{type:'campus',now:eligibilityNow});
    assert.equal(result.checks.find(c=>c.dimension==='experience').status,'pass',requirement);
    assert.notEqual(result.status,'rejected',requirement);
  }
});

test('campus students fail substantial work minimums with auditable evidence, never counting internships',()=>{
  for(const requirement of ['3年以上工作经验','5年及以上工作经验','3-5年产品经验','3+ years of full-time work experience required']) {
    for(const experience of [[],['4年软件开发实习经验'],['2022.01-2026.09 软件开发实习'],['Internship: 2022.01-2026.09 software developer']]) {
      const result=evaluateJobEligibility({...experienceJob,requirements:[requirement,'熟悉Python']},{...studentProfile,experience},{type:'campus',now:eligibilityNow});
      const check=result.checks.find(c=>c.dimension==='experience');
      assert.equal(check.status,'fail',`${requirement} / ${experience}`);
      assert.equal(result.status,'rejected');
      assert.match(check.message,/在读|学生/);
      assert.match(check.message,/全职/);
      assert.ok(check.evidence.includes(requirement));
      assert.ok(check.evidence.includes('2023-2027'));
    }
  }
});

test('student inference uses the current year and does not reject short or optional experience requirements',()=>{
  for(const education of ['某大学 本科 2022-2026','某大学 本科 预计毕业2027年','某大学 本科 2023.09-2027.06']) {
    for(const requirement of ['1年以上工作经验','2年以上产品经验']) {
      const result=evaluateJobEligibility({...experienceJob,requirements:[requirement,'熟悉Python']},{...studentProfile,education:[education]},{type:'campus',now:eligibilityNow});
      assert.equal(result.checks.find(c=>c.dimension==='experience').status,'unknown');
      assert.equal(result.status,'verify');
    }
  }
  for(const requirement of ['3年以上工作经验优先','3年以上实习经验','3年项目经验']) {
    const result=evaluateJobEligibility({...experienceJob,requirements:[requirement,'熟悉Python']},studentProfile,{type:'campus',now:eligibilityNow});
    assert.notEqual(result.checks.find(c=>c.dimension==='experience').status,'fail',requirement);
  }
  const experienced={...studentProfile,experience:['5年软件开发全职工作经验']};
  assert.equal(evaluateJobEligibility({...experienceJob,requirements:['3年以上工作经验','熟悉Python']},experienced,{type:'campus',now:eligibilityNow}).checks.find(c=>c.dimension==='experience').status,'pass');
});

test('substantial professional requirements ignore internships outside campus searches too',()=>{
  const job={...experienceJob,type:'social',requirements:['3年以上软件开发经验','熟悉Python']};
  for(const experience of [['4年软件开发实习经验'],['2021.01-2026.09 软件开发实习，参与平台研发']]) {
    const result=evaluateJobEligibility(job,{education:['某大学 本科 2016-2020'],skills:['Python'],experience},{type:'social',now:eligibilityNow});
    const check=result.checks.find(c=>c.dimension==='experience');
    assert.equal(check.status,'unknown');
    assert.equal(result.status,'verify');
    assert.match(check.question,/全职/);
    assert.doesNotMatch(check.question,/实习也算/);
  }
});

test('experience ranges use their lower bound even with a plus suffix',()=>{
  for(const [requirement,status] of [['1-3+年工作经验','unknown'],['3-5+年工作经验','fail'],['3年以上项目管理经验','fail']]) {
    const result=evaluateJobEligibility({...experienceJob,requirements:[requirement,'熟悉Python']},studentProfile,{type:'campus',now:eligibilityNow});
    assert.equal(result.checks.find(c=>c.dimension==='experience').status,status,requirement);
  }
});

test('senior titles without extracted experience requirements remain verify',()=>{
  for(const title of ['资深开发工程师','高级开发工程师','算法专家','技术负责人','Senior Software Engineer','Staff Engineer']) {
    const result=evaluateJobEligibility({...experienceJob,title},studentProfile,{type:'campus',now:eligibilityNow});
    assert.equal(result.status,'verify',title);
    const check=result.checks.find(c=>c.dimension==='experience');
    assert.equal(check.status,'unknown');
    assert.ok(check.evidence.includes(title));
  }
});

test('experienced social candidates are rejected by explicit graduate-only titles even with missing or conflicting type',()=>{
  const experienced={education:['某大学 本科 2016-2020'],skills:['Python'],experience:['5年全职软件开发经验']};
  for(const [title,type] of [['开发工程师','campus'],['开发工程师','internship'],['后端校招工程师',null],['应届软件开发','social'],['软件开发实习',null]]) {
    const result=evaluateJobEligibility({...experienceJob,title,type},experienced,{type:'social',now:eligibilityNow});
    const check=result.checks.find(c=>c.dimension==='job_type');
    assert.equal(result.status,'rejected',title);
    assert.equal(check.status,'fail');
    assert.match(check.message,/校招|应届|实习/);
    assert.ok(check.evidence);
  }
  const internshipOnly={...experienced,experience:['5年软件开发实习经验']};
  assert.equal(evaluateJobEligibility({...experienceJob,title:'应届软件开发',type:null},internshipOnly,{type:'social',now:eligibilityNow}).checks.find(c=>c.dimension==='job_type').status,'unknown');
});

await test('international country metadata also requires work-authorization evidence',()=>{
  const result=evaluateJobEligibility({title:'AI Intern',location:'Paris',country:'France',type:'internship',description:'Develop machine learning systems and evaluation tooling.',requirements:['Python'],postingAge:'1d'},
    {education:['某大学本科'],skills:['Python']},{region:'overseas',material:'某大学本科 Python'});
  assert.equal(result.checks.find(check=>check.dimension==='region').status,'pass');
  assert.equal(result.checks.find(check=>check.dimension==='work_authorization').status,'unknown');
});

await test('recent official listing proves observed openness without inventing a publication date; partial JD remains unknown',()=>{
  const now='2026-10-12T00:00:00Z';
  const job={source:'official-career-site',type:'internship',location:'北京',title:'软件开发实习',
    description:'负责软件系统开发、系统测试以及平台性能优化工作。',requirements:['计算机相关专业'],
    fullDescriptionVerified:true,officialListingVerifiedAt:Date.parse(now)};
  const checks=evaluateJobEligibility(job,{}, {now}).checks;
  assert.equal(checks.find(c=>c.dimension==='freshness').status,'pass');
  assert.equal(evaluateJobEligibility({...job,fullDescriptionVerified:false},{},{now}).checks.find(c=>c.dimension==='source_completeness').status,'unknown');
  assert.equal(evaluateJobEligibility({...job,officialListingVerifiedAt:Date.parse(now)-8*86400000},{},{now}).checks.find(c=>c.dimension==='freshness').status,'unknown');
});

const bachelorProfile = {
  education: ["华东某大学 计算机科学 本科 2022-2026"],
  skills: ["React", "TypeScript", "Python", "FastAPI", "PostgreSQL", "Git"],
  projects: ["校园岗位助手：使用 React、TypeScript 和 FastAPI 开发岗位搜索与收藏系统。"],
  experience: ["某软件公司 前端实习：参与后台表单组件开发和接口联调。"]
};

const material = [
  "张三",
  "华东某大学 计算机科学 本科 2022-2026",
  "校园岗位助手：使用 React、TypeScript 和 FastAPI 开发岗位搜索与收藏系统。",
  "某软件公司 前端实习：参与后台表单组件开发和接口联调。",
  "技能栈 React TypeScript Python FastAPI PostgreSQL Git"
].join("\n");

await test("rejects PhD-only internships for a bachelor profile", () => {
  const result = evaluateJobEligibility({
    id: "phd-ai",
    title: "Machine Learning PhD Intern",
    description: "Must be enrolled in a PhD program. Internship for PhD students.",
    requirements: ["PhD required"],
    type: "internship",
    location: "United States",
    postingAge: "1d",
    matchScore: 95
  }, bachelorProfile, { material, type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(result.status, "rejected");
  assert.equal(result.checks.some((check) => check.dimension === "education" && check.status === "fail"), true);
  assert.match(result.reason, /博士|PhD/);
});

await test("keeps overseas work authorization as verify when candidate material is silent", () => {
  const result = evaluateJobEligibility({
    id: "us-fe",
    title: "Frontend Intern",
    description: "Applicants must already have US work authorization. No visa sponsorship.",
    requirements: ["US work authorization required"],
    type: "internship",
    location: "New York, NY",
    postingAge: "2d",
    matchScore: 88
  }, bachelorProfile, { material, type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(result.status, "verify");
  assert.equal(result.checks.some((check) => check.dimension === "work_authorization" && check.status === "unknown"), true);
});

await test("rejects expired or closed jobs", () => {
  const result = evaluateJobEligibility({
    id: "closed-fe",
    title: "Frontend Intern",
    description: "Applications closed. Deadline: 2026-08-01.",
    requirements: ["React"],
    type: "internship",
    location: "上海",
    matchScore: 88
  }, bachelorProfile, { material, type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(result.status, "rejected");
  assert.equal(result.checks.some((check) => check.dimension === "freshness" && check.status === "fail"), true);
});

await test("rejects explicit major mismatch and keeps only passed jobs in recommendation list", () => {
  const jobs = [
    {
      id: "marketing",
      title: "市场营销管培生",
      description: "硬性要求：市场营销、广告学相关专业。",
      requirements: ["市场营销专业"],
      type: "campus",
      location: "上海",
      postingAge: "1d",
      matchScore: 91
    },
    {
      id: "react",
      title: "前端开发工程师（校招）",
      description: "计算机相关专业，掌握 React、TypeScript、Git。",
      requirements: ["React", "TypeScript", "Git"],
      type: "campus",
      location: "上海",
      postingAge: "1d",
      matchScore: 86
    },
    {
      id: "auth",
      title: "Frontend Intern",
      description: "US work authorization required.",
      requirements: ["React"],
      type: "internship",
      location: "United States",
      postingAge: "1d",
      matchScore: 95
    }
  ];
  const result = filterEligibleJobs(jobs, bachelorProfile, { material, type: "campus", now: "2026-09-08T00:00:00.000Z" });

  assert.deepEqual(result.jobs.map((job) => job.id), ["react"]);
  assert.deepEqual(result.rejected.map((job) => job.id), ["marketing", "auth"]);
  assert.equal(result.jobs[0].eligibility.status, "passed");
  assert.equal(result.uncertainties.length, 0);
});

await test("does not reject PhD preference when bachelor or master is accepted", () => {
  const result = evaluateJobEligibility({
    id: "research",
    title: "AI Research Intern",
    description: "Bachelor or Master students accepted. PhD preferred. React and TypeScript required.",
    requirements: ["Bachelor or Master", "PhD preferred", "React", "TypeScript"],
    type: "internship",
    location: "上海",
    postingAge: "1d",
    matchScore: 84
  }, bachelorProfile, { material, type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.notEqual(result.status, "rejected");
  assert.equal(result.checks.some((check) => check.dimension === "education" && check.status === "fail"), false);
});

await test("keeps unknown education as verify instead of guessing bachelor from computer words", () => {
  const result = evaluateJobEligibility({
    id: "bachelor-required",
    title: "Frontend Intern",
    description: "Bachelor degree required. React and TypeScript required.",
    requirements: ["Bachelor required", "React", "TypeScript"],
    type: "internship",
    location: "上海",
    postingAge: "1d",
    matchScore: 80
  }, { ...bachelorProfile, education: ["计算机课程项目经历"] }, { material: "计算机课程项目经历\nReact TypeScript", type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(result.status, "verify");
  assert.equal(result.checks.some((check) => check.dimension === "education" && check.status === "unknown"), true);
});

await test("compares explicit experience years and does not treat dates as years of experience", () => {
  const tooJunior = evaluateJobEligibility({
    id: "senior",
    title: "Frontend Engineer",
    description: "5+ years frontend experience required. React and TypeScript required.",
    requirements: ["5+ years experience", "React", "TypeScript"],
    type: "social",
    location: "上海",
    postingAge: "1d",
    matchScore: 80
  }, { ...bachelorProfile, experience: ["2年 前端开发经验"] }, { material: `${material}\n2年 前端开发经验`, type: "social", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(tooJunior.status, "rejected");
  assert.equal(tooJunior.checks.some((check) => check.dimension === "experience" && check.status === "fail"), true);

  const dateOnly = evaluateJobEligibility({
    id: "mid",
    title: "Frontend Engineer",
    description: "3+ years frontend experience required. React and TypeScript required.",
    requirements: ["3+ years experience", "React", "TypeScript"],
    type: "social",
    location: "上海",
    postingAge: "1d",
    matchScore: 80
  }, bachelorProfile, { material: `${material}\n2025年7月至9月 某软件公司 前端实习`, type: "social", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(dateOnly.status, "verify");
  assert.equal(dateOnly.checks.some((check) => check.dimension === "experience" && check.status === "unknown"), true);
});

await test("marks overseas locations as verify without positive authorization and rejects explicit no visa material", () => {
  const remoteUs = {
    id: "remote-us",
    title: "Frontend Intern",
    description: "React and TypeScript required.",
    requirements: ["React", "TypeScript"],
    type: "internship",
    location: "Remote US",
    postingAge: "1d",
    matchScore: 82
  };

  const unknownAuth = evaluateJobEligibility(remoteUs, bachelorProfile, { material, type: "internship", now: "2026-09-08T00:00:00.000Z" });
  assert.equal(unknownAuth.status, "verify");
  assert.equal(unknownAuth.checks.some((check) => check.dimension === "work_authorization" && check.status === "unknown"), true);

  const noVisa = evaluateJobEligibility(remoteUs, bachelorProfile, { material: `${material}\n目前没有签证或海外工作许可`, type: "internship", now: "2026-09-08T00:00:00.000Z" });
  assert.equal(noVisa.status, "rejected");
  assert.equal(noVisa.checks.some((check) => check.dimension === "work_authorization" && check.status === "fail"), true);
});

await test("keeps zero-hit required skills as verify with a follow-up question and partial required skills as verify", () => {
  const noGo = evaluateJobEligibility({
    id: "go",
    title: "Go Backend Intern",
    description: "Go required. PostgreSQL preferred.",
    requirements: ["Go required"],
    type: "internship",
    location: "上海",
    postingAge: "1d",
    matchScore: 80
  }, { ...bachelorProfile, skills: ["Google Analytics", "JavaScript"] }, { material: "Google Analytics JavaScript email", type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(noGo.status, "verify");
  const zeroHit = noGo.checks.find((check) => check.dimension === "skills");
  assert.equal(zeroHit.status, "unknown");
  assert.ok(zeroHit.question, "zero-hit skills must ask the user instead of disqualifying the job");

  const partial = evaluateJobEligibility({
    id: "react-ts",
    title: "Frontend Intern",
    description: "React and TypeScript required.",
    requirements: ["React", "TypeScript"],
    type: "internship",
    location: "上海",
    postingAge: "1d",
    matchScore: 80
  }, { ...bachelorProfile, skills: ["React"], projects: [], experience: [] }, { material: "React", type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(partial.status, "verify");
  assert.equal(partial.checks.some((check) => check.dimension === "skills" && check.status === "unknown"), true);
});

await test("keeps incomplete aggregator records as verify even when title matches", () => {
  const result = evaluateJobEligibility({
    id: "title-only",
    title: "Frontend Intern",
    type: "internship",
    location: "上海",
    matchScore: 88
  }, bachelorProfile, { material, type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(result.status, "verify");
  assert.equal(result.checks.some((check) => check.dimension === "source_completeness" && check.status === "unknown"), true);
  assert.equal(result.checks.some((check) => check.dimension === "freshness" && check.status === "unknown"), true);
});

await test("keeps GitHub adapter metadata-only records as verify and ignores fetchedAt as freshness proof", () => {
  const result = evaluateJobEligibility({
    id: "github-summary",
    source: "github-job-source",
    title: "Frontend Intern",
    description: "Acme 校招/New Grad岗位。 岗位：Frontend Intern 地点：Remote US 来源仓库：https://github.com/example/jobs",
    requirements: ["来源：2026 SWE College Jobs", "岗位类型：实习/Intern", "地点：Remote US"],
    type: "internship",
    location: "Remote US",
    updatedAt: "2026-09-08T00:00:00.000Z",
    matchScore: 90
  }, bachelorProfile, { material, type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(result.status, "verify");
  assert.equal(result.checks.some((check) => check.dimension === "source_completeness" && check.status === "unknown"), true);
  assert.equal(result.checks.some((check) => check.dimension === "freshness" && check.status === "unknown"), true);
});

await test("marks PhD internship titles as education verification when hard requirement is not explicit", () => {
  const result = evaluateJobEligibility({
    id: "phd-title",
    title: "Data Science: AI Experiences PhD Internship",
    description: "Work on AI experiences with Python.",
    requirements: ["Python"],
    type: "internship",
    location: "上海",
    postingAge: "1d",
    matchScore: 86
  }, bachelorProfile, { material, type: "internship", now: "2026-09-08T00:00:00.000Z" });

  assert.equal(result.status, "verify");
  assert.equal(result.checks.some((check) => check.dimension === "education" && check.status === "unknown"), true);
});

await test("passes matching marketing major and keeps unknown major as verify", () => {
  const marketing = evaluateJobEligibility({
    id: "marketing-ok",
    title: "市场营销管培生",
    description: "硬性要求：市场营销、广告学相关专业。要求掌握SQL。",
    requirements: ["市场营销专业", "SQL"],
    type: "campus",
    location: "上海",
    postingAge: "1d",
    matchScore: 75
  }, { education: ["某大学 市场营销 本科 2022-2026"], skills: ["SQL"], projects: [], experience: [] }, { material: "某大学 市场营销 本科 2022-2026\nSQL", type: "campus", now: "2026-09-08T00:00:00.000Z" });
  assert.equal(marketing.status, "passed");

  const unknown = evaluateJobEligibility({
    id: "marketing-unknown",
    title: "市场营销管培生",
    description: "硬性要求：市场营销、广告学相关专业。要求掌握SQL。",
    requirements: ["市场营销专业", "SQL"],
    type: "campus",
    location: "上海",
    postingAge: "1d",
    matchScore: 75
  }, { education: ["某大学 本科 2022-2026"], skills: ["SQL"], projects: [], experience: [] }, { material: "某大学 本科 2022-2026\nSQL", type: "campus", now: "2026-09-08T00:00:00.000Z" });
  assert.equal(unknown.status, "verify");
  assert.equal(unknown.checks.some((check) => check.dimension === "major" && check.status === "unknown"), true);
});

const check = (job, profile, options, dimension) => evaluateJobEligibility(job, profile, options).checks.find((item) => item.dimension === dimension);
const cnJob = (description, extra = {}) => ({ title: "后端开发实习", company: "某科技公司", location: "北京", type: "internship", description, ...extra });

await test("skill lexicon recognises aliases and keeps 加分项 skills optional", () => {
  const job = cnJob("任职要求：\n1. Java 基础扎实，熟悉 Spring Boot\n2. 了解 MySQL、Redis\n加分项：\n1. 熟悉 Kafka、Flink");
  const result = check(job, { skills: ["Java", "SpringBoot", "MySQL", "Redis"] }, {}, "skills");
  assert.equal(result.status, "pass");
  assert.doesNotMatch(result.message, /Kafka|Flink/);
  const missing = check(job, { skills: ["Java"] }, {}, "skills");
  assert.equal(missing.status, "unknown");
  assert.match(missing.message, /Spring/);
  assert.equal(check(cnJob("要求熟悉 Node.js 与 Vue3"), { skills: ["NodeJS", "Vue.js"] }, {}, "skills").status, "pass");
  assert.equal(check(cnJob("要求有大模型应用开发经验"), { skills: ["LLM"] }, {}, "skills").status, "pass");
});

await test("school tier: required tiers check recognised schools; 优先 never becomes a gate", () => {
  const job = cnJob("任职要求：985/211院校本科及以上学历");
  assert.equal(check(job, { education: ["浙江大学 计算机 本科"] }, {}, "school_tier").status, "pass");
  assert.equal(check(job, { education: ["北京邮电大学 软件工程 本科"] }, {}, "school_tier").status, "pass");
  assert.equal(check(job, { education: ["某学院 双非本科"] }, {}, "school_tier").status, "fail");
  const unrecognised = check(job, { education: ["某某理工大学 本科"] }, {}, "school_tier");
  assert.equal(unrecognised.status, "unknown");
  assert.ok(unrecognised.question);
  assert.equal(check(cnJob("任职要求：985院校"), { education: ["北京邮电大学 本科"] }, {}, "school_tier").status, "fail");
  assert.equal(check(cnJob("任职要求：985院校"), { education: ["浙江大学城市学院 本科"] }, {}, "school_tier").status, "unknown");
  assert.equal(check(cnJob("本科及以上学历，985/211院校优先"), { education: ["某学院 双非本科"] }, {}, "school_tier"), undefined);
  const firstDegree = cnJob("任职要求：第一学历为211及以上");
  assert.equal(check(firstDegree, { education: ["某学院 双非 本科", "浙江大学 硕士"] }, {}, "school_tier").status, "fail");
  assert.equal(check(cnJob("任职要求：985/211或QS前100院校"), { education: ["University of Edinburgh 硕士"] }, { material: "University of Edinburgh QS 27" }, "school_tier").status, "pass");
});

await test("language: certificates and scores are compared, alternatives accepted", () => {
  assert.equal(check(cnJob("任职要求：英语六级"), {}, { material: "CET-6 520" }, "language").status, "pass");
  assert.equal(check(cnJob("任职要求：英语六级500分以上"), {}, { material: "CET-6 450" }, "language").status, "fail");
  assert.equal(check(cnJob("任职要求：英语四级"), {}, { material: "英语六级" }, "language").status, "pass");
  assert.equal(check(cnJob("任职要求：英语六级"), {}, { material: "无证书" }, "language").status, "unknown");
  assert.equal(check(cnJob("任职要求：英语六级或雅思6.5"), {}, { material: "IELTS 7.0" }, "language").status, "pass");
  assert.equal(check(cnJob("任职要求：雅思6.5"), {}, { material: "雅思 6.0" }, "language").status, "fail");
  assert.equal(check(cnJob("任职要求：日语N2"), {}, { material: "JLPT N1" }, "language").status, "pass");
  assert.equal(check(cnJob("英语六级优先"), {}, { material: "" }, "language"), undefined);
});

await test("exclusion: user keywords veto title/company only; fee demands are always rejected", () => {
  const sales = { ...cnJob("负责客户拓展"), title: "大客户销售实习" };
  assert.equal(evaluateJobEligibility(sales, {}, { exclude: ["销售"] }).status, "rejected");
  assert.equal(check(cnJob("配合销售团队完成数据分析"), {}, { exclude: ["销售"] }, "exclusion").status, "pass");
  assert.equal(check(cnJob("配合销售团队完成数据分析"), {}, {}, "exclusion"), undefined);
  assert.equal(check(cnJob("入职需缴纳培训费2000元"), {}, {}, "exclusion").status, "fail");
  assert.equal(check(cnJob("公司无需缴纳任何押金"), {}, {}, "exclusion"), undefined);
});

await test("experience years are summed from dated entries without double counting overlaps", () => {
  const job = cnJob("要求1年以上工作经验");
  const now = "2026-10-01T00:00:00Z";
  const enough = check(job, { experience: ["A公司 2024.07-2025.03 后端实习", "B公司 2025年1月 - 2025年8月 开发实习"] }, { now }, "experience");
  assert.equal(enough.status, "pass");
  assert.match(enough.message, /1\.2年/);
  assert.equal(check(job, { experience: ["A公司 2026.03-至今 实习"] }, { now }, "experience").status, "fail");
  assert.equal(check(job, { experience: ["A公司 2023-2024 实习"] }, { now }, "experience").status, "unknown");
  assert.equal(check(job, { experience: ["A公司 3年工作经验 2026.03-至今"] }, { now }, "experience").status, "pass");
});
