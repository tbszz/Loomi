import assert from "node:assert/strict";
import {
  GITHUB_JOB_SOURCES,
  parseGitHubJobMarkdown,
  refreshGitHubJobSourcesFromSnapshots
} from "./githubJobSources.js";
import { parseResumeText } from "./resumeEngine.js";

const speedyApplyAiMarkdown = `
# 2026 Artificial Intelligence Internship & New Grad Positions

## 2026 USA AI Internships

### FAANG+
| Company | Position | Location | Salary | Posting | Age |
|---|---|---|---|---|---|
| <a href="https://www.nvidia.com"><strong>NVIDIA</strong></a> | PhD Research Intern - Generative AI - 2026 | US, CA, Santa Clara | $62/hr | <a href="https://nvidia.wd5.myworkdayjobs.com/en-US/nvidiaexternalcareersite/job/US-CA-Santa-Clara/JR2016035"><img src="https://i.imgur.com/JpkfjIq.png" alt="Apply" width="70"/></a> | 9d |
| <a href="https://www.tiktok.com"><strong>TikTok</strong></a> | LLM Post-training Engineer Intern - Research & Product - 2026 Summer - BS/MS | San Jose | $60/hr | <a href="https://lifeattiktok.com/search/7631599293708126517"><img src="https://i.imgur.com/JpkfjIq.png" alt="Apply" width="70"/></a> | 44d |
`;

const zapplyMarkdown = `
# Software Engineering Jobs 2026

### Software Engineering
| Company | Role | Location | Posted | Visa | Apply |
|---|---|---|---|---|---|
| Google | Software Engineer III, AI/ML GenAI | United States | 29m | H-1B Co. | <a href="https://www.google.com/about/careers/applications/jobs/results/123"><img alt="Apply" /></a> |
| Tesla | Software Engineer Intern - Software Engineering | Bellevue, WA | 59m |  | <a href="https://www.tesla.com/careers/search/job/456"><img alt="Apply" /></a> |
`;

const zeroVoiceMarkdown = `
### MiniMax

NO. | 工作岗位 | 详细内容
--- | --- | ---
1 | 大模型算法工程师 | [点击查看](https://example.com/minimax-llm)
2 | 前端开发工程师 | [点击查看](https://example.com/minimax-frontend)
`;

const profile = parseResumeText("邹子涵 FastAPI React RAG LLM Agent Python AI Native 工具开发").profile;

const rows = parseGitHubJobMarkdown(speedyApplyAiMarkdown, {
  sourceId: "speedy-ai",
  defaultType: "internship"
});

assert.equal(rows.length, 2);
assert.equal(rows[0].company, "NVIDIA");
assert.equal(rows[0].title, "PhD Research Intern - Generative AI - 2026");
assert.equal(rows[0].location, "US, CA, Santa Clara");
assert.equal(rows[0].applyUrl, "https://nvidia.wd5.myworkdayjobs.com/en-US/nvidiaexternalcareersite/job/US-CA-Santa-Clara/JR2016035");
assert.equal(rows[0].postingAge, "9d");

const result = refreshGitHubJobSourcesFromSnapshots({
  sourceIds: ["speedy-ai", "zapply-swe", "0voice-spring"],
  snapshots: {
    "speedy-ai": { "README.md": speedyApplyAiMarkdown },
    "zapply-swe": { "README.md": zapplyMarkdown },
    "0voice-spring": { "README.md": zeroVoiceMarkdown }
  },
  profile,
  query: "AI Agent",
  type: "",
  fetchedAt: "2026-06-07T02:45:00.000Z"
});

assert.equal(GITHUB_JOB_SOURCES.length >= 4, true);
assert.equal(result.sources.length, 3);
assert.equal(result.sources.every((source) => source.ok), true);
assert.equal(result.summary.totalSources, 3);
assert.equal(result.summary.syncedSources, 3);
assert.equal(result.jobs.length, 4);
assert.equal(result.jobs[0].source, "github-job-source");
assert.equal(result.jobs[0].sourceGroup, "GitHub 实时岗位源");
assert.ok(result.jobs[0].opportunityScore >= result.jobs.at(-1).opportunityScore);
assert.ok(result.jobs.some((job) => job.company === "MiniMax" && job.applyUrl === "https://example.com/minimax-llm"));

console.log("githubJobSources tests passed");
