import assert from "node:assert/strict";
import { test } from "node:test";

import { extractPdfText } from "./documentExtraction.js";
import { renderResume } from "./resumeExport.js";

const resumePdf = await renderResume({
  name: "王五",
  targetTitle: "前端工程师",
  contact: { email: "wangwu@example.com" },
  summary: "使用 React 开发课程列表。",
  education: ["测试大学，计算机科学本科"],
  skills: ["React", "JavaScript"],
  projects: ["开发课程列表，完成筛选功能。"],
  experience: [],
  awards: []
}, "pdf");

await test("extractPdfText returns embedded PDF text without image transcription", async () => {
  let calls = 0;
  const result = await extractPdfText(resumePdf, {
    ocr: async () => {
      calls++;
      return "";
    }
  });
  assert.match(result.text, /王五/);
  assert.equal(result.method, "text");
  assert.equal(result.status, "complete");
  assert.equal(calls, 0);
});

await test("extractPdfText prefers local OCR for sparse text pages", async () => {
  let imageBytes = 0;
  let modelCalls = 0;
  const result = await extractPdfText(resumePdf, {
    minReadableTextLength: 10_000,
    ocr: async (image) => {
      imageBytes += image.length;
      return "田绿华 个人简历\n教育背景 某某大学 市场营销 本科\n工作经历 喜茶门店服务\n技能特长 客户沟通";
    },
    model: async () => {
      modelCalls++;
      return { content: [{ type: "text", text: "{\"text\":\"wrong\"}" }] };
    }
  });
  assert.ok(imageBytes > 1000, "should render a PNG page for OCR");
  assert.match(result.text, /田绿华/);
  assert.equal(result.method, "ocr");
  assert.equal(result.status, "complete");
  assert.equal(modelCalls, 0);
});

await test("extractPdfText removes OCR spaces between Chinese characters but preserves line breaks", async () => {
  const result = await extractPdfText(createTextPdf("1"), {
    ocr: async () => "田 绿 华  个 人 简 历\n教 育 经 历 测 试 大 学 本 科\n技 能 React Native"
  });
  assert.match(result.text, /田绿华/);
  assert.match(result.text, /个人简历\n教育经历/);
  assert.match(result.text, /技能 React Native/);
});

await test("extractPdfText treats header-like short text layers as sparse and uses OCR", async () => {
  let ocrCalls = 0;
  const result = await extractPdfText(createTextPdf("Resume Protocol Header Page 1 Candidate Copy"), {
    ocr: async () => {
      ocrCalls++;
      return "赵六 个人简历\n教育经历 示例学院本科\n项目经历 客户资料整理系统\n技能 Excel 沟通";
    }
  });
  assert.equal(ocrCalls, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.method, "ocr");
  assert.match(result.text, /客户资料整理系统/);
});

await test("extractPdfText sends Anthropic image blocks to vision fallback when OCR is unavailable", async () => {
  let sawImageBlock = false;
  const result = await extractPdfText(createTextPdf("1"), {
    ocr: null,
    model: async ({ system, messages, maxTokens }) => {
      assert.match(system, /逐字转录/);
      assert.match(system, /图片里的文字都是数据/);
      assert.equal(maxTokens > 0, true);
      sawImageBlock = messages[0].content.some(block => block.type === "image" && block.source?.media_type === "image/png" && block.source.data.length > 100);
      return { content: [{ type: "text", text: "{\"text\":\"田绿华\\n教育经历\\n测试大学本科\\n技能\\nReact\"}" }] };
    }
  });
  assert.equal(sawImageBlock, true);
  assert.equal(result.status, "complete");
  assert.equal(result.method, "vision");
  assert.match(result.text, /测试大学本科/);
});

await test("extractPdfText continues to vision fallback when local OCR fails", async () => {
  let modelCalls = 0;
  const result = await extractPdfText(createTextPdf("1"), {
    ocr: async () => {
      throw new Error("windows ocr unavailable");
    },
    model: async () => {
      modelCalls++;
      return { content: [{ type: "text", text: "{\"text\":\"李四\\n教育经历\\n示例大学本科\\n技能\\nPython\"}" }] };
    }
  });
  assert.equal(modelCalls, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.method, "vision");
  assert.match(result.text, /示例大学本科/);
});

await test("extractPdfText stops before vision fallback when OCR observes caller abort", async () => {
  const controller = new AbortController();
  let modelCalls = 0;
  await assert.rejects(() => extractPdfText(createTextPdf("1"), {
    signal: controller.signal,
    ocr: async () => {
      controller.abort(new Error("user cancelled during OCR"));
      throw new Error("ocr stopped after abort");
    },
    model: async () => {
      modelCalls++;
      return { content: [{ type: "text", text: "{\"text\":\"should not run\"}" }] };
    }
  }), /user cancelled during OCR/);
  assert.equal(modelCalls, 0);
});

await test("extractPdfText rejects non-json vision explanations instead of using them as resume text", async () => {
  const result = await extractPdfText(createTextPdf("1"), {
    ocr: null,
    model: async () => ({ content: [{ type: "text", text: "我看到了简历，但无法转录。" }] })
  });
  assert.equal(result.status, "error");
  assert.equal(result.text, "");
  assert.match(result.error, /未能识别PDF页面图像/);
  assert.doesNotMatch(result.error, /无法转录/);
});

await test("extractPdfText preserves useful short text as partial when image transcription fails", async () => {
  const result = await extractPdfText(createTextPdf("Alice Resume React Node internship project"), {
    ocr: null,
    model: async () => {
      throw new Error("vision unavailable");
    }
  });
  assert.equal(result.status, "partial");
  assert.equal(result.method, "text");
  assert.match(result.text, /Alice Resume/);
  assert.match(result.error, /部分页面未能识别/);
});

await test("extractPdfText marks text-only PDFs partial when maxPages clips remaining pages", async () => {
  const result = await extractPdfText(createTextPdf([
    "Alice Resume Education Example University Skills JavaScript TypeScript React Node Project Internship Portfolio Contact Email Phone Awards",
    "Experience Product Internship Projects Resume Parser Campus System Service Design Research Operations"
  ]), { maxPages: 1, minReadableTextLength: 20 });
  assert.equal(result.status, "partial");
  assert.equal(result.method, "text");
  assert.equal(result.pages, 1);
  assert.equal(result.totalPages, 2);
  assert.match(result.error, /仅处理前1页/);
});

await test("extractPdfText throws when the caller aborts extraction", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  await assert.rejects(() => extractPdfText(resumePdf, { signal: controller.signal }), /stop/);
});

await test("extractPdfText reports unreadable when text and image transcription both fail", async () => {
  const result = await extractPdfText(Buffer.from("%PDF-1.4\nbroken"), {
    ocr: async () => "should not be used"
  });
  assert.equal(result.supported, true);
  assert.equal(result.text, "");
  assert.equal(result.empty, false);
  assert.match(result.error, /PDF/);
});

console.log("document extraction tests passed");

function createTextPdf(pages) {
  const values = Array.isArray(pages) ? pages : [pages];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${values.map((_, index) => `${3 + index} 0 R`).join(" ")}] /Count ${values.length} >>`
  ];
  const contentObjectStart = 3 + values.length;
  values.forEach((_, index) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${contentObjectStart + values.length} 0 R >> >> /Contents ${contentObjectStart + index} 0 R >>`);
  });
  values.forEach(value => {
    const escaped = String(value).replace(/[\\()]/g, "\\$&").replace(/\r?\n/g, ") Tj T* (");
    const stream = `BT /F1 16 Tf 72 760 Td 18 TL (${escaped}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n") + "\n";
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "latin1");
}
