// Lexicons used by jobEligibility.js. Kept as plain data so new skills or
// school lists can be added without touching the decision logic.

// `term` is the canonical name shown to the user; any alias matching in a JD
// requirement or in the candidate material counts as the same skill.
export const SKILL_LEXICON = [
  { term: "React", aliases: ["React", "React.js", "ReactJS"] },
  { term: "TypeScript", aliases: ["TypeScript", "TS"] },
  { term: "JavaScript", aliases: ["JavaScript", "JS", "ES6"] },
  { term: "Python", aliases: ["Python"] },
  { term: "FastAPI", aliases: ["FastAPI"] },
  { term: "PostgreSQL", aliases: ["PostgreSQL", "Postgres"] },
  { term: "Git", aliases: ["Git"] },
  { term: "Java", aliases: ["Java"] },
  { term: "Go", aliases: ["Go", "Golang"] },
  { term: "C++", aliases: ["C++", "C/C++", "Cpp"] },
  { term: "C语言", aliases: ["C语言"] },
  { term: "C#", aliases: ["C#", ".NET"] },
  { term: "Rust", aliases: ["Rust"] },
  { term: "Kotlin", aliases: ["Kotlin"] },
  { term: "Swift", aliases: ["Swift"] },
  { term: "PHP", aliases: ["PHP"] },
  { term: "Shell", aliases: ["Shell", "Bash"] },
  { term: "SQL", aliases: ["SQL"] },
  { term: "MySQL", aliases: ["MySQL"] },
  { term: "Redis", aliases: ["Redis"] },
  { term: "MongoDB", aliases: ["MongoDB"] },
  { term: "Elasticsearch", aliases: ["Elasticsearch"] },
  { term: "Kafka", aliases: ["Kafka"] },
  { term: "Vue", aliases: ["Vue", "Vue.js", "Vue2", "Vue3"] },
  { term: "Node", aliases: ["Node", "Node.js", "NodeJS"] },
  { term: "Spring", aliases: ["Spring", "Spring Boot", "SpringBoot", "Spring Cloud"] },
  { term: "Django", aliases: ["Django"] },
  { term: "Flask", aliases: ["Flask"] },
  { term: "Linux", aliases: ["Linux"] },
  { term: "Docker", aliases: ["Docker"] },
  { term: "Kubernetes", aliases: ["Kubernetes", "K8s"] },
  { term: "Android", aliases: ["Android", "安卓"] },
  { term: "iOS", aliases: ["iOS"] },
  { term: "Flutter", aliases: ["Flutter"] },
  { term: "Hadoop", aliases: ["Hadoop"] },
  { term: "Spark", aliases: ["Spark", "PySpark"] },
  { term: "Flink", aliases: ["Flink"] },
  { term: "Hive", aliases: ["Hive"] },
  { term: "PyTorch", aliases: ["PyTorch"] },
  { term: "TensorFlow", aliases: ["TensorFlow"] },
  { term: "CUDA", aliases: ["CUDA"] },
  { term: "OpenCV", aliases: ["OpenCV"] },
  { term: "LangChain", aliases: ["LangChain"] },
  { term: "LLM", aliases: ["LLM", "LLMs", "大模型", "大语言模型", "Large Language Model"] },
  { term: "RAG", aliases: ["RAG", "检索增强生成"] },
  { term: "Machine Learning", aliases: ["Machine Learning", "机器学习"] },
  { term: "Deep Learning", aliases: ["Deep Learning", "深度学习"] },
  { term: "NLP", aliases: ["NLP", "自然语言处理"] },
  { term: "Computer Vision", aliases: ["Computer Vision", "计算机视觉"] },
  { term: "AI", aliases: ["AI"] }
];

// Complete Project 985 list; membership here is definitive.
export const SCHOOLS_985 = [
  "清华大学", "北京大学", "中国人民大学", "北京航空航天大学", "北京理工大学", "中国农业大学",
  "北京师范大学", "中央民族大学", "南开大学", "天津大学", "大连理工大学", "东北大学", "吉林大学",
  "哈尔滨工业大学", "复旦大学", "同济大学", "上海交通大学", "华东师范大学", "南京大学", "东南大学",
  "浙江大学", "中国科学技术大学", "厦门大学", "山东大学", "中国海洋大学", "武汉大学", "华中科技大学",
  "湖南大学", "中南大学", "中山大学", "华南理工大学", "四川大学", "电子科技大学", "重庆大学",
  "西安交通大学", "西北工业大学", "西北农林科技大学", "兰州大学", "国防科技大学"
];

// Project 211 universities that are not 985. A school missing from both lists
// stays unknown rather than being treated as non-211.
export const SCHOOLS_211 = [
  "北京交通大学", "北京工业大学", "北京科技大学", "北京化工大学", "北京邮电大学", "北京林业大学",
  "北京中医药大学", "北京外国语大学", "中国传媒大学", "中央财经大学", "对外经济贸易大学", "北京体育大学",
  "中央音乐学院", "中国政法大学", "华北电力大学", "中国矿业大学", "中国石油大学", "中国地质大学",
  "天津医科大学", "河北工业大学", "太原理工大学", "内蒙古大学", "辽宁大学", "大连海事大学", "延边大学",
  "东北师范大学", "哈尔滨工程大学", "东北农业大学", "东北林业大学", "华东理工大学", "东华大学",
  "上海外国语大学", "上海财经大学", "上海大学", "海军军医大学", "第二军医大学", "苏州大学",
  "南京航空航天大学", "南京理工大学", "河海大学", "江南大学", "南京农业大学", "中国药科大学",
  "南京师范大学", "安徽大学", "合肥工业大学", "福州大学", "南昌大学", "郑州大学", "武汉理工大学",
  "华中农业大学", "华中师范大学", "中南财经政法大学", "湖南师范大学", "暨南大学", "华南师范大学",
  "广西大学", "海南大学", "西南交通大学", "四川农业大学", "西南财经大学", "西南大学", "贵州大学",
  "云南大学", "西藏大学", "西北大学", "西安电子科技大学", "长安大学", "陕西师范大学", "空军军医大学",
  "第四军医大学", "青海大学", "宁夏大学", "新疆大学", "石河子大学"
];

// Independent colleges carry their parent's name but not its tier, e.g.
// 浙江大学城市学院. A department such as 浙江大学计算机学院 is unaffected.
export const INDEPENDENT_COLLEGE_SUFFIX = /^\s*[（(]?(?:城市|科技|理工|滨江|珠江|珠海|华南|南湖|文华|仙林|金城|泰州|紫金|成贤|应用技术|现代科技|宁波理工|长江|东方|中北|南方|北方|新华|华夏|信息技术)学院/;

// Recruitment-scam signals: charging candidates is never a legitimate hiring step.
export const RISK_PATTERNS = [
  /(?<![不无免勿])(?:需要?|须|先|要求)(?:缴纳|缴|交|支付).{0,6}(?:培训费|押金|保证金|服装费|报名费|体检费|资料费)/,
  /培训贷|贷款培训|入职前.{0,6}培训.{0,4}(?:收费|付费)/
];
