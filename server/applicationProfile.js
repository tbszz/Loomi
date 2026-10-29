import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const APPLICATION_PROFILE_FIELDS = ['name','phone','email','identityNumber','address','householdRegistration','nationality','ethnicity','politicalStatus','birthDate','gender','degree','expectedSalary','availableDate','preferredLocation','leaveReason','website','willingToRelocate','nativePlace','studentNumber','degreeName','preferredRoleCategory','preferredRoles','preferredTeams','languages','recruitmentChannel','referralCode','acceptRoleAdjustment','referred','hasAwards','hasCampusLeadership','hasInternship'];
export const SENSITIVE_APPLICATION_FIELDS = ['identityNumber','address','householdRegistration','ethnicity','politicalStatus','birthDate','nativePlace','studentNumber'];
const BOOLEAN_FIELDS = new Set(['willingToRelocate','acceptRoleAdjustment','referred','hasAwards','hasCampusLeadership','hasInternship']);
const MULTI_FIELDS = new Set(['preferredRoles','preferredTeams','preferredLocation','languages']);
const RECORD_FIELDS = {
  education: ['school','major','degree','startDate','endDate','ranking','description'],
  employment: ['company','title','startDate','endDate','description'],
  projects: ['name','role','startDate','endDate','description'],
  awards: ['type','level','name','date'],
  campusLeadership: ['organization','title','startDate','endDate','description']
};

export function createApplicationProfiles({ dataDir }) {
  if (!dataDir) throw new Error('申请资料存储目录未配置。');
  const directory = path.resolve(dataDir, 'application-profiles');
  let keyPromise;
  const key = () => keyPromise ||= (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = path.join(directory, '.key');
    try { await writeFile(filename, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw new Error('申请资料密钥无法创建。'); }
    const bytes = await readFile(filename);
    if (bytes.length !== 32) throw new Error('申请资料密钥无效。');
    return bytes;
  })();
  const identity = scope => {
    if (!scope?.userId || !scope?.candidateId) throw new Error('申请资料需要账号和求职者。');
    return createHash('sha256').update(JSON.stringify([scope.userId, scope.candidateId])).digest('hex');
  };
  const read = async scope => {
    const id = identity(scope);
    let text;
    try { text = await readFile(path.join(directory, `${id}.json`), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('申请资料无法读取。'); }
    try {
      const saved = JSON.parse(text);
      const decipher = createDecipheriv('aes-256-gcm', await key(), Buffer.from(saved.iv, 'base64'));
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.data, 'base64')), decipher.final()]).toString('utf8'));
    } catch { throw new Error('申请资料无法解密，请检查本地密钥。'); }
  };
  return {
    read,
    async publicRead(scope) {
      const profile = await read(scope);
      return { ...Object.fromEntries(Object.entries(profile).filter(([name]) => !SENSITIVE_APPLICATION_FIELDS.includes(name))), configuredFields: Object.keys(profile), sensitiveConfigured: SENSITIVE_APPLICATION_FIELDS.filter(name => name in profile) };
    },
    async write(scope, patch) {
      validateProfile(patch);
      const profile = { ...await read(scope), ...patch };
      for (const field of Object.keys(profile)) if ((typeof profile[field] === 'string' && !profile[field].trim()) || (BOOLEAN_FIELDS.has(field) && profile[field] === null)) delete profile[field];
      const id = identity(scope);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', await key(), iv);
      cipher.setAAD(Buffer.from(id));
      const data = Buffer.concat([cipher.update(JSON.stringify(profile), 'utf8'), cipher.final()]);
      const filename = path.join(directory, `${id}.json`);
      const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
      await rename(temporary, filename);
      return this.publicRead(scope);
    }
  };
}

function validateProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('申请资料必须是对象。');
  const allowed = new Set([...APPLICATION_PROFILE_FIELDS, ...Object.keys(RECORD_FIELDS)]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('申请资料含不支持的字段。');
  for (const [field, content] of Object.entries(value)) {
    if (field in RECORD_FIELDS) {
      if (!Array.isArray(content) || content.length > 20) throw new Error('经历最多保存20条。');
      for (const record of content) {
        if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !RECORD_FIELDS[field].includes(key))) throw new Error('经历字段不合法。');
        for (const text of Object.values(record)) if (typeof text !== 'string' || text.length > 4000) throw new Error('经历内容过长或格式无效。');
      }
    } else if (BOOLEAN_FIELDS.has(field)) {
      if (content !== null && typeof content !== 'boolean') throw new Error('申请意愿或经历声明必须是布尔值。');
    } else if (MULTI_FIELDS.has(field) && Array.isArray(content)) {
      if (content.length > 20 || content.some(item => typeof item !== 'string' || !item.trim() || item.length > 300) || new Set(content.map(item => item.trim())).size !== content.length) throw new Error('多选资料须为最多20个不重复的明确选项。');
    } else if (typeof content !== 'string' || content.length > (field === 'leaveReason' ? 2000 : 300)) throw new Error('申请字段过长或格式无效。');
  }
}
