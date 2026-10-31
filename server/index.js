import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(path.join(root, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
const { createApp } = await import("./app.js");
const app = createApp();
const port = Number(process.env.RESUME_PROTOCOL_PORT || 8787);
const host = process.env.RESUME_PROTOCOL_HOST || "127.0.0.1";
const server = app.listen(port, host, () => {
  console.log(`Loomi: http://${host}:${port}`);
  // The job sync scans the whole job table synchronously; let the first page load answer first.
  setTimeout(() => app.locals.jobKnowledge.start(), 5000).unref();
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server.close(async () => { await app.locals.jobKnowledge.stop(); app.locals.database.close(); process.exit(0); });
});
