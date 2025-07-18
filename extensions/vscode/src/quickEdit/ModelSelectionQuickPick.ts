import type { ContinueConfig } from "core";
import { type QuickPickItem, window } from "vscode";

interface ModelQuickPickItem extends QuickPickItem {
	model: any;
}

export async function getModelQuickPickVal(
	curModelTitle: string,
	config: ContinueConfig,
) {
	// Get all models from the config - models should be in config.models array
	let allModels = config.models ?? [];
	
	// If no models in config.models, try to collect from selectedModelByRole
	if (allModels.length === 0) {
		const roleModels = [];
		if (config.selectedModelByRole?.chat) roleModels.push(config.selectedModelByRole.chat);
		if (config.selectedModelByRole?.edit) roleModels.push(config.selectedModelByRole.edit);
		if (config.selectedModelByRole?.apply) roleModels.push(config.selectedModelByRole.apply);
		if (config.selectedModelByRole?.autocomplete) roleModels.push(config.selectedModelByRole.autocomplete);
		if (config.selectedModelByRole?.embed) roleModels.push(config.selectedModelByRole.embed);
		
		// Remove duplicates based on title
		allModels = roleModels.filter((model, index, arr) => 
			arr.findIndex(m => m.title === model.title) === index
		);
	}
	
	if (allModels.length === 0) {
		window.showErrorMessage("No models found in configuration. Please add models to your config.yaml file.");
		return undefined;
	}
	
	const modelItems: ModelQuickPickItem[] = allModels
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
