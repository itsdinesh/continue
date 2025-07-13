import * as vscode from "vscode";
import { VerticalDiffCodeLens } from "../../../diff/vertical/manager";
import { getMetaKeyLabel } from "../../../util/util";

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
  ) {}

  public provideCodeLenses(
    document: vscode.TextDocument,
    _: vscode.CancellationToken,
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const filepath = document.uri.fsPath;
    const blocks = this.editorToVerticalDiffCodeLens.get(filepath);

    if (!blocks) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const start = new vscode.Position(block.start, 0);
      const range = new vscode.Range(
        start,
        start.translate(block.numGreen + block.numRed),
      );

      if (codeLenses.length === 0) {
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `✔ Accept All`,
            command: "continue.acceptDiff",
          }),
          new vscode.CodeLens(range, {
            title: `Edit & Retry`,
            command: "continue.quickEdit",
          }),
          new vscode.CodeLens(range, {
            title: `✘ Reject All`,
            command: "continue.rejectDiff",
          }),
        );
      }

      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `Accept`,
          command: "continue.acceptVerticalDiffBlock",
          arguments: [filepath, i],
        }),
        new vscode.CodeLens(range, {
          title: `Reject`,
          command: "continue.rejectVerticalDiffBlock",
          arguments: [filepath, i],
        }),
      );
    }

    return codeLenses;
  }
}
