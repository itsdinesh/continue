import type { ContinueConfig } from "core";
import { type QuickPickItem, window } from "vscode";

interface ModelQuickPickItem extends QuickPickItem {
	model: any;
}

export async function getModelQuickPickVal(
	curModelTitle: string,
	config: ContinueConfig,
) {
	// Get all models from config.models (primary source)
	const configModels = config.models ?? [];
	
	// Also collect models from selectedModelByRole (additional source)
	const roleModels = [
		config.selectedModelByRole?.chat,
		config.selectedModelByRole?.edit,
		config.selectedModelByRole?.apply,
		config.selectedModelByRole?.autocomplete,
		config.selectedModelByRole?.embed,
	].filter((model): model is any => model != null);
	
	// Combine both sources and remove duplicates based on title
	const allModelsMap = new Map();
	
	// Add config.models first (primary source)
	configModels.forEach(model => {
		if (model.title) {
			allModelsMap.set(model.title, model);
		}
	});
	
	// Add role models (secondary source, won't overwrite existing)
	roleModels.forEach(model => {
		if (model.title && !allModelsMap.has(model.title)) {
			allModelsMap.set(model.title, model);
		}
	});
	
	// Convert map back to array
	let allModels = Array.from(allModelsMap.values());
	
	// Filter out transformers.js models and models without titles
	allModels = allModels.filter(model => {
		const isTransformersJs = model.underlyingProviderName?.toLowerCase().includes('transformers') ||
			model.model?.toLowerCase().includes('transformers') ||
			model.title?.toLowerCase().includes('transformers');
		return !isTransformersJs && model.title;
	});
	
	if (allModels.length === 0) {
		window.showErrorMessage("No models found in configuration. Please add models to your config.yaml file.");
		return undefined;
	}
	
	const modelItems: ModelQuickPickItem[] = allModels
		.map((model) => {
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
