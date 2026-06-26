#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { LinearClient } from "/home/whobs/dev/mcp-utils/dist/linear-client.js";

const token = JSON.parse(
  readFileSync("/mnt/c/Users/whobs/.cursor/mcp.json", "utf8"),
).mcpServers["linear-mach-triage"].env.LINEAR_API_TOKEN;

const client = new LinearClient({ apiToken: token, defaultTeam: "Mach-triage" });

const states = await client.listIssueStates("TER");
console.log("STATES:", states.map((s) => `${s.name}(${s.type})`).join(", "));

const closed = new Set(["done", "canceled", "cancelled", "duplicate"]);
const all = await client.listIssues({ team: "TER", limit: 100 });
const open = all.filter(
  (i) => !closed.has((i.state?.name ?? "").toLowerCase()),
);

console.log(`TOTAL: ${all.length}  OPEN: ${open.length}\n`);

for (const issue of open.sort(
  (a, b) =>
    parseInt(a.identifier.split("-")[1], 10) -
    parseInt(b.identifier.split("-")[1], 10),
)) {
  console.log(
    [
      issue.identifier,
      issue.state?.name ?? "?",
      issue.priorityLabel ?? issue.priority ?? "",
      issue.title,
      issue.url ?? "",
    ].join("\t"),
  );
}
