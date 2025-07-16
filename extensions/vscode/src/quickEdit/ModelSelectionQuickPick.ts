import type { ContinueConfig } from "core";
import { type QuickPickItem, window } from "vscode";

export async function getModelQuickPickVal(
	curModelTitle: string,
	config: ContinueConfig,
) {
	const modelItems: QuickPickItem[] = (config.models ?? [])
		.filter((model) => model.title) // Only show models with titles
		.map((model) => {
			const isCurModel = curModelTitle === model.title;

			return {
				label: `${isCurModel ? "$(check)" : "     "} ${model.title}`,
				description: model.underlyingProviderName || "",
				detail: model.model || "",
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

	// Extract the model title from the label (remove the check mark and spaces)
	const selectedModelTitle = selectedItem.label.replace(
		/^(\$\(check\)|     ) /,
		"",
	);

	return selectedModelTitle;
}
