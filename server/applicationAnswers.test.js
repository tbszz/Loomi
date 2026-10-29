import assert from 'node:assert/strict';
import { test } from 'node:test';

await test('Agent field drafts reuse education evidence without inventing missing degree or identity', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [
    { id: 'degree', label: '学历', type: 'custom-select' },
    { id: 'school', label: '学校', section: '教育经历', row: 'r0', recordIndex: 0, type: 'text' },
    { id: 'id', label: '身份证号', type: 'text' }
  ];
  const facts = [...Array.from({ length: 40 }, (_, i) => ({ id: `project-${i}`, type: 'project', value: '实现项目功能', sourceQuote: '实现项目功能', status: 'user_asserted' })), { id: 'edu', type: 'education', value: '郑州轻工业大学 | 软件工程 | 本科', sourceQuote: '郑州轻工业大学 | 软件工程 | 本科', status: 'user_asserted' }];
  const result = await prepareApplicationAnswers({ fields, facts, drafts: [
    { fieldId: 'degree', value: '本科', factIds: ['edu'] },
    { fieldId: 'school', value: '郑州轻工业大学', factIds: ['edu'] },
    { fieldId: 'id', value: '110101199001011234', factIds: ['edu'] }
  ] });
  assert.deepEqual(result.answers.map(item => [item.fieldId, item.value]), [['degree', '本科'], ['school', '郑州轻工业大学']]);
  assert.ok(result.answers.every(item => item.factIds.includes('edu')));
  assert.equal(result.skipped.find(item => item.fieldId === 'id').status, 'missing');
  const wrong = await prepareApplicationAnswers({ fields, facts, drafts: [{ fieldId: 'degree', value: '硕士', factIds: ['edu'] }] });
  assert.equal(wrong.answers.length, 0);
});

await test('portal preferences and boolean declarations use explicit profiles and keep missing values missing', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = ['意向岗位大类','意向岗位','意向团队','是否接受岗位调剂','学位','学号','籍贯','出生年月','是否内推','内推码','是否有实习经历','您在什么渠道了解到招聘消息'].map((label,i) => ({ id: String(i), label, type: /是否/.test(label) ? 'jiandaoyun-radio' : 'text', options: [{ value: '是', label: '是' }, { value: '否', label: '否' }] }));
  const profile = { preferredRoleCategory: '研发类', preferredRoles: '前端开发工程师', preferredTeams: 'AI中心', acceptRoleAdjustment: false, degreeName: '工学学士', studentNumber: '20240001', nativePlace: '河南', birthDate: '2003-04', referred: false, recruitmentChannel: '学校就业网' };
  const result = await prepareApplicationAnswers({ fields, profile });
  assert.deepEqual(result.answers.map(item => [item.fieldId,item.value]), [['0','研发类'],['1','前端开发工程师'],['2','AI中心'],['3','否'],['4','工学学士'],['5','20240001'],['6','河南'],['7','2003-04'],['8','否'],['11','学校就业网']]);
  assert.deepEqual(result.skipped.map(item => item.fieldId), ['9','10']);
});

await test('a project fact cannot become a club responsibility without a confirmed club record', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const result = await prepareApplicationAnswers({ fields: [{ id: 'club-description', label: '工作描述', section: '社团干部经历', type: 'textarea' }], facts: [{ id: 'project', type: 'project', value: '开发校园项目', sourceQuote: '开发校园项目', status: 'verified' }], drafts: [{ fieldId: 'club-description', value: '开发校园项目', factIds: ['project'] }] });
  assert.equal(result.answers.length, 0);
  assert.equal(result.skipped[0].status, 'missing');
});

await test('answers use explicit profiles and grounded facts, never guess missing preferences', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [{ id: 'n', label: '姓名', type: 'text', occupied: false }, { id: 's', label: '期望薪资', type: 'text', occupied: false }, { id: 'd', label: '到岗时间', type: 'date', occupied: false }, { id: 'p', label: '身份证号', type: 'text', occupied: false }, { id: 'o', label: '项目介绍', type: 'textarea', occupied: false }];
  const facts = [{ id: 'f1', type: 'project', value: '参与 React 表单组件开发', sourceQuote: '参与 React 表单组件开发', status: 'user_asserted' }];
  const result = await prepareApplicationAnswers({ fields, profile: { name: '张三', identityNumber: '110101199001011234' }, facts, answerModel: async state => {
    assert.ok(!JSON.stringify(state).includes('110101199001011234'));
    return [{ fieldId: 'o', value: '参与 React 表单组件开发', factIds: ['f1'] }];
  } });
  assert.equal(result.answers.find(a => a.fieldId === 'n').value, '张三');
  assert.equal(result.answers.find(a => a.fieldId === 'p').value, '110101199001011234');
  assert.ok(!result.answers.some(a => ['s', 'd'].includes(a.fieldId)));
  assert.equal(result.answers.find(a => a.fieldId === 'o').value, facts[0].value);
  const bad = await prepareApplicationAnswers({ fields: fields.slice(-1), profile: {}, facts, answerModel: async () => [{ fieldId: 'o', value: '独立负责 Kubernetes 平台，提升30%', factIds: ['f1'] }] });
  assert.equal(bad.answers.length, 0);
});

await test('open-answer input is bounded and never truncates evidence into proof', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = Array.from({ length: 12 }, (_, i) => ({ id: `open-${i}`, label: '自我介绍', type: 'textarea' }));
  const facts = [{ id: 'huge', type: 'project', value: 'x'.repeat(5000), status: 'verified' }, ...Array.from({ length: 40 }, (_, i) => ({ id: `f-${i}`, type: 'project', value: '参与项目开发', sourceQuote: '参与项目开发', status: 'verified' }))];
  const result = await prepareApplicationAnswers({ fields, facts, answerModel: async state => { assert.equal(state.fields.length, 8); assert.ok(state.facts.length <= 32); assert.ok(!state.facts.some(fact => fact.id === 'huge')); return []; } });
  assert.equal(result.skipped.length, 12);
  assert.equal(result.skipped.filter(item => item.status === 'manual_required').length, 4);
});

await test('record answers align sparse repeated rows by stable row identity', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [
    { id: 'edu0-school', label: '学校', section: '教育经历', row: 'education-row-0', type: 'text' },
    { id: 'edu1-school', label: '学校', section: '教育经历', row: 'education-row-1', type: 'text' },
    { id: 'edu1-major', label: '专业', section: '教育经历', row: 'education-row-1', type: 'text' }
  ];
  const profile = { education: [{ school: '本科大学', major: '计算机科学' }, { school: '硕士大学', major: '人工智能' }] };
  const result = await prepareApplicationAnswers({ fields, profile });

  assert.equal(result.answers.find(item => item.fieldId === 'edu0-school').value, '本科大学');
  assert.equal(result.answers.find(item => item.fieldId === 'edu1-school').value, '硕士大学');
  assert.equal(result.answers.find(item => item.fieldId === 'edu1-major').value, '人工智能');
});

await test('record answers fail closed when repeated rows have no stable row identity', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [
    { id: 'edu-school-a', label: '学校', section: '教育经历', type: 'text' },
    { id: 'edu-school-b', label: '学校', section: '教育经历', type: 'text' },
    { id: 'edu-major', label: '专业', section: '教育经历', type: 'text' }
  ];
  const profile = { education: [{ school: '本科大学', major: '计算机科学' }, { school: '硕士大学', major: '人工智能' }] };
  const result = await prepareApplicationAnswers({ fields, profile });

  assert.deepEqual(result.answers, []);
  assert.deepEqual(result.skipped.map(item => [item.fieldId, item.status]), [
    ['edu-school-a', 'manual_required'],
    ['edu-school-b', 'manual_required'],
    ['edu-major', 'manual_required']
  ]);
});

await test('record answers prefer explicit record index over visible row order', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [
    { id: 'edu1-major', label: '专业', section: '教育经历', row: 'opaque-visible-row', recordIndex: 1, type: 'text' }
  ];
  const profile = { education: [{ major: '计算机科学' }, { major: '人工智能' }] };
  const result = await prepareApplicationAnswers({ fields, profile });

  assert.equal(result.answers.find(item => item.fieldId === 'edu1-major').value, '人工智能');
});

await test('record answers fail closed for ambiguous duplicate properties inside one stable row', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [
    { id: 'edu-school-a', label: '学校', section: '教育经历', row: 'same-row', recordIndex: 0, type: 'text' },
    { id: 'edu-school-b', label: '学校', section: '教育经历', row: 'same-row', recordIndex: 0, type: 'text' },
    { id: 'edu-major', label: '专业', section: '教育经历', row: 'same-row', recordIndex: 0, type: 'text' }
  ];
  const profile = { education: [{ school: '本科大学', major: '计算机科学' }] };
  const result = await prepareApplicationAnswers({ fields, profile });

  assert.deepEqual(result.answers, []);
  assert.deepEqual(result.skipped.map(item => [item.fieldId, item.status]), [
    ['edu-school-a', 'manual_required'],
    ['edu-school-b', 'manual_required'],
    ['edu-major', 'manual_required']
  ]);
});

await test('Jev classifies an unfamiliar public field but cannot create its profile value', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  let calls = 0;
  const decisionClient = async request => {
    calls++;
    assert.ok(!JSON.stringify(request).includes('本科'));
    return { model: 'jev-fixture', answers: { field_0: { type: 'choice', choice: 'degree', confidence: .95, probabilities: { degree: .99, none: .01 } } } };
  };
  const result = await prepareApplicationAnswers({ fields: [{ id: 'degree', label: '教育程度', type: 'text' }], profile: { degree: '本科' }, decisionClient });
  assert.equal(calls, 1);
  assert.equal(result.answers[0].value, '本科');
  assert.equal(result.realJevCalled, true);
  assert.equal(result.decisionRuntime, 'jev-latest');
  const missing = await prepareApplicationAnswers({ fields: [{ id: 'degree', label: '教育程度', type: 'text' }], profile: {}, decisionClient });
  assert.equal(calls, 1);
  assert.equal(missing.answers.length, 0);
});

await test('simple field matching uses English token boundaries instead of substrings', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [
    { id: 'lately-company', name: 'latelyWorkCompany', type: 'text' },
    { id: 'lately-department', name: 'latelyWorkDepartment', type: 'text' },
    { id: 'lately-position', name: 'latelyPosition', type: 'text' },
    { id: 'lately-leader', name: 'latelyWorkLeader', type: 'text' },
    { id: 'hotel', name: 'hotel', type: 'text' },
    { id: 'telescope', name: 'telescope', type: 'text' },
    { id: 'phone-number', name: 'phoneNumber', type: 'text' },
    { id: 'full-name', name: 'fullName', type: 'text' }
  ];
  const result = await prepareApplicationAnswers({ fields, profile: { phone: '13800138000', name: '张三' } });

  assert.deepEqual(result.answers.map(item => [item.fieldId, item.value]), [
    ['phone-number', '13800138000'],
    ['full-name', '张三']
  ]);
  assert.deepEqual(result.skipped.map(item => [item.fieldId, item.status]), [
    ['lately-company', 'missing'],
    ['lately-department', 'missing'],
    ['lately-position', 'missing'],
    ['lately-leader', 'missing'],
    ['hotel', 'missing'],
    ['telescope', 'missing']
  ]);
});

await test('simple field matching keeps Chinese and English purpose mappings', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [
    { id: 'identity', label: '身份证号', type: 'text' },
    { id: 'phone', label: '联系电话', type: 'text' },
    { id: 'email', label: 'Email Address', type: 'email' },
    { id: 'salary', label: 'Expected salary', type: 'text' },
    { id: 'available', label: 'availableDate', type: 'date' },
    { id: 'location', label: 'preferred_location', type: 'text' },
    { id: 'reason', label: 'Leaving Reason', type: 'text' },
    { id: 'degree', label: '最高学历', type: 'text' },
    { id: 'company', label: '最近单位', type: 'text' }
  ];
  const profile = {
    identityNumber: '110101199001011234',
    phone: '13800138000',
    email: 'zhangsan@example.com',
    expectedSalary: '20k',
    availableDate: '2026-11-01',
    preferredLocation: '上海',
    leaveReason: '职业发展',
    degree: '硕士',
    company: '不应使用'
  };
  const result = await prepareApplicationAnswers({ fields, profile });

  assert.deepEqual(result.answers.map(item => [item.fieldId, item.value]), [
    ['identity', '110101199001011234'],
    ['phone', '13800138000'],
    ['email', 'zhangsan@example.com'],
    ['salary', '20k'],
    ['available', '2026-11-01'],
    ['location', '上海'],
    ['reason', '职业发展'],
    ['degree', '硕士']
  ]);
  assert.deepEqual(result.skipped, [{ fieldId: 'company', status: 'missing' }]);
});

await test('recognizable label takes priority over conflicting field name', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const result = await prepareApplicationAnswers({
    fields: [{ id: 'conflict', label: '邮箱', name: 'phoneNumber', type: 'text' }],
    profile: { email: 'zhangsan@example.com', phone: '13800138000' }
  });

  assert.deepEqual(result.answers.map(item => [item.fieldId, item.value]), [
    ['conflict', 'zhangsan@example.com']
  ]);
});

await test('custom select values remain string answers and sex token maps to gender', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const result = await prepareApplicationAnswers({
    fields: [
      { id: 'campus', label: 'Preferred location', type: 'custom-select' },
      { id: 'sex', name: 'sex', type: 'radio', options: [{ label: '男', value: 'male' }, { label: '女', value: 'female' }] }
    ],
    profile: { preferredLocation: '上海', gender: '男' }
  });

  assert.deepEqual(result.answers.map(item => [item.fieldId, item.value]), [
    ['campus', '上海'],
    ['sex', 'male']
  ]);
});

await test('name matching requires exact English name purpose', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const result = await prepareApplicationAnswers({
    fields: [
      { id: 'company', name: 'companyName', type: 'text' },
      { id: 'school', name: 'schoolName', type: 'text' },
      { id: 'project', name: 'projectName', type: 'text' },
      { id: 'name', name: 'name', type: 'text' },
      { id: 'full-name', name: 'fullName', type: 'text' }
    ],
    profile: { name: '张三' }
  });

  assert.deepEqual(result.answers.map(item => [item.fieldId, item.value]), [
    ['name', '张三'],
    ['full-name', '张三']
  ]);
  assert.deepEqual(result.skipped.map(item => [item.fieldId, item.status]), [
    ['company', 'missing'],
    ['school', 'missing'],
    ['project', 'missing']
  ]);
});

await test('multi choices preserve exact explicit labels without splitting or guessing', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const result = await prepareApplicationAnswers({ fields: [
    { id: 'roles', label: '意向岗位', type: 'jiandaoyun-multiselect' },
    { id: 'teams', label: '意向团队', type: 'jiandaoyun-multiselect' },
    { id: 'location', label: '意向工作地点', type: 'jiandaoyun-multiselect' },
    { id: 'single', label: '语言特长', type: 'text' }
  ], profile: { preferredRoles: ['前端工程师', '研发工程师'], preferredTeams: '团队A,团队B', preferredLocation: ['上海'], languages: ['英语','日语'] } });
  assert.deepEqual(result.answers.map(item => [item.fieldId,item.value]), [
    ['roles', ['前端工程师','研发工程师']], ['teams', ['团队A,团队B']], ['location', ['上海']]
  ]);
  assert.equal(result.skipped.find(item => item.fieldId === 'single').status, 'missing');
});

await test('awards and campus rows use confirmed typed records with separate identities', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const result = await prepareApplicationAnswers({ fields: [
    { id: 'award', section: '获奖经历', row: 'a', label: '奖项名称', type: 'text' },
    { id: 'campus', section: '社团干部经历', row: 'c', label: '社团名称', type: 'text' },
    { id: 'duties', section: '社团干部经历', row: 'c', label: '工作描述', type: 'textarea' },
    { id: 'award2', section: '获奖经历', row: 'b', label: '奖项名称', type: 'text' }
  ], profile: { awards: [{ name: '已确认奖项' }], campusLeadership: [{ organization: '已确认社团', description: '已确认职责' }] }, facts: [{ id: 'p', type: 'project', value: '项目职责', status: 'verified' }] });
  assert.deepEqual(result.answers.map(item => [item.fieldId,item.value]), [['award','已确认奖项'],['campus','已确认社团'],['duties','已确认职责']]);
  assert.equal(result.skipped.find(item => item.fieldId === 'award2').status, 'missing');
});

await test('conditional undergraduate fields reuse exactly one confirmed undergraduate record', async () => {
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const fields = [{id:'school',label:'本科学校',type:'jiandaoyun-combo'},{id:'major',label:'本科专业',type:'text'},{id:'end',label:'本科毕业时间',type:'jiandaoyun-datetime'},{id:'rank',label:'本科成绩排名',type:'jiandaoyun-combo'}];
  const education = [{degree:'高中',school:'高中'},{degree:'本科',school:'模拟大学',major:'模拟专业',endDate:'2027-06-30',ranking:'前20%'}];
  const result = await prepareApplicationAnswers({fields,profile:{education}});
  assert.deepEqual(result.answers.map(item=>[item.fieldId,item.value]),[['school','模拟大学'],['major','模拟专业'],['end','2027-06-30'],['rank','前20%']]);
  const ambiguous = await prepareApplicationAnswers({fields,profile:{education:[...education,{degree:'本科',school:'另一学校'}]}});
  assert.equal(ambiguous.answers.length,0);
  assert.ok(ambiguous.skipped.every(item=>item.status === 'manual_required'));
});
