import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock vscode module
vi.mock("vscode", () => ({
  Position: class {
    constructor(
      public line: number,
      public character: number,
    ) {}
    translate(lines: number, characters: number = 0) {
      return new (this.constructor as any)(
        this.line + lines,
        this.character + characters,
      );
    }
  },
  Range: class {
    constructor(
      public start: any,
      public end: any,
    ) {}
    translate(lines: number) {
      return new (this.constructor as any)(
        { line: this.start.line + lines, character: this.start.character },
        { line: this.end.line + lines, character: this.end.character },
      );
    }
  },
  CodeLens: class {
    public command?: any;
    constructor(public range: any) {}
  },
  EventEmitter: class {
    private listeners: any[] = [];
    get event() {
      return (listener: any) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      };
    }
    fire(data?: any) {
      this.listeners.forEach((listener) => listener(data));
    }
    dispose() {
      this.listeners = [];
    }
  },
}));

import * as vscode from "vscode";

import { VerticalDiffCodeLens } from "../../../diff/vertical/manager";

import { FastVerticalDiffCodeLensProvider } from "./FastVerticalDiffCodeLensProvider";

describe("FastVerticalDiffCodeLensProvider", () => {
  let provider: FastVerticalDiffCodeLensProvider;
  let editorToVerticalDiffCodeLens: Map<string, VerticalDiffCodeLens[]>;
  let fileUriToOriginalCursorPosition: Map<string, vscode.Position>;

  beforeEach(() => {
    editorToVerticalDiffCodeLens = new Map();
    fileUriToOriginalCursorPosition = new Map();
    provider = new FastVerticalDiffCodeLensProvider(
      editorToVerticalDiffCodeLens,
      fileUriToOriginalCursorPosition,
    );
  });

  it("should return empty array when no blocks exist", () => {
    const document = {
      uri: { toString: () => "file:///test.ts" },
    } as vscode.TextDocument;

    const lenses = provider.provideCodeLenses(
      document,
      {} as vscode.CancellationToken,
    );

    expect(lenses).toEqual([]);
  });

  it("should generate lenses for valid blocks", () => {
    const uri = "file:///test.ts";
    const blocks: VerticalDiffCodeLens[] = [
      { id: "block-1", start: 10, numGreen: 2, numRed: 1 },
      { id: "block-2", start: 20, numGreen: 3, numRed: 2 },
    ];

    editorToVerticalDiffCodeLens.set(uri, blocks);
    fileUriToOriginalCursorPosition.set(uri, new vscode.Position(5, 0));

    const document = {
      uri: { toString: () => uri },
    } as vscode.TextDocument;

    const lenses = provider.provideCodeLenses(
      document,
      {} as vscode.CancellationToken,
    );

    // Should have 3 top-level lenses + 2 lenses per block (Accept/Reject)
    expect(lenses.length).toBe(3 + blocks.length * 2);

    // Check top-level lenses
    expect(lenses[0].command?.title).toContain("Accept All");
    expect(lenses[1].command?.title).toContain("Edit & Retry");
    expect(lenses[2].command?.title).toContain("Reject All");

    // Check block-level lenses
    expect(lenses[3].command?.title).toBe("Accept");
    expect(lenses[4].command?.title).toBe("Reject");
    expect(lenses[5].command?.title).toBe("Accept");
    expect(lenses[6].command?.title).toBe("Reject");
  });

  it("should cache lenses for performance", () => {
    const uri = "file:///test.ts";
    const blocks: VerticalDiffCodeLens[] = [
      { id: "block-1", start: 10, numGreen: 2, numRed: 1 },
    ];

    editorToVerticalDiffCodeLens.set(uri, blocks);
    fileUriToOriginalCursorPosition.set(uri, new vscode.Position(5, 0));

    const document = {
      uri: { toString: () => uri },
    } as vscode.TextDocument;

    // First call should generate and cache
    const lenses1 = provider.provideCodeLenses(
      document,
      {} as vscode.CancellationToken,
    );

    // Second call should return cached lenses
    const lenses2 = provider.provideCodeLenses(
      document,
      {} as vscode.CancellationToken,
    );

    // Should be the same array reference (cached)
    expect(lenses1).toBe(lenses2);
  });

  it("should refresh lenses when refresh is called", () => {
    const uri = "file:///test.ts";
    const blocks: VerticalDiffCodeLens[] = [
      { id: "block-1", start: 10, numGreen: 2, numRed: 1 },
    ];

    editorToVerticalDiffCodeLens.set(uri, blocks);
    fileUriToOriginalCursorPosition.set(uri, new vscode.Position(5, 0));

    const document = {
      uri: { toString: () => uri },
    } as vscode.TextDocument;

    // First call
    const lenses1 = provider.provideCodeLenses(
      document,
      {} as vscode.CancellationToken,
    );

    // Update blocks
    const newBlocks: VerticalDiffCodeLens[] = [
      { id: "block-1", start: 10, numGreen: 2, numRed: 1 },
      { id: "block-2", start: 20, numGreen: 3, numRed: 2 },
    ];
    editorToVerticalDiffCodeLens.set(uri, newBlocks);

    // Refresh
    provider.refresh(uri);

    // Second call should return new lenses
    const lenses2 = provider.provideCodeLenses(
      document,
      {} as vscode.CancellationToken,
    );

    // Should be different (not cached)
    expect(lenses1).not.toBe(lenses2);
    expect(lenses2.length).toBe(3 + newBlocks.length * 2);
  });

  it("should filter out invalid blocks", () => {
    const uri = "file:///test.ts";
    const blocks: any[] = [
      { id: "block-1", start: 10, numGreen: 2, numRed: 1 }, // Valid
      { id: "block-2", start: "invalid", numGreen: 2, numRed: 1 }, // Invalid start
      { id: "block-3", start: 20, numGreen: 3 }, // Missing numRed
      { start: 30, numGreen: 1, numRed: 1 }, // Missing id
    ];

    editorToVerticalDiffCodeLens.set(uri, blocks);
    fileUriToOriginalCursorPosition.set(uri, new vscode.Position(5, 0));

    const document = {
      uri: { toString: () => uri },
    } as vscode.TextDocument;

    const lenses = provider.provideCodeLenses(
      document,
      {} as vscode.CancellationToken,
    );

    // Should only have lenses for 1 valid block + 3 top-level lenses
    expect(lenses.length).toBe(3 + 1 * 2);
  });

  it("should remove lenses when removeLensesFor is called", () => {
    const uri = "file:///test.ts";
    const blocks: VerticalDiffCodeLens[] = [
      { id: "block-1", start: 10, numGreen: 2, numRed: 1 },
    ];

    editorToVerticalDiffCodeLens.set(uri, blocks);
    fileUriToOriginalCursorPosition.set(uri, new vscode.Position(5, 0));

    const document = {
      uri: { toString: () => uri },
    } as vscode.TextDocument;

    // Generate lenses
    provider.provideCodeLenses(document, {} as vscode.CancellationToken);

    // Remove lenses
    provider.removeLensesFor(uri);

    // Clear the blocks map to simulate cleanup
    editorToVerticalDiffCodeLens.delete(uri);
    fileUriToOriginalCursorPosition.delete(uri);

    // Should return empty array
    const lenses = provider.provideCodeLenses(
      document,
      {} as vscode.CancellationToken,
    );
    expect(lenses).toEqual([]);
  });
});
