import type { ContinueConfig } from "core";
import { type QuickPickItem, window } from "vscode";

interface ModelQuickPickItem extends QuickPickItem {
	model: any;
}

export async function getModelQuickPickVal(
	curModelTitle: string,
	config: ContinueConfig,
) {
	const modelItems: ModelQuickPickItem[] = (config.models ?? [])
		.map((model, index) => {
			// Use title if available, otherwise create a fallback title
			const displayTitle = model.title || `${model.underlyingProviderName || "Unknown"} - ${model.model || `Model ${index + 1}`}`;
			const isCurModel = curModelTitle === model.title || curModelTitle === displayTitle;

			return {
				label: `${isCurModel ? "$(check)" : "     "} ${displayTitle}`,
				description: model.underlyingProviderName || "",
				detail: model.model || "",
				// Store the actual model for retrieval
				model: model,
			};
		});

	if (modelItems.length === 0) {
		window.showErrorMessage("No models found in configuration");
		return undefined;
	}

	const selectedItem = await window.showQuickPick(modelItems, {
		title: "Models",
		placeHolder: "Select a model",
	});

	if (!selectedItem) {
		return undefined;
	}

	// Return the actual model title from the selected model
	return selectedItem.model.title || selectedItem.model.model;
}
