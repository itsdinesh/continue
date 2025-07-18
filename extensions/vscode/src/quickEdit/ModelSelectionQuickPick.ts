import type { ContinueConfig } from "core";
import { type QuickPickItem, window } from "vscode";

interface ModelQuickPickItem extends QuickPickItem {
	model: any;
}

export async function getModelQuickPickVal(
	curModelTitle: string,
	config: ContinueConfig,
) {
	// Use the same source as the sidebar: config.modelsByRole.edit for edit models
	let allModels = config.modelsByRole?.edit ?? [];
	if (allModels.length === 0) {
		window.showErrorMessage("No models found in configuration. Please add models to your config.yaml file.");
		return undefined;
	}

	const modelItems: ModelQuickPickItem[] = allModels.map((model) => {
		const isCurModel = curModelTitle === model.title;

		return {
			label: `${isCurModel ? "$(check)" : "     "} ${model.title}`,
			description: model.underlyingProviderName || "",
			detail: model.model || "",
			// Store the actual model for retrieval
			model: model,
		};
	});

	const selectedItem = await window.showQuickPick(modelItems, {
		title: "Models",
		placeHolder: "Select a model",
	});

	if (!selectedItem) {
		return undefined;
	}

	// Return the actual model title
	return selectedItem.model.title;
}
