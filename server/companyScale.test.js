import assert from 'node:assert/strict';
import { isLargeCompany } from './companyScale.js';

for (const name of ['腾讯', '阿里巴巴集团', 'ByteDance', 'TikTok', 'offerstar·小红书', 'Google LLC', 'NVIDIA', 'JD.com', '科大讯飞股份有限公司', '小鹏汽车', '360', '奇虎360科技', 'TCL科技集团', '美的集团', '金山办公', '中国银行']) assert.equal(isLargeCompany(name), true, name);
for (const name of ['深圳越疆机器人', 'Acme', 'Metaverse Labs', 'Applied Intuition', 'Oracle Health Partners'.replace('Oracle', 'Orakel'), '', '完美的科技', '金山区某科技公司', 'Acme360Labs', '1360科技', 'TCLoud']) assert.equal(isLargeCompany(name), false, name);
console.log('companyScale tests passed');
