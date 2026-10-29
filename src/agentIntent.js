const INTENT_RULES = [
  ["interview", /面试|复习|追问|模拟面试|项目深挖|算法题|八股/i],
  ["resume", /定制|岗位版|生成.*简历|改写.*简历|优化.*简历|针对.*(?:jd|岗位)/i],
  ["jobs", /找.*(?:岗位|工作|职位)|搜索.*(?:岗位|工作|职位)|岗位雷达|校招|实习|职位|招聘|jd/i],
  ["intake", /诊断|分析.*简历|检查.*简历|解析.*简历|职业资料|补充资料|完整度|教育经历|项目经历|工作经历|技能栈/i]
];

export function classifyAgentIntent(input = "") {
  const text = String(input).trim();
  if (!text) return "empty";
  const resumeSignals = ["教育经历", "教育背景", "项目经历", "工作经历", "实习经历", "技能栈", "邮箱", "电话"];
  if (text.length > 80 && resumeSignals.filter((signal) => text.includes(signal)).length >= 2) return "intake";
  return INTENT_RULES.find(([, pattern]) => pattern.test(text))?.[0] || "help";
}

export function buildJobQueries(input = "", profile = null) {
  const text = String(input || "");
  if (/前端|React|Vue|TypeScript/i.test(text)) return ["前端", ""];
  if (/后端|FastAPI|Django|Java|数据库|接口/i.test(text)) return ["后端", ""];
  if (/产品|需求|PRD|用户研究/i.test(text)) return ["产品", ""];
  if (/运营|增长|内容|转化/i.test(text)) return ["运营", ""];
  if (/AI\s*Agent|RAG|智能体/i.test(text)) return ["AI Agent", "AI", ""];
  const skills = (profile?.skills || []).join(" ");
  if (/React|Vue|TypeScript/i.test(skills)) return ["前端", ""];
  return ["AI Agent", "AI", ""];
}

export function planAgentAction(input, context = {}) {
  const intent = classifyAgentIntent(input);
  if (intent === "empty") {
    return response(intent, "none", "chat", "先说你现在最想完成什么，例如：诊断简历、找目标岗位、生成岗位版，或准备面试。");
  }
  if (intent === "intake") {
    if (!context.hasMaterial) {
      return response(intent, "request-material", "chat", "把现有简历或项目材料直接粘贴到这里，或使用输入框旁的附件按钮。我会从完整度和事实证据开始诊断。");
    }
    return response(intent, "analyze", "chat", "我会分析当前材料，找出缺失信息、优势和需要补证据的项目。");
  }
  if (intent === "jobs") {
    return response(intent, "search-jobs", "chat", "我会搜索匹配岗位并把候选项放进对话。选择目标后，简历和面试计划会共用这份 JD。");
  }
  if (intent === "resume") {
    if (!context.hasProfile) {
      return response(intent, "request-material", "chat", "还缺少职业资料。请直接粘贴或上传简历，我会先分析，再基于真实经历生成岗位版。");
    }
    if (!context.hasJob) {
      return response(intent, "search-jobs", "chat", "职业资料已经就绪。我会先给出匹配岗位，请选定一份目标岗位 JD 后再生成岗位版。");
    }
    return response(intent, "generate-resume", "chat", "资料和目标岗位都已就绪。我会生成岗位版项目证据，并同步准备面试追问。");
  }
  if (intent === "interview") {
    if (!context.hasVariant) {
      return response(intent, "request-resume", "chat", "面试计划需要以岗位版简历为依据。请先生成岗位版，我再围绕其中每一条项目证据追问。");
    }
    return response(intent, "prepare-interview", "chat", "面试材料已经就绪。我会从项目深挖、技术主线和 7 天复习计划开始。");
  }
  return response(intent, "reply", "chat", "你可以直接告诉我目标：诊断资料、找岗位、生成岗位版简历，或准备面试。我会判断前置条件并在对话中完成。");
}

function response(intent, action, target, message) {
  return { intent, action, target, message };
}
