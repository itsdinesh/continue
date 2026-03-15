import { LineStream } from "../../../diff/util";

import {
  collectAllLines,
  isMarkdownFile,
  MarkdownBlockStateTracker,
} from "../../../utils/markdownUtils";

import {
  processBlockNesting,
  shouldStopAtMarkdownBlock,
} from "../../../utils/streamMarkdownUtils";

import { hasNestedMarkdownBlocks, shouldChangeLineAndStop } from "./lineStream";

/**
 * Filters and processes lines from a code block, removing unnecessary markers and handling edge cases.
 * Now includes markdown-aware processing to handle nested markdown blocks properly.
 *
 * @param {LineStream} rawLines - The input stream of lines to filter.
 * @param {string} filepath - Optional filepath to determine if this is a markdown file.
 * @yields {string} Filtered and processed lines from the code block.
 *
 * @description
 * This generator function performs the following tasks:
 * 1. Removes initial lines that should be removed before the actual code starts.
 * 2. For markdown files, applies nested markdown block logic to avoid premature termination.
 * 3. For mixed content, uses simplified processing to avoid premature termination.
 * 4. For traditional code blocks, uses original logic.
 * 5. Yields processed lines that are part of the actual code block content.
 */
export async function* filterCodeBlockLines(
  rawLines: LineStream,
  filepath?: string,
): LineStream {
  let seenFirstFence = false;
  let nestCount = 0;
  let hasCheckedForCodeBlocks = false;
  let buffer: string[] = [];

  // If it's a markdown file, we might want to keep the "preamble" (headers etc.)
  const isMarkdown = filepath ? isMarkdownFile(filepath) : false;

  for await (const line of rawLines) {
    if (!seenFirstFence) {
      if (shouldRemoveLineBeforeStart(line)) {
        seenFirstFence = true;
        nestCount = 1;
        continue;
      }

      // If we haven't seen a fence yet, buffer the lines until we're sure if there are ANY fences
      if (!isMarkdown) {
        buffer.push(line);
        // Only yield if we've determined there are likely NO fences
        if (buffer.length > 50) {
          for (const bufferedLine of buffer) {
            yield bufferedLine;
          }
          buffer = [];
          seenFirstFence = true;
          nestCount = 1;
        }
      } else {
        // For markdown files, we just yield everything until we see a fence, then handle nesting
        yield line;
      }
      continue;
    }

    if (nestCount > 0) {
      const changedEndLine = shouldChangeLineAndStop(line);
      if (typeof changedEndLine === "string") {
        nestCount--;
        if (nestCount === 0) {
          // Closed the outer wrapper
          return;
        }
        yield line;
      } else if (line.trimStart().startsWith("```")) {
        nestCount++;
        yield line;
      } else {
        yield line;
      }
    }
  }

  // If we ended without ever seeing a fence, yield any remaining buffer (the fallback)
  if (!seenFirstFence) {
    for (const line of buffer) {
      yield line;
    }
  }
}

function shouldRemoveLineBeforeStart(line: string): boolean {
  return (
    line.trimStart().startsWith("```") ||
    line.trim() === "[CODE]" ||
    line.trim() === "<COMPLETION>" ||
    line.trim() === "<START EDITING HERE>" ||
    line.trim() === "{{FILL_HERE}}"
  );
}
