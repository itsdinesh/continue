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
      return codeLenses;
    }

    // Add CodeLenses at original cursor position only when there are active diffs
    const originalCursorPosition = this.fileUriToOriginalCursorPosition.get(uri);
    if (originalCursorPosition) {
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
        new vscode.CodeLens(cursorRange, {
          title: `Accept`,
          command: "continue.acceptVerticalDiffBlock",
          arguments: [uri, 0], // Using 0 as default block index for cursor position
        }),
        new vscode.CodeLens(cursorRange, {
          title: `Reject`,
          command: "continue.rejectVerticalDiffBlock",
          arguments: [uri, 0], // Using 0 as default block index for cursor position
        }),
      );
    }

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
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
          arguments: [uri, i],
        }),
        new vscode.CodeLens(range, {
          title: `Reject`,
          command: "continue.rejectVerticalDiffBlock",
          arguments: [uri, i],
        }),
      );
    }

    return codeLenses;
  }
}
