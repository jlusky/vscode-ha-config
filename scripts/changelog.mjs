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
  let inCode = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode;
    }
    // Only the heading the notes open with; a later one heads a list of its own
    const first = out.every((previous) => previous.trim() === "");
    if (first && /^#{1,6}\s+What['’]s Changed\s*$/i.test(line)) {
      continue;
    }
    const heading = inCode ? undefined : /^(#{1,6})(\s.*)$/.exec(line);
    // Level 1 and 2 headings become level 3, under the version; deeper ones move down one
    const level = heading ? Math.min(6, Math.max(3, heading[1].length + 1)) : 0;
    out.push(heading ? `${"#".repeat(level)}${heading[2]}` : line);
  }
  // Collapse the blank lines a dropped heading leaves behind
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const sections = releases.map((release) => {
  const date = (release.published_at ?? release.created_at ?? "").slice(0, 10);
  const heading = `## [${release.tag_name}](${release.html_url})${date ? ` (${date})` : ""}`;
  const body = notes(release.body);
  return body ? `${heading}\n\n${body}\n` : `${heading}\n`;
});

process.stdout.write(`# Changelog\n\n${sections.join("\n")}`);
