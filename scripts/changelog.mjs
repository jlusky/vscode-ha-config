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
import MarkdownIt from "markdown-it";
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

// The notes are parsed as Markdown, so headings are found the way GitHub and the
// Marketplace find them: never inside code blocks, HTML comments or other HTML blocks.
const md = new MarkdownIt("default", { html: true });
const END = "changelog-end-of-release";

// True when Markdown would read a heading placed after these notes as a heading. An
// unclosed code block or HTML block runs to the end of the document, so it would take in
// every release after it.
function endsCleanly(text) {
  const tokens = md.parse(`${text}\n\n# ${END}`, {});
  return tokens.at(-2)?.type === "inline" && tokens.at(-2).content === END;
}

// True when the HTML the notes render to leaves a comment open. Markdown can end an HTML
// block at a blank line while a browser still reads everything after its "<!--" as
// comment, up to the first "-->". Code and text are escaped, so only raw HTML counts.
function opensComment(text) {
  const html = md.render(text);
  const start = html.lastIndexOf("<!--");
  return start !== -1 && !html.includes("-->", start + 4);
}

// The line that ends the code block or HTML block the notes leave open
function closer(token) {
  if (token.type === "fence") {
    return token.markup;
  }
  if (token.type === "html_block") {
    const html = token.content.trimStart();
    const tag = /^<(script|pre|style|textarea)\b/i.exec(html);
    if (tag) {
      return `</${tag[1]}>`;
    }
    if (html.startsWith("<!--")) {
      return "-->";
    }
    if (html.startsWith("<?")) {
      return "?>";
    }
    if (html.startsWith("<![CDATA[")) {
      return "]]>";
    }
    if (html.startsWith("<!")) {
      return ">";
    }
  }
  return undefined;
}

function notes(release) {
  const lines = (release.body ?? "").replace(/\r\n/g, "\n").split("\n");
  const tokens = md.parse(lines.join("\n"), {});
  tokens.forEach((token, i) => {
    // Only top-level headings; ones in lists and quotes are left as they are
    if (token.type !== "heading_open" || token.level !== 0 || !token.map) {
      return;
    }
    const [start, end] = token.map;
    const text = tokens[i + 1].content.replace(/\n/g, " ");
    // The "What's Changed" heading the notes open with is dropped; a later one heads a list
    // of its own
    if (i === 0 && /^What['’]s Changed$/i.test(text.trim())) {
      lines.fill(null, start, end);
      return;
    }
    // Level 1 and 2 headings become level 3, under the version; deeper ones move down one.
    // An underlined heading becomes a # heading, so its underline goes.
    const level = Math.min(6, Math.max(3, Number(token.tag.slice(1)) + 1));
    lines[start] = `${"#".repeat(level)} ${text}`;
    lines.fill(null, start + 1, end);
  });
  let text = lines
    .filter((line) => line !== null)
    .join("\n")
    .replace(/^\s*\n/, "")
    .trimEnd();

  if (!endsCleanly(text)) {
    const open = tokens.findLast((token) => token.level === 0 && token.map);
    const line = open && closer(open);
    if (line && endsCleanly(`${text}\n${line}`)) {
      text = `${text}\n${line}`;
    } else {
      console.error(
        `::warning::The notes for ${release.tag_name} leave something open that may hide the releases after them in the changelog.`,
      );
    }
  }
  // A comment of its own, after a blank line, is raw HTML whose "-->" ends the open one
  if (opensComment(text)) {
    text = `${text}\n\n<!-- -->`;
  }
  return text;
}

const sections = releases.map((release) => {
  const date = (release.published_at ?? release.created_at ?? "").slice(0, 10);
  const heading = `## [${release.tag_name}](${release.html_url})${date ? ` (${date})` : ""}`;
  const body = notes(release);
  return body ? `${heading}\n\n${body}\n` : `${heading}\n`;
});

process.stdout.write(`# Changelog\n\n${sections.join("\n")}`);
