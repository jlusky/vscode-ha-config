import { Diagnostic } from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CST, Lexer } from "yaml";

/**
 * Comment directives that silence this extension's own diagnostics (unknown entities, areas,
 * devices, floors, labels, actions and secrets), in the style of cSpell's document settings:
 *
 *   # homeassistant:ignore light.remote_one, light.remote_two   (whole file, these IDs)
 *   entity_id: light.staging  # homeassistant:disable-line      (this line)
 *   # homeassistant:disable-next-line                           (the next line)
 *   # homeassistant:disable ... # homeassistant:enable          (a range of lines)
 *
 * YAML schema diagnostics are not affected.
 */
export interface IgnoreDirectives {
  /** IDs ignored in the whole file */
  ignoredIds: Set<string>;
  /** Zero-based lines on which all of this extension's diagnostics are silenced */
  disabledLines: Set<number>;
}

const DIRECTIVE_REGEX = /homeassistant:(ignore|disable-line|disable-next-line|disable|enable)\b/g;

/** Control tokens the lexer inserts that aren't part of the source text */
const CONTROL_TOKENS = new Set(["\u0002", "\u0018", "\u001f"]);

/**
 * Returns the comments in the document by zero-based line, without the "#". Uses the YAML
 * lexer, so a "#" inside a quoted or block scalar (`"a \" # x"`, `description: |`), in a
 * value such as `url#anchor`, or after an apostrophe in a plain scalar is handled as YAML does.
 */
function commentsByLine(document: TextDocument): Map<number, string> {
  const comments = new Map<number, string>();
  let offset = 0;
  for (const token of new Lexer().lex(document.getText())) {
    if (CONTROL_TOKENS.has(token)) {
      continue;
    }
    if (CST.tokenType(token) === "comment") {
      comments.set(document.positionAt(offset).line, token.slice(1));
    }
    offset += token.length;
  }
  return comments;
}

export function parseIgnoreDirectives(document: TextDocument): IgnoreDirectives {
  const ignoredIds = new Set<string>();
  const disabledLines = new Set<number>();
  const comments = commentsByLine(document);
  let inDisabledRange = false;

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const comment = comments.get(lineIndex);
    let lineDisabled = inDisabledRange;

    if (comment !== undefined) {
      const matches = [...comment.matchAll(DIRECTIVE_REGEX)];
      matches.forEach((match, index) => {
        const name = match[1];
        if (name === "ignore") {
          // The IDs run up to the next directive, separated by commas or spaces
          const argsEnd = index + 1 < matches.length ? matches[index + 1].index : comment.length;
          comment
            .slice(match.index! + match[0].length, argsEnd)
            .split(/[\s,]+/)
            .filter((id) => id.length > 0)
            .forEach((id) => ignoredIds.add(id));
        } else if (name === "disable-line") {
          lineDisabled = true;
        } else if (name === "disable-next-line") {
          disabledLines.add(lineIndex + 1);
        } else if (name === "disable") {
          inDisabledRange = true;
          lineDisabled = true;
        } else if (name === "enable") {
          inDisabledRange = false;
          lineDisabled = false;
        }
      });
    }

    if (lineDisabled) {
      disabledLines.add(lineIndex);
    }
  }

  return { ignoredIds, disabledLines };
}

/**
 * Drops this extension's diagnostics that the document's ignore directives silence.
 * The ID of a diagnostic is the text it underlines.
 */
export function applyIgnoreDirectives(
  document: TextDocument,
  diagnostics: Diagnostic[],
): Diagnostic[] {
  const { ignoredIds, disabledLines } = parseIgnoreDirectives(document);
  if (ignoredIds.size === 0 && disabledLines.size === 0) {
    return diagnostics;
  }

  return diagnostics.filter((diagnostic) => {
    if (diagnostic.source !== "home-assistant") {
      return true;
    }
    if (disabledLines.has(diagnostic.range.start.line)) {
      return false;
    }
    const id = document.getText(diagnostic.range).trim().replace(/^["']|["']$/g, "");
    return !ignoredIds.has(id);
  });
}
