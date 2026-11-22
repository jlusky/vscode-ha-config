import { Diagnostic } from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";

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

/**
 * Returns the comment on a YAML line: a "#" at the start of the line or after whitespace,
 * outside quotes. A "#" inside a value such as "#ff0000" or url#anchor is not a comment.
 */
function commentOf(line: string): string | undefined {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(i + 1);
    }
  }
  return undefined;
}

export function parseIgnoreDirectives(document: TextDocument): IgnoreDirectives {
  const ignoredIds = new Set<string>();
  const disabledLines = new Set<number>();
  const lines = document.getText().split(/\r?\n/);
  let inDisabledRange = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const comment = commentOf(lines[lineIndex]);
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
