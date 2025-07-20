import * as vscode from "vscode";

const removedLineDecorationType = (line: string) =>
  vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: { id: "diffEditor.removedLineBackground" },
    outlineWidth: "1px",
    outlineStyle: "solid",
    outlineColor: { id: "diffEditor.removedTextBorder" },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: {
      contentText: line,
      color: "#808080",
      textDecoration: "none; white-space: pre",
    },
    // NOTE this has the effect of hiding text the user enters into a red line, which may cause linting errors
    // But probably worth saving the ugly effect of having the ghost text after entered text
    // And resolved upon accept/reject when line deleted anyways
    textDecoration: "none; display: none",
  });

const addedLineDecorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: { id: "diffEditor.insertedLineBackground" },
  outlineWidth: "1px",
  outlineStyle: "solid",
  outlineColor: { id: "diffEditor.insertedTextBorder" },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

export const indexDecorationType = vscode.window.createTextEditorDecorationType(
  {
    isWholeLine: true,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  },
);
export const belowIndexDecorationType =
  vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

// Progressive fade decoration types for processed lines
const createFadeDecorationType = (opacity: number) =>
  vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: `rgba(255, 255, 255, ${opacity})`,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

// Create multiple fade levels for smooth transition
export const fadeDecorationTypes = [
  createFadeDecorationType(0.15), // Most recent
  createFadeDecorationType(0.12),
  createFadeDecorationType(0.09),
  createFadeDecorationType(0.06),
  createFadeDecorationType(0.03), // Oldest, almost transparent
];

// Class for managing progressive fade decorations for processed lines
export class ProgressiveFadeManager {
  private processedLines: Array<{ line: number; timestamp: number }> = [];
  private fadeIntervals: NodeJS.Timeout[] = [];
  private readonly maxFadeSteps = 5;
  private readonly fadeStepDuration = 500; // ms between fade steps (faster for better feedback)

  constructor(private editor: vscode.TextEditor) {}

  applyToNewEditor(newEditor: vscode.TextEditor) {
    this.editor = newEditor;
    this.updateDecorations();
  }

  addProcessedLine(lineNumber: number) {
    const timestamp = Date.now();
    this.processedLines.push({ line: lineNumber, timestamp });
    
    // Start fade animation for this line
    this.startFadeAnimation(lineNumber, timestamp);
    this.updateDecorations();
  }

  private startFadeAnimation(lineNumber: number, timestamp: number) {
    let step = 0;
    const fadeInterval = setInterval(() => {
      step++;
      if (step >= this.maxFadeSteps) {
        clearInterval(fadeInterval);
        // Remove from processed lines when fully faded
        this.processedLines = this.processedLines.filter(
          p => p.line !== lineNumber || p.timestamp !== timestamp
        );
        this.updateDecorations();
        return;
      }
      this.updateDecorations();
    }, this.fadeStepDuration);

    this.fadeIntervals.push(fadeInterval);
  }

  private updateDecorations() {
    const now = Date.now();
    
    // Group lines by fade level
    const fadeGroups: vscode.Range[][] = Array(this.maxFadeSteps).fill(null).map(() => []);
    
    for (const processed of this.processedLines) {
      const elapsed = now - processed.timestamp;
      const fadeStep = Math.min(
        Math.floor(elapsed / this.fadeStepDuration),
        this.maxFadeSteps - 1
      );
      
      if (fadeStep < this.maxFadeSteps) {
        const range = new vscode.Range(
          processed.line,
          0,
          processed.line,
          Number.MAX_SAFE_INTEGER
        );
        fadeGroups[fadeStep].push(range);
      }
    }

    // Apply decorations for each fade level
    fadeGroups.forEach((ranges, index) => {
      if (index < fadeDecorationTypes.length) {
        this.editor.setDecorations(fadeDecorationTypes[index], ranges);
      }
    });
  }

  shiftDownAfterLine(afterLine: number, offset: number) {
    this.processedLines = this.processedLines.map(processed => ({
      ...processed,
      line: processed.line >= afterLine ? processed.line + offset : processed.line
    }));
    this.updateDecorations();
  }

  clear() {
    // Clear all fade intervals
    this.fadeIntervals.forEach(interval => clearInterval(interval));
    this.fadeIntervals = [];
    
    // Clear processed lines
    this.processedLines = [];
    
    // Clear all decorations
    fadeDecorationTypes.forEach(decorationType => {
      this.editor.setDecorations(decorationType, []);
    });
  }
}

function translateRange(range: vscode.Range, lineOffset: number): vscode.Range {
  return new vscode.Range(
    range.start.translate(lineOffset),
    range.end.translate(lineOffset),
  );
}

// Class for managing highlight decorations for added lines (e.g. GREEN)
export class AddedLineDecorationManager {
  constructor(private editor: vscode.TextEditor) {}

  ranges: vscode.Range[] = [];
  decorationType = addedLineDecorationType;

  applyToNewEditor(newEditor: vscode.TextEditor) {
    this.editor = newEditor;
    this.editor.setDecorations(this.decorationType, this.ranges);
  }

  addLines(startIndex: number, numLines: number) {
    const lastRange = this.ranges[this.ranges.length - 1];
    if (lastRange && lastRange.end.line === startIndex - 1) {
      this.ranges[this.ranges.length - 1] = lastRange.with(
        undefined,
        lastRange.end.translate(numLines),
      );
    } else {
      this.ranges.push(
        new vscode.Range(
          startIndex,
          0,
          startIndex + numLines - 1,
          Number.MAX_SAFE_INTEGER,
        ),
      );
    }

    this.editor.setDecorations(this.decorationType, this.ranges);
  }

  addLine(index: number) {
    this.addLines(index, 1);
  }

  clear() {
    this.ranges = [];
    this.editor.setDecorations(this.decorationType, this.ranges);
  }

  shiftDownAfterLine(afterLine: number, offset: number) {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.ranges[i].start.line >= afterLine) {
        this.ranges[i] = translateRange(this.ranges[i], offset);
      }
    }
    this.editor.setDecorations(this.decorationType, this.ranges);
  }

  deleteRangeStartingAt(line: number) {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.ranges[i].start.line === line) {
        return this.ranges.splice(i, 1)[0];
      }
    }
    this.editor.setDecorations(this.decorationType, this.ranges);
  }
}

// Class for managing ghost-text decorations for removed lines (e.g. RED)
// Behavior is slightly different all around
// because each line will have a unique decoration type
export class RemovedLineDecorationManager {
  constructor(private editor: vscode.TextEditor) {}

  ranges: {
    line: string;
    range: vscode.Range;
    decoration: vscode.TextEditorDecorationType;
  }[] = [];

  applyToNewEditor(newEditor: vscode.TextEditor) {
    this.editor = newEditor;
    this.applyDecorations();
  }

  addLines(startIndex: number, lines: string[]) {
    let i = 0;
    for (const line of lines) {
      this.ranges.push({
        line,
        range: new vscode.Range(
          startIndex + i,
          0,
          startIndex + i,
          Number.MAX_SAFE_INTEGER,
        ),
        decoration: removedLineDecorationType(line),
      });
      i++;
    }
    this.applyDecorations();
  }

  addLine(index: number, line: string) {
    this.addLines(index, [line]);
  }

  applyDecorations() {
    this.ranges.forEach((r) => {
      this.editor.setDecorations(r.decoration, [r.range]);
    });
  }

  // Removed decorations are always unique, so we'll always dispose
  clear() {
    this.ranges.forEach((r) => {
      r.decoration.dispose();
    });
    this.ranges = [];
  }

  shiftDownAfterLine(afterLine: number, offset: number) {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.ranges[i].range.start.line >= afterLine) {
        this.ranges[i].range = translateRange(this.ranges[i].range, offset);
      }
    }
    this.applyDecorations();
  }

  // Red ranges are always single-line, so to delete group, delete sequential ranges
  deleteRangesStartingAt(line: number) {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.ranges[i].range.start.line === line) {
        let sequential = 0;
        while (
          i + sequential < this.ranges.length &&
          this.ranges[i + sequential].range.start.line === line + sequential
        ) {
          this.ranges[i + sequential].decoration.dispose();
          sequential++;
        }
        return this.ranges.splice(i, sequential);
      }
    }
  }
}
