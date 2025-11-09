import * as vscode from "vscode";

import { VerticalDiffCodeLens } from "../../../diff/vertical/manager";

/**
 * State of the diff operation
 */
export enum DiffState {
  Idle = "idle",
  Working = "working",
  Streaming = "streaming",
  Applied = "applied",
}

/**
 * Fast CodeLens provider for vertical diffs based on Cody's architecture.
 * 
 * Key performance optimizations:
 * 1. Synchronous provideCodeLenses - no async operations
 * 2. Cached lenses in Map for O(1) lookup
 * 3. Immediate event firing - no delays
 * 4. Only regenerate affected lenses
 */
export class FastVerticalDiffCodeLensProvider implements vscode.CodeLensProvider {
  // CRITICAL: EventEmitter for immediate updates
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  // CRITICAL: Cache lenses by file URI for O(1) lookup
  private cachedLenses = new Map<string, vscode.CodeLens[]>();
  
  // Track the state of each file's diff operation
  private fileUriToState = new Map<string, DiffState>();

  constructor(
    private readonly editorToVerticalDiffCodeLens: Map<string, VerticalDiffCodeLens[]>,
    private readonly fileUriToOriginalCursorPosition: Map<string, vscode.Position>,
  ) {
    // Bind to preserve 'this' context
    this.provideCodeLenses = this.provideCodeLenses.bind(this);
  }

  /**
   * CRITICAL: Must be synchronous and fast (< 5ms target)
   * Just return cached lenses - no computation here
   */
  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const uri = document.uri.toString();
    
    console.log(`[FastCodeLens] provideCodeLenses called for ${uri}`);
    
    // Fast exit if no cached lenses
    const cached = this.cachedLenses.get(uri);
    if (cached) {
      console.log(`[FastCodeLens] Returning ${cached.length} cached lenses`);
      return cached;
    }

    // Generate lenses if not cached (first time)
    const lenses = this.generateLensesForUri(uri);
    this.cachedLenses.set(uri, lenses);
    console.log(`[FastCodeLens] Generated and cached ${lenses.length} lenses`);
    return lenses;
  }

  /**
   * CRITICAL: Called by VerticalDiffManager on updates
   * Regenerates lenses and fires change event immediately
   */
  public refresh(uri?: string): void {
    if (uri) {
      // Update specific file
      const lenses = this.generateLensesForUri(uri);
      this.cachedLenses.set(uri, lenses);
    } else {
      // Update all files
      this.cachedLenses.clear();
    }

    // CRITICAL: Fire immediately - no delays
    this._onDidChangeCodeLenses.fire();
  }

  /**
   * Set the state for a file (working, streaming, applied)
   */
  public setState(uri: string, state: DiffState): void {
    console.log(`[FastCodeLens] setState called: ${uri}, state: ${state}`);
    this.fileUriToState.set(uri, state);
    this.refresh(uri);
  }

  /**
   * Remove lenses for a specific file
   */
  public removeLensesFor(uri: string): void {
    if (this.cachedLenses.delete(uri)) {
      this.fileUriToState.delete(uri);
      this._onDidChangeCodeLenses.fire();
    }
  }

  /**
   * CRITICAL: Fast lens generation (< 5ms target)
   * Pre-compute everything here, not in provideCodeLenses
   */
  private generateLensesForUri(uri: string): vscode.CodeLens[] {
    const state = this.fileUriToState.get(uri) || DiffState.Idle;
    const blocks = this.editorToVerticalDiffCodeLens.get(uri);
    const originalCursorPosition = this.fileUriToOriginalCursorPosition.get(uri);
    const codeLenses: vscode.CodeLens[] = [];

    console.log(`[FastCodeLens] Generating lenses for ${uri}, state: ${state}, blocks: ${blocks?.length || 0}, cursorPos: ${originalCursorPosition ? 'set' : 'not set'}`);

    // Show loading state lenses
    if (state === DiffState.Working || state === DiffState.Streaming) {
      if (originalCursorPosition) {
        const cursorRange = new vscode.Range(originalCursorPosition, originalCursorPosition);
        
        const loadingTitle = "$(sync~spin)  Continue is working...";
        
        codeLenses.push(
          this.createLens(cursorRange, loadingTitle, "continue.focusContinueInput", []),
          this.createLens(cursorRange, "Cancel", "continue.rejectDiff", [uri]),
        );
        console.log(`[FastCodeLens] Generated ${codeLenses.length} loading lenses`);
      } else {
        console.log(`[FastCodeLens] No cursor position set, cannot show loading lenses`);
      }
      return codeLenses;
    }

    // Fast exit if no blocks and not in a working state
    if (!blocks || blocks.length === 0) {
      return codeLenses;
    }

    // Validate blocks
    const validBlocks = blocks.filter(
      (block) =>
        block &&
        typeof block.start === "number" &&
        typeof block.numGreen === "number" &&
        typeof block.numRed === "number" &&
        block.id,
    );

    if (validBlocks.length === 0) {
      return codeLenses;
    }

    // Add top-level lenses at original cursor position (Applied state)
    // ALWAYS show "Accept All" and "Reject All" to keep UI consistent
    if (originalCursorPosition) {
      // CRITICAL: To ensure top-level lenses ALWAYS appear first, we use a range that
      // starts at the cursor position but ends at a position that's guaranteed to sort
      // before any block ranges. We use the same line but with character position 0.
      // Block ranges will use character position 1 or span multiple lines.
      const topLevelStart = new vscode.Position(originalCursorPosition.line, 0);
      const topLevelEnd = new vscode.Position(originalCursorPosition.line, 0);
      const topLevelRange = new vscode.Range(topLevelStart, topLevelEnd);

      codeLenses.push(
        this.createLens(topLevelRange, "✔ Accept All", "continue.acceptDiff", [uri]),
        this.createLens(topLevelRange, "Edit & Retry", "continue.quickEdit", []),
        this.createLens(topLevelRange, "✘ Reject All", "continue.rejectDiff", [uri]),
      );
    }

    // Add block-level lenses for ALL blocks
    // CRITICAL: For blocks, we use a range that starts at character 1 (or spans multiple lines)
    // to ensure they sort AFTER the top-level lenses which use character 0.
    for (const block of validBlocks) {
      const blockStart = new vscode.Position(block.start, 1);
      const totalLines = block.numGreen + block.numRed;
      
      // If the block spans multiple lines, use the actual end position
      // Otherwise, use character 2 to ensure it sorts after top-level lenses
      const blockEnd = totalLines > 0 
        ? new vscode.Position(block.start + totalLines, 0)
        : new vscode.Position(block.start, 2);
      
      const range = new vscode.Range(blockStart, blockEnd);

      codeLenses.push(
        this.createLens(range, "Accept", "continue.acceptVerticalDiffBlock", [uri, block.id]),
        this.createLens(range, "Reject", "continue.rejectVerticalDiffBlock", [uri, block.id]),
      );
    }

    console.log(`[FastCodeLens] Generated ${codeLenses.length} lenses total`);
    return codeLenses;
  }

  /**
   * CRITICAL: Helper to create lens quickly
   */
  private createLens(
    range: vscode.Range,
    title: string,
    command: string,
    args: any[],
  ): vscode.CodeLens {
    const lens = new vscode.CodeLens(range);
    lens.command = {
      title,
      command,
      arguments: args,
    };
    return lens;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.cachedLenses.clear();
    this.fileUriToState.clear();
    this._onDidChangeCodeLenses.dispose();
  }
}
