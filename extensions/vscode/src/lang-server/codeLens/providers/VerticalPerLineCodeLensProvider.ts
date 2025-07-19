import * as vscode from "vscode";
import { VerticalDiffCodeLens } from "../../../diff/vertical/manager";
export class VerticalDiffCodeLensProvider implements vscode.CodeLensProvider {
  private _eventEmitter: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();

  onDidChangeCodeLenses: vscode.Event<void> = this._eventEmitter.event;

  public refresh(): void {
    this._eventEmitter.fire();
  }

  constructor(
    private readonly editorToVerticalDiffCodeLens: Map<
      string,
      VerticalDiffCodeLens[]
    >,
    private readonly fileUriToOriginalCursorPosition: Map<string, vscode.Position>,
  ) { }

  private getCursorPosition(document: vscode.TextDocument): vscode.Position | null {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document.uri.toString() !== document.uri.toString()) {
      return null;
    }

    // Get the primary cursor position (first selection)
    const selection = activeEditor.selection;
    return selection.active;
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _: vscode.CancellationToken,
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const uri = document.uri.toString();
    const blocks = this.editorToVerticalDiffCodeLens.get(uri);
    const codeLenses: vscode.CodeLens[] = [];

    // Only show CodeLenses if there are active diff blocks
    if (!blocks || blocks.length === 0) {
      // No blocks means no CodeLenses at all - including Accept All/Edit & Retry/Reject All
      return codeLenses;
    }

    // Validate that blocks actually contain valid data
    const validBlocks = blocks.filter(block => 
      block && 
      typeof block.start === 'number' && 
      typeof block.numGreen === 'number' && 
      typeof block.numRed === 'number' &&
      block.id
    );

    // If no valid blocks, return empty CodeLenses
    if (validBlocks.length === 0) {
      return codeLenses;
    }

    // Add CodeLenses at original cursor position ONLY when there are valid active diffs
    const originalCursorPosition = this.fileUriToOriginalCursorPosition.get(uri);
    if (originalCursorPosition && validBlocks.length > 0) {
      const cursorRange = new vscode.Range(originalCursorPosition, originalCursorPosition);

      codeLenses.push(
        new vscode.CodeLens(cursorRange, {
          title: `✔ Accept All`,
          command: "continue.acceptDiff",
        }),
        new vscode.CodeLens(cursorRange, {
          title: `Edit & Retry`,
          command: "continue.quickEdit",
        }),
        new vscode.CodeLens(cursorRange, {
          title: `✘ Reject All`,
          command: "continue.rejectDiff",
        }),
      );
    }

    for (let i = 0; i < validBlocks.length; i++) {
      const block = validBlocks[i];
      const start = new vscode.Position(block.start, 0);
      const range = new vscode.Range(
        start,
        start.translate(block.numGreen + block.numRed),
      );

      // if (codeLenses.length === 5) { // Only add these once (after cursor CodeLenses)
      //   codeLenses.push(
      //     new vscode.CodeLens(range, {
      //       title: `✔ Accept All`,
      //       command: "continue.acceptDiff",
      //     }),
      //     new vscode.CodeLens(range, {
      //       title: `Edit & Retry`,
      //       command: "continue.quickEdit",
      //     }),
      //     new vscode.CodeLens(range, {
      //       title: `✘ Reject All`,
      //       command: "continue.rejectDiff",
      //     }),
      //   );
      // }

      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `Accept`,
          command: "continue.acceptVerticalDiffBlock",
          arguments: [uri, block.id],
        }),
        new vscode.CodeLens(range, {
          title: `Reject`,
          command: "continue.rejectVerticalDiffBlock",
          arguments: [uri, block.id],
        }),
      );
    }

    return codeLenses;
  }
}
