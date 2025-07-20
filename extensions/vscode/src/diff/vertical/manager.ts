import { ChatMessage, DiffLine, IDE, ILLM, RuleWithSource } from "core";
import { streamDiffLines } from "core/edit/streamDiffLines";
import { pruneLinesFromBottom, pruneLinesFromTop } from "core/llm/countTokens";
import { getMarkdownLanguageTagForFile } from "core/util";
import * as URI from "uri-js";
import * as vscode from "vscode";

import { isFastApplyModel } from "../../apply/utils";
import EditDecorationManager from "../../quickEdit/EditDecorationManager";
import { handleLLMError } from "../../util/errorHandling";
import { VsCodeWebviewProtocol } from "../../webviewProtocol";

import { ApplyAbortManager } from "core/edit/applyAbortManager";
import { EDIT_MODE_STREAM_ID } from "core/edit/constants";
import { stripImages } from "core/util/messageContent";
import { editOutcomeTracker } from "../../extension/EditOutcomeTracker";
import { VerticalDiffHandler, VerticalDiffHandlerOptions } from "./handler";

export interface VerticalDiffCodeLens {
  id: string;
  start: number;
  numRed: number;
  numGreen: number;
}

export class VerticalDiffManager {
  public refreshCodeLens: () => void = () => { };

  // Generate a simple UUID for diff blocks
  private generateBlockId(): string {
    return 'block-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now().toString(36);
  }

  private forceRefreshCodeLenses() {
    // Use multiple aggressive refresh mechanisms to force immediate UI update
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      // Method 1: Direct CodeLens provider execution
      vscode.commands.executeCommand('vscode.executeCodeLensProvider', editor.document.uri);

      // Method 2: Force editor to completely refresh by simulating minimize/maximize effect
      // This mimics what happens when you minimize/maximize VS Code
      vscode.commands.executeCommand('workbench.action.toggleEditorVisibility').then(() => {
        setTimeout(() => {
          vscode.commands.executeCommand('workbench.action.toggleEditorVisibility');
        }, 1);
      });

      // Method 3: Force a fake document change to trigger complete refresh
      const currentPosition = editor.selection.active;
      const edit = new vscode.WorkspaceEdit();
      edit.insert(editor.document.uri, currentPosition, '');
      vscode.workspace.applyEdit(edit).then(() => {
        // Immediately undo the fake change
        vscode.commands.executeCommand('undo');
      });
    }

    // Also trigger our own refresh mechanism
    this.refreshCodeLens();
  }

  private fileUriToHandler: Map<string, VerticalDiffHandler> = new Map();
  fileUriToCodeLens: Map<string, VerticalDiffCodeLens[]> = new Map();
  public fileUriToOriginalCursorPosition: Map<string, vscode.Position> = new Map();

  private userChangeListener: vscode.Disposable | undefined;

  logDiffs: DiffLine[] | undefined;

  constructor(
    private readonly webviewProtocol: VsCodeWebviewProtocol,
    private readonly editDecorationManager: EditDecorationManager,
    private readonly ide: IDE,
  ) {
    this.userChangeListener = undefined;
  }

  createVerticalDiffHandler(
    fileUri: string,
    startLine: number,
    endLine: number,
    options: VerticalDiffHandlerOptions,
  ): VerticalDiffHandler | undefined {
    if (this.fileUriToHandler.has(fileUri)) {
      this.fileUriToHandler.get(fileUri)?.clear(false);
      this.fileUriToHandler.delete(fileUri);
    }
    const editor = vscode.window.activeTextEditor; // TODO might cause issues if user switches files
    if (editor && URI.equal(editor.document.uri.toString(), fileUri)) {
      const handler = new VerticalDiffHandler(
        startLine,
        endLine,
        editor,
        this.fileUriToCodeLens,
        this.clearForfileUri.bind(this),
        this.refreshCodeLens,
        options,
        this.generateBlockId.bind(this),
      );
      this.fileUriToHandler.set(fileUri, handler);
      return handler;
    } else {
      return undefined;
    }
  }

  getHandlerForFile(fileUri: string) {
    return this.fileUriToHandler.get(fileUri);
  }

  getStreamIdForFile(fileUri: string): string | undefined {
    return this.fileUriToHandler.get(fileUri)?.streamId;
  }

  // Creates a listener for document changes by user.
  private enableDocumentChangeListener(): vscode.Disposable | undefined {
    if (this.userChangeListener) {
      //Only create one listener per file
      return;
    }

    this.userChangeListener = vscode.workspace.onDidChangeTextDocument(
      (event) => {
        // Check if there is an active handler for the affected file
        const fileUri = event.document.uri.toString();
        const handler = this.getHandlerForFile(fileUri);
        if (handler) {
          // If there is an active diff for that file, handle the document change
          this.handleDocumentChange(event, handler);
        }
      },
    );
  }

  // Listener for user doc changes is disabled during updates to the text document by continue
  public disableDocumentChangeListener() {
    if (this.userChangeListener) {
      this.userChangeListener.dispose();
      this.userChangeListener = undefined;
    }
  }

  private handleDocumentChange(
    event: vscode.TextDocumentChangeEvent,
    handler: VerticalDiffHandler,
  ) {
    // Loop through each change in the event
    event.contentChanges.forEach((change) => {
      // Calculate the number of lines added or removed
      const linesAdded = change.text.split("\n").length - 1;
      const linesDeleted = change.range.end.line - change.range.start.line;
      const lineDelta = linesAdded - linesDeleted;

      // Update the diff handler with the new line delta
      handler.updateLineDelta(
        event.document.uri.toString(),
        change.range.start.line,
        lineDelta,
      );
    });
  }

  clearForfileUri(fileUri: string | undefined, accept: boolean) {
    if (!fileUri) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }
      fileUri = activeEditor.document.uri.toString();
    }

    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      handler.clear(accept);
      this.fileUriToHandler.delete(fileUri);
    }

    // Clear ALL stored state for this file
    this.fileUriToCodeLens.delete(fileUri);
    this.fileUriToOriginalCursorPosition.delete(fileUri);

    this.disableDocumentChangeListener();

    vscode.commands.executeCommand("setContext", "continue.diffVisible", false);

    // Force immediate CodeLens refresh to ensure Accept All/Edit & Retry/Reject All buttons disappear
    this.forceRefreshCodeLenses();
  }

  async acceptRejectVerticalDiffBlock(
    accept: boolean,
    fileUri?: string,
    blockId?: string,
  ) {
    if (!fileUri) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }
      fileUri = activeEditor.document.uri.toString();
    }

    if (!blockId) {
      console.warn("No block ID provided for acceptRejectVerticalDiffBlock");
      return;
    }

    const blocks = this.fileUriToCodeLens.get(fileUri);
    if (!blocks || blocks.length === 0) {
      return;
    }

    // Find the block by UUID instead of index
    const blockIndex = blocks.findIndex(block => block.id === blockId);
    if (blockIndex === -1) {
      console.warn(`Block with ID ${blockId} not found`);
      return;
    }

    const block = blocks[blockIndex];
    const handler = this.getHandlerForFile(fileUri);
    if (!handler) {
      return;
    }

    // Disable listening to file changes while continue makes changes
    this.disableDocumentChangeListener();

    try {
      // Accept/reject the block - skip the handler's automatic block management
      await handler.acceptRejectBlock(
        accept,
        block.start,
        block.numGreen,
        block.numRed,
        true, // Skip status update, we'll handle it ourselves
      );

      // Calculate the line offset caused by this operation
      const lineOffset = accept ? -block.numRed : -block.numGreen;

      // Remove the processed block from our array by UUID
      const updatedBlocks = blocks.filter(b => b.id !== blockId);

      // IMMEDIATELY update the state so CodeLens provider sees the change
      this.fileUriToCodeLens.set(fileUri, updatedBlocks);

      // Force immediate refresh right after state update
      this.forceRefreshCodeLenses();

      // Update the positions of remaining blocks that come after the processed block
      for (let i = 0; i < updatedBlocks.length; i++) {
        if (updatedBlocks[i].start > block.start) {
          updatedBlocks[i] = {
            ...updatedBlocks[i],
            start: updatedBlocks[i].start + lineOffset,
          };
        }
      }

      // Check if all blocks are processed
      if (updatedBlocks.length === 0) {
        // All blocks processed - use the SAME reliable clearing mechanism as Accept All/Reject All
        // This is the key fix - use the proven clearForfileUri method with correct accept parameter
        this.clearForfileUri(fileUri, accept);
      } else {
        // Still have blocks remaining - update state and continue
        this.fileUriToCodeLens.set(fileUri, updatedBlocks);
        // Re-enable listener for user changes to file
        this.enableDocumentChangeListener();

        // Update status
        handler.options.onStatusUpdate?.(
          undefined,
          updatedBlocks.length,
          vscode.window.activeTextEditor?.document.getText(),
        );
        // Force refresh to update remaining CodeLenses
        this.forceRefreshCodeLenses();
      }
    } catch (error) {
      console.error("Error in acceptRejectVerticalDiffBlock:", error);
      // Re-enable listener even if there was an error
      this.enableDocumentChangeListener();
      // Refresh to ensure consistent state
      this.refreshCodeLens();
    }
  }

  async streamDiffLines(
    diffStream: AsyncGenerator<DiffLine>,
    instant: boolean,
    streamId: string,
    toolCallId?: string,
  ) {
    vscode.commands.executeCommand("setContext", "continue.diffVisible", true);

    // Get the current editor fileUri/range
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const fileUri = editor.document.uri.toString();
    const startLine = 0;
    const endLine = editor.document.lineCount - 1;

    // Check for existing handlers in the same file the new one will be created in
    const existingHandler = this.getHandlerForFile(fileUri);
    if (existingHandler) {
      existingHandler.clear(false);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });

    // Create new handler with determined start/end
    const diffHandler = this.createVerticalDiffHandler(
      fileUri,
      startLine,
      endLine,
      {
        instant,
        onStatusUpdate: (status, numDiffs, fileContent) =>
          void this.webviewProtocol.request("updateApplyState", {
            streamId,
            status,
            numDiffs,
            fileContent,
            filepath: fileUri,
            toolCallId,
          }),
        streamId,
      },
    );

    if (!diffHandler) {
      console.warn("Issue occurred while creating new vertical diff handler");
      return;
    }

    if (editor.selection) {
      // Unselect the range
      editor.selection = new vscode.Selection(
        editor.selection.active,
        editor.selection.active,
      );
    }

    vscode.commands.executeCommand(
      "setContext",
      "continue.streamingDiff",
      true,
    );

    try {
      this.logDiffs = await diffHandler.run(diffStream);

      // enable a listener for user edits to file while diff is open
      this.enableDocumentChangeListener();
    } catch (e) {
      this.disableDocumentChangeListener();
      const handled = await handleLLMError(e);
      if (!handled) {
        let message = "Error streaming diffs";
        if (e instanceof Error) {
          message += `: ${e.message}`;
        }
        throw new Error(message);
      }
    } finally {
      vscode.commands.executeCommand(
        "setContext",
        "continue.streamingDiff",
        false,
      );
    }
  }

  async streamEdit({
    input,
    llm,
    streamId,
    quickEdit,
    range,
    newCode,
    toolCallId,
    rulesToInclude,
  }: {
    input: string;
    llm: ILLM;
    streamId?: string;
    quickEdit?: string;
    range?: vscode.Range;
    newCode?: string;
    toolCallId?: string;
    rulesToInclude: undefined | RuleWithSource[];
  }): Promise<string | undefined> {
    void vscode.commands.executeCommand(
      "setContext",
      "continue.diffVisible",
      true,
    );

    let editor = vscode.window.activeTextEditor;

    if (!editor) {
      return undefined;
    }

    const fileUri = editor.document.uri.toString();

    // Store the original cursor position (start of selection) before the diff starts
    this.fileUriToOriginalCursorPosition.set(fileUri, editor.selection.start);

    let startLine, endLine: number;

    if (range) {
      startLine = range.start.line;
      endLine = range.end.line;
    } else {
      startLine = editor.selection.start.line;
      endLine = editor.selection.end.line;
    }

    // Check for existing handlers in the same file the new one will be created in
    const existingHandler = this.getHandlerForFile(fileUri);

    if (existingHandler) {
      if (quickEdit) {
        // Previous diff was a quickEdit
        // Check if user has highlighted a range
        let rangeBool =
          startLine !== endLine ||
          editor.selection.start.character !== editor.selection.end.character;

        // Check if the range is different from the previous range
        let newRangeBool =
          startLine !== existingHandler.range.start.line ||
          endLine !== existingHandler.range.end.line;

        if (!rangeBool || !newRangeBool) {
          // User did not highlight a new range -> use start/end from the previous quickEdit
          startLine = existingHandler.range.start.line;
          endLine = existingHandler.range.end.line;
        }
      }

      // Clear the previous handler
      // This allows the user to edit above the changed area,
      // but extra delta was added for each line generated by Continue
      // Before adding this back, we need to distinguish between human and Continue
      // let effectiveLineDelta =
      //   existingHandler.getLineDeltaBeforeLine(startLine);
      // startLine += effectiveLineDelta;
      // endLine += effectiveLineDelta;

      await existingHandler.clear(false);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });

    // Create new handler with determined start/end
    const diffHandler = this.createVerticalDiffHandler(
      fileUri,
      startLine,
      endLine,
      {
        instant: isFastApplyModel(llm),
        input,
        onStatusUpdate: (status, numDiffs, fileContent) =>
          streamId &&
          void this.webviewProtocol.request("updateApplyState", {
            streamId,
            status,
            numDiffs,
            fileContent,
            filepath: fileUri,
            toolCallId,
          }),
        streamId,
      },
    );

    if (!diffHandler) {
      console.warn("Issue occurred while creating new vertical diff handler");
      return undefined;
    }

    let selectedRange = diffHandler.range;

    // Only if the selection is empty, use exact prefix/suffix instead of by line
    if (selectedRange.isEmpty) {
      selectedRange = new vscode.Range(
        editor.selection.start.with(undefined, 0),
        editor.selection.end.with(undefined, Number.MAX_SAFE_INTEGER),
      );
    }

    const rangeContent = editor.document.getText(selectedRange);
    const prefix = pruneLinesFromTop(
      editor.document.getText(
        new vscode.Range(new vscode.Position(0, 0), selectedRange.start),
      ),
      llm.contextLength / 4,
      llm.model,
    );
    const suffix = pruneLinesFromBottom(
      editor.document.getText(
        new vscode.Range(
          selectedRange.end,
          new vscode.Position(editor.document.lineCount, 0),
        ),
      ),
      llm.contextLength / 4,
      llm.model,
    );

    let overridePrompt: ChatMessage[] | undefined;
    if (llm.promptTemplates?.apply) {
      const rendered = llm.renderPromptTemplate(llm.promptTemplates.apply, [], {
        original_code: rangeContent,
        new_code: newCode ?? "",
      });
      overridePrompt =
        typeof rendered === "string"
          ? [{ role: "user", content: rendered }]
          : rendered;
    }

    if (editor.selection) {
      // Unselect the range
      editor.selection = new vscode.Selection(
        editor.selection.active,
        editor.selection.active,
      );
    }

    void vscode.commands.executeCommand(
      "setContext",
      "continue.streamingDiff",
      true,
    );

    this.editDecorationManager.clear();

    const abortManager = ApplyAbortManager.getInstance();
    const abortController = abortManager.get(fileUri);

    try {
      const streamedLines: string[] = [];

      async function* recordedStream() {
        const stream = streamDiffLines({
          highlighted: rangeContent,
          prefix,
          suffix,
          llm,
          rulesToInclude,
          input,
          language: getMarkdownLanguageTagForFile(fileUri),
          overridePrompt,
          abortController,
        });

        // Collect all diff lines first instead of streaming them
        const allDiffLines: DiffLine[] = [];
        for await (const line of stream) {
          if (line.type === "new" || line.type === "same") {
            streamedLines.push(line.line);
          }
          allDiffLines.push(line);
        }

        // Now yield all lines at once to show the complete diff
        for (const line of allDiffLines) {
          yield line;
        }
      }

      this.logDiffs = await diffHandler.run(recordedStream());

      // enable a listener for user edits to file while diff is open
      this.enableDocumentChangeListener();

      if (abortController.signal.aborted) {
        void vscode.commands.executeCommand("continue.rejectDiff");
      }

      const fileAfterEdit = `${prefix}${streamedLines.join("\n")}${suffix}`;
      await this.trackEditInteraction({
        model: llm,
        filepath: fileUri,
        prompt: input,
        fileAfterEdit,
      });

      return fileAfterEdit;
    } catch (e) {
      this.disableDocumentChangeListener();
      const handled = await handleLLMError(e);
      if (!handled) {
        let message = "Error streaming edit diffs";
        if (e instanceof Error) {
          message += `: ${e.message}`;
        }
        throw new Error(message);
      }
    } finally {
      void vscode.commands.executeCommand(
        "setContext",
        "continue.streamingDiff",
        false,
      );
    }
  }

  async trackEditInteraction({
    model,
    filepath,
    prompt,
    fileAfterEdit,
  }: {
    model: ILLM;
    filepath: string;
    prompt: string;
    fileAfterEdit: string | undefined;
  }) {
    // Get previous code content for outcome tracking
    const previousCode = await this.ide.readFile(filepath);
    const newCode = fileAfterEdit ?? "";
    const previousCodeLines = previousCode.split("\n").length;
    const newCodeLines = newCode.split("\n").length;
    const lineChange = newCodeLines - previousCodeLines;

    // Store pending edit data for outcome tracking
    editOutcomeTracker.trackEditInteraction({
      streamId: EDIT_MODE_STREAM_ID,
      timestamp: new Date().toISOString(),
      modelProvider: model.underlyingProviderName,
      modelTitle: model.title ?? "",
      prompt: stripImages(prompt),
      completion: newCode,
      previousCode,
      newCode,
      filepath: filepath,
      previousCodeLines,
      newCodeLines,
      lineChange,
    });
  }
}
