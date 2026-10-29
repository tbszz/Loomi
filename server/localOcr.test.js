import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { recognizeImage } from "./localOcr.js";

await test("recognizeImage writes a temporary PNG and removes it after OCR", async () => {
  let imagePath = "";
  const text = await recognizeImage(Buffer.from("png-bytes"), {
    platform: "win32",
    runScript: async ({ path }) => {
      imagePath = path;
      assert.equal(existsSync(path), true);
      return { stdout: "田绿华\n教育背景\n", stderr: "", code: 0 };
    }
  });
  assert.match(text, /田绿华/);
  assert.equal(existsSync(imagePath), false);
});

await test("recognizeImage fails clearly outside Windows", async () => {
  await assert.rejects(
    () => recognizeImage(Buffer.from("png-bytes"), { platform: "darwin" }),
    /仅支持 Windows 或 Linux/
  );
});

await test("recognizeImage uses tesseract-compatible runner on Linux", async () => {
  let imagePath = "";
  const text = await recognizeImage(Buffer.from("png-bytes"), {
    platform: "linux",
    runScript: async ({ path }) => {
      imagePath = path;
      assert.equal(existsSync(path), true);
      return { stdout: "田 绿 华\n技 能 Node.js\n", stderr: "", code: 0 };
    }
  });
  assert.equal(text, "田绿华\n技能 Node.js");
  assert.equal(existsSync(imagePath), false);
});

await test("recognizeImage honors a pre-aborted signal before writing a temp image", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  let called = false;
  await assert.rejects(
    () => recognizeImage(Buffer.from("png-bytes"), {
      platform: "win32",
      signal: controller.signal,
      runScript: async () => {
        called = true;
        return { stdout: "", stderr: "", code: 0 };
      }
    }),
    /stop/
  );
  assert.equal(called, false);
});

await test("recognizeImage keeps OCR failures generic", async () => {
  await assert.rejects(
    () => recognizeImage(Buffer.from("png-bytes"), {
      platform: "win32",
      runScript: async () => ({ stdout: "", stderr: "private details", code: 1 })
    }),
    /本机OCR识别失败/
  );
});

console.log("local OCR tests passed");
