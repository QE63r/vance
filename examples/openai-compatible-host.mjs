// Reference host for the OpenAI-compatible adapter.
//
// This is intentionally small: it proves the second adapter can drive the same
// Vance console. It is chat-only (no tool-call approvals yet).
//
//   OPENAI_API_KEY=... node examples/openai-compatible-host.mjs
//
// Optional:
//   OPENAI_BASE_URL=https://api.deepseek.com
//   OPENAI_MODEL=deepseek-chat
//   VANCE_TOKEN=<token>   (default: ~/.vance/token)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HostServer } from "../packages/host/dist/index.js";
import { OpenAICompatibleAdapter } from "../packages/adapter-openai-compatible/dist/index.js";

const token =
  process.env.VANCE_TOKEN ?? readFileSync(join(homedir(), ".vance", "token"), "utf8").trim();
const apiKey = process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("Set OPENAI_API_KEY (or DEEPSEEK_API_KEY) first.");
  process.exit(1);
}

const host = new HostServer({
  port: Number(process.env.VANCE_PORT ?? 8788),
  token,
  pagePath: join(process.cwd(), "packages", "host", "public", "index.html"),
  webDir: join(process.cwd(), "packages", "web", "dist"),
  projectName: "external-ai-demo",
  approveAllDevices: true,
});

host.setAgents(
  [
    {
      id: "deepseek",
      name: "DeepSeek",
      kind: "openai-compatible",
      status: "connected",
      note: process.env.OPENAI_MODEL ?? "deepseek-chat",
    },
  ],
  "deepseek",
);

const adapter = new OpenAICompatibleAdapter(
  {
    id: "deepseek",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com",
    apiKey,
    model: process.env.OPENAI_MODEL ?? "deepseek-chat",
    systemPrompt: "You are the external AI agent inside Vance. Be concise.",
  },
  {
    onChat: (messageId, text) => host.broadcastChat(messageId, text),
    onStatus: (state, detail) => {
      if (state === "running") host.broadcastTurn("running");
      else if (state === "done") host.broadcastTurn("idle");
      else host.broadcastNotice("deny", detail ?? "external AI failed");
    },
    onError: (message) => host.broadcastNotice("deny", message),
  },
);

await adapter.start();
host.onPrompt((text) => {
  void adapter.prompt(text).catch((error) => {
    host.broadcastNotice("deny", error instanceof Error ? error.message : String(error));
    host.broadcastTurn("idle");
  });
});

const { port, urls } = await host.start();
console.log(`external AI console: http://127.0.0.1:${port}/app/#token=${token}`);
for (const url of urls) console.log(`LAN: ${url}/app/#token=${token}`);

const stop = async () => {
  await adapter.close();
  await host.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
