// Writes CHANGELOG.md from the GitHub releases, so the Marketplace and Open VSX show the
// release notes. The releases are the only place the notes are written; CHANGELOG.md is
// generated when packaging and isn't committed.
//
//   gh api --paginate --slurp repos/OWNER/REPO/releases > releases.json
//   node scripts/changelog.mjs releases.json v1.2.3 > CHANGELOG.md
//
// It lists every published release (not drafts or pre-releases) up to and including the
// given tag, newest first. Each release's headings move down to sit under its version, and
// the "What's Changed" heading each release opens with is dropped.
import { readFile } from "node:fs/promises";

const [file, tag] = process.argv.slice(2);
if (!file || !tag) {
  console.error("Usage: node scripts/changelog.mjs <releases.json> <vX.Y.Z>");
  process.exit(1);
}

function parseVersion(name) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return match ? match.slice(1).map(Number) : undefined;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

const current = parseVersion(tag);
if (!current) {
  console.error(`The tag must look like v1.2.3, got '${tag}'`);
  process.exit(1);
}

// gh api --paginate --slurp gives an array of pages; a single page is accepted too
const data = JSON.parse(await readFile(file, "utf8"));
const releases = (Array.isArray(data[0]) ? data.flat() : data)
  .filter((release) => !release.draft && !release.prerelease)
  .map((release) => ({ ...release, version: parseVersion(release.tag_name) }))
  .filter(
    (release) => release.version && compare(release.version, current) <= 0,
  )
  .sort((a, b) => compare(b.version, a.version));

if (!releases.some((release) => release.tag_name === tag)) {
  console.error(`${tag} isn't a published release`);
  process.exit(1);
}

function notes(body) {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  // The open code fence, like "```" or "~~~~"; lines inside a code block stay as they are
  let fence = "";
  const out = [];
  for (const line of lines) {
    if (fence) {
      // A fence closes with the same character, at least as many times, and nothing after it
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length
      ) {
        fence = "";
      }
      out.push(line);
      continue;
    }
    // A backtick fence can't have a backtick after it: ```npm install``` is inline code
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = open[1];
      out.push(line);
      continue;
    }
    // Only the heading the notes open with, and the blank lines around it; a later one
    // heads a list of its own
    const first = out.every((previous) => previous.trim() === "");
    if (
      first &&
      (line.trim() === "" || /^#{1,6}\s+What['’]s Changed\s*$/i.test(line))
    ) {
      continue;
    }
    const heading = /^(#{1,6})(\s.*)$/.exec(line);
    // Level 1 and 2 headings become level 3, under the version; deeper ones move down one
    const level = heading ? Math.min(6, Math.max(3, heading[1].length + 1)) : 0;
    out.push(heading ? `${"#".repeat(level)}${heading[2]}` : line);
  }
  // Close a code block the notes leave open, so the next release isn't swallowed by it
  if (fence) {
    out.push(fence);
  }
  return out.join("\n").trimEnd();
}

const sections = releases.map((release) => {
  const date = (release.published_at ?? release.created_at ?? "").slice(0, 10);
  const heading = `## [${release.tag_name}](${release.html_url})${date ? ` (${date})` : ""}`;
  const body = notes(release.body);
  return body ? `${heading}\n\n${body}\n` : `${heading}\n`;
});

process.stdout.write(`# Changelog\n\n${sections.join("\n")}`);
