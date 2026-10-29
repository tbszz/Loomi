// Large employers, matched by name or brand. A company missing from this list
// is reported as "not on the large-company list", never claimed to be small:
// headcount is not something the job feeds state.
const LARGE_COMPANIES = [
  ["腾讯", "tencent"], ["阿里巴巴", "阿里", "alibaba", "蚂蚁", "淘天", "阿里云", "菜鸟", "饿了么"],
  ["字节跳动", "bytedance", "tiktok", "抖音", "飞书"], ["百度", "baidu"], ["美团", "meituan"], ["京东", "jd.com"],
  ["快手", "kuaishou"], ["拼多多", "pdd", "temu"], ["网易", "netease"], ["小米", "xiaomi"], ["华为", "huawei"],
  ["小红书", "xiaohongshu"], ["滴滴", "didi"], ["携程", "trip.com"], ["哔哩哔哩", "bilibili", "b站"], ["荣耀", "honor"],
  ["oppo"], ["vivo"], ["联想", "lenovo"], ["中兴", "zte"], ["比亚迪", "byd"], ["蔚来", "nio"], ["理想汽车"], ["米哈游", "mihoyo"],
  ["微软", "microsoft"], ["谷歌", "google"], ["亚马逊", "amazon", "aws"], ["meta"], ["苹果", "apple"], ["英伟达", "nvidia"],
  ["tesla", "特斯拉"], ["oracle", "甲骨文"], ["ibm"], ["intel", "英特尔"], ["salesforce"], ["adobe"], ["cisco"], ["qualcomm", "高通"],
  ["netflix"], ["uber"], ["linkedin"], ["samsung", "三星"], ["jpmorgan", "摩根大通"], ["goldman sachs", "高盛"],
  ["科大讯飞", "讯飞"], ["小鹏"], ["吉利"], ["长城汽车"], ["长安汽车"], ["上汽"], ["广汽"], ["宁德时代"],
  ["海康威视"], ["浙江大华", "大华股份"], ["大疆"], ["商汤"], ["360", "奇虎"],
  ["金山办公", "金山软件", "金山云"], ["用友"], ["浪潮"], ["唯品会"], ["得物"], ["贝壳找房"],
  ["爱奇艺"], ["新浪"], ["微博"], ["搜狐"], ["中芯国际"], ["迈瑞"], ["海尔"], ["美的集团"], ["格力电器"], ["tcl"],
  ["顺丰"], ["中国平安", "平安科技", "平安银行"], ["招商银行"], ["工商银行"], ["建设银行"], ["农业银行"], ["中国银行"],
  ["中国移动"], ["中国联通"], ["中国电信"], ["国家电网"]
].flat();

export function isLargeCompany(name) {
  const value = String(name || "").toLowerCase().replace(/^offerstar·/, "");
  if (!value) return false;
  return LARGE_COMPANIES.some((term) => /^[a-z0-9 .&]+$/.test(term)
    ? new RegExp(`(^|[^a-z0-9])${term.replace(/[.]/g, "\\.")}([^a-z0-9]|$)`).test(value)
    : term === '京东' ? /京东(?!方)/.test(value) : value.includes(term));
}
