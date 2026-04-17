import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/extract-changelog.mjs <version>");
  process.exit(1);
}

const changelog = readFileSync("CHANGELOG.md", "utf-8");
const heading = `## [${version}]`;
const start = changelog.indexOf(heading);

if (start === -1) {
  console.log(`Release ${version}\n\nNo dedicated changelog section found. See repository history for details.`);
  process.exit(0);
}

const fromHeading = changelog.slice(start);
const nextHeadingOffset = fromHeading.indexOf("\n## ", heading.length);
const section = nextHeadingOffset === -1 ? fromHeading : fromHeading.slice(0, nextHeadingOffset);

console.log(section.trim());
