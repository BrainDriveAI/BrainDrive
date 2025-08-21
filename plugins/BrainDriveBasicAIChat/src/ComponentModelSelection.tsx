import React from "react";
import "./ComponentModelSelection.css";
import CustomDropdown from "./CustomDropdown";

// Define model interfaces
interface ModelInfo {
	name: string;
	id: string; // Add id field for model ID
	provider: string;
	providerId: string;
	serverName: string;
	serverId: string;
}

interface ServerInfo {
	id: string;
	serverName: string;
	serverAddress: string;
	apiKey?: string;
}

interface ProviderSettings {
	id: string;
	name: string;
	servers: ServerInfo[];
}

// Define the component props
interface ComponentModelSelectionProps {
	moduleId?: string;
	label?: string;
	labelPosition?: "top" | "left" | "right" | "bottom";
	providerSettings?: string[];
	targetComponent?: string;
	services?: {
		api?: {
			get: (url: string, options?: any) => Promise<any>;
			post: (url: string, data: any) => Promise<any>;
		};
		settings?: {
			getSetting: (id: string) => Promise<any>;
			setSetting: (id: string, value: any) => Promise<any>;
			getSettingDefinitions: () => Promise<any>;
		};
		event?: {
			sendMessage: (target: string, message: any, options?: any) => void;
			subscribeToMessages: (
				target: string,
				callback: (message: any) => void
			) => void;
			unsubscribeFromMessages: (
				target: string,
				callback: (message: any) => void
			) => void;
		};
		theme?: {
			getCurrentTheme: () => string;
			addThemeChangeListener: (callback: (theme: string) => void) => void;
			removeThemeChangeListener: (callback: (theme: string) => void) => void;
		};
	};
}

// Define the component state
interface ComponentModelSelectionState {
	models: ModelInfo[];
	selectedModel: ModelInfo | null;
	isLoading: boolean;
	error: string | null;
	currentTheme: "light" | "dark";
	providerSettingsData: ProviderSettings[];
	pendingModelSelection: {
		name: string;
		provider: string;
		serverId: string;
	} | null;
}

class ComponentModelSelection extends React.Component<
	ComponentModelSelectionProps,
	ComponentModelSelectionState
> {
	private eventService: any;
	private themeChangeListener: ((theme: string) => void) | null = null;
	private conversationModelListener: ((content: any) => void) | null = null;

	constructor(props: ComponentModelSelectionProps) {
		super(props);

		this.state = {
			models: [],
			selectedModel: null,
			isLoading: true,
			error: null,
			currentTheme: "light",
			providerSettingsData: [],
			pendingModelSelection: null,
		};

		// Initialize event service
		if (props.services?.event) {
			const { createEventService } = require("./services/eventService");
			this.eventService = createEventService(
				"pluginA",
				props.moduleId || "model-selection-v2"
			);
			this.eventService.setServiceBridge(props.services.event);
		}
	}

	componentDidMount() {
		this.initializeThemeService();
		this.loadProviderSettings();
		this.initializeEventListeners();
	}

	componentWillUnmount() {
		if (this.themeChangeListener && this.props.services?.theme) {
			this.props.services.theme.removeThemeChangeListener(
				this.themeChangeListener
			);
		}

		if (this.conversationModelListener && this.props.services?.event) {
			this.props.services.event.unsubscribeFromMessages(
				"model-selection-v2",
				this.conversationModelListener
			);
		}
	}

	initializeEventListeners() {
		if (this.props.services?.event) {
			try {
				this.conversationModelListener = (message: any) => {
					console.log("Received model selection from conversation:", message);

					const modelInfo = message.content?.model;

					if (modelInfo) {
						const modelId = `${modelInfo.provider}_${modelInfo.serverId}_${modelInfo.name}`;
						let matchingModel = this.state.models.find(
							(model) =>
								`${model.provider}_${model.serverId}_${model.name}` === modelId
						);

						if (!matchingModel) {
							console.log(
								"Exact model match not found, trying to find by name:",
								modelInfo.name
							);
							matchingModel = this.state.models.find(
								(model) => model.name === modelInfo.name
							);
						}

						if (
							matchingModel &&
							(!this.state.selectedModel ||
								this.state.selectedModel.name !== matchingModel.name)
						) {
							this.setState({
								selectedModel: matchingModel,
								pendingModelSelection: null,
							});
							console.log(
								"Updated model selection from conversation event:",
								matchingModel.name
							);
						} else if (!matchingModel) {
							console.log(
								"Model from conversation not found in available models:",
								modelId
							);
							console.log(
								"Available models:",
								this.state.models.map(
									(m) => `${m.provider}_${m.serverId}_${m.name}`
								)
							);

							this.setState({
								pendingModelSelection: {
									name: modelInfo.name,
									provider: modelInfo.provider,
									serverId: modelInfo.serverId,
								},
							});
							console.log(
								"Saved pending model selection for later:",
								modelInfo.name
							);
						}
					}
				};

				this.props.services.event.subscribeToMessages(
					"model-selection-v2",
					this.conversationModelListener
				);

				console.log(
					"Subscribed to model selection events from conversation history"
				);
			} catch (error) {
				console.error("Error initializing event listeners:", error);
			}
		}
	}

	initializeThemeService() {
		if (this.props.services?.theme) {
			try {
				const currentTheme = this.props.services.theme.getCurrentTheme();
				this.setState({ currentTheme: currentTheme as "light" | "dark" });

				this.themeChangeListener = (newTheme: string) => {
					this.setState({ currentTheme: newTheme as "light" | "dark" });
				};

				this.props.services.theme.addThemeChangeListener(
					this.themeChangeListener
				);
			} catch (error) {
				console.error("Error initializing theme service:", error);
			}
		}
	}

	loadProviderSettings = async () => {
		this.setState({ isLoading: true, error: null });

		if (!this.props.services?.api) {
			this.setState({
				isLoading: false,
				error: "API service not available",
			});
			return;
		}

		try {
			const providerSettingIds = [
				"ollama_servers_settings",
				"openai_api_keys_settings",
				"openrouter_api_keys_settings",
				"claude_api_keys_settings",
				"groq_api_keys_settings",
			];
			const providerSettingsData: ProviderSettings[] = [];

			for (const settingId of providerSettingIds) {
				try {
					const response = await this.props.services.api.get(
						"/api/v1/settings/instances",
						{
							params: {
								definition_id: settingId,
								scope: "user",
								user_id: "current",
							},
						}
					);

					let settingsData = null;

					if (Array.isArray(response) && response.length > 0) {
						settingsData = response[0];
					} else if (response && typeof response === "object") {
						const responseObj = response as Record<string, any>;

						if (responseObj.data) {
							if (
								Array.isArray(responseObj.data) &&
								responseObj.data.length > 0
							) {
								settingsData = responseObj.data[0];
							} else if (typeof responseObj.data === "object") {
								settingsData = responseObj.data;
							}
						} else {
							settingsData = response;
						}
					}

					if (settingsData && settingsData.value) {
						let parsedValue =
							typeof settingsData.value === "string"
								? JSON.parse(settingsData.value)
								: settingsData.value;

						const providerType = settingId.includes("ollama")
							? "ollama"
							: settingId.includes("openai")
							? "openai"
							: settingId.includes("openrouter")
							? "openrouter"
							: settingId.includes("claude")
							? "claude"
							: settingId.includes("groq")
							? "groq"
							: "unknown";

						if (providerType === "openai" && parsedValue.api_key) {
							providerSettingsData.push({
								id: settingId,
								name: settingsData.name || settingId,
								servers: [
									{
										id: "openai_default_server",
										serverName: "OpenAI API",
										serverAddress: "https://api.openai.com",
										apiKey: parsedValue.api_key,
									},
								],
							});
						} else if (providerType === "openrouter" && parsedValue.api_key) {
							providerSettingsData.push({
								id: settingId,
								name: settingsData.name || settingId,
								servers: [
									{
										id: "openrouter_default_server",
										serverName: "OpenRouter API",
										serverAddress: "https://openrouter.ai/api/v1",
										apiKey: parsedValue.api_key,
									},
								],
							});
						} else if (providerType === "claude" && parsedValue.api_key) {
							providerSettingsData.push({
								id: settingId,
								name: settingsData.name || settingId,
								servers: [
									{
										id: "claude_default_server",
										serverName: "Claude API",
										serverAddress: "https://api.anthropic.com",
										apiKey: parsedValue.api_key,
									},
								],
							});
						} else if (providerType === "groq" && parsedValue.api_key) {
							providerSettingsData.push({
								id: settingId,
								name: settingsData.name || settingId,
								servers: [
									{
										id: "groq_default_server",
										serverName: "Groq API",
										serverAddress: "https://api.groq.com",
										apiKey: parsedValue.api_key,
									},
								],
							});
						} else if (providerType === "ollama") {
							providerSettingsData.push({
								id: settingId,
								name: settingsData.name || settingId,
								servers: Array.isArray(parsedValue.servers)
									? parsedValue.servers
									: [],
							});
						}
					}
				} catch (error) {
					console.error(`Error loading provider setting ${settingId}:`, error);
				}
			}

			this.setState(
				{
					providerSettingsData,
					isLoading: false,
				},
				() => {
					this.loadModels();
				}
			);
		} catch (error: any) {
			console.error("Error loading provider settings:", error);

			this.setState({
				isLoading: false,
				error: `Error loading provider settings: ${
					error.message || "Unknown error"
				}`,
			});
		}
	};

	loadModels = async () => {
		this.setState({ isLoading: true, error: null });

		if (!this.props.services?.api) {
			this.setState({
				isLoading: false,
				error: "API service not available",
			});
			return;
		}

		try {
			const response = await this.props.services.api.get(
				"/api/v1/ai/providers/all-models"
			);

			if (response?.models && Array.isArray(response.models)) {
				const models: ModelInfo[] = response.models.map((model: any) => ({
					name: model.name || "Unknown Model",
					id: model.id || "unknown",
					provider: model.provider || "unknown",
					providerId: `${model.provider || "unknown"}_api_keys_settings`,
					serverName: model.server_name || model.provider || "Unknown Server",
					serverId:
						model.server_id || `${model.provider || "unknown"}_default_server`,
				}));

				const { pendingModelSelection } = this.state;
				let modelToSelect = models.length > 0 ? models[0] : null;

				if (pendingModelSelection && models.length > 0) {
					let matchingModel = models.find(
						(model) =>
							model.name === pendingModelSelection.name &&
							model.provider === pendingModelSelection.provider &&
							model.serverId === pendingModelSelection.serverId
					);
					if (!matchingModel) {
						matchingModel = models.find(
							(model) => model.name === pendingModelSelection.name
						);
					}
					if (matchingModel) {
						modelToSelect = matchingModel;
					}
				}

				this.setState({
					models,
					selectedModel: modelToSelect,
					isLoading: false,
					error: null,
				});

				if (response.errors && response.errors.length > 0) {
					console.warn(
						"Some providers failed to load models:",
						response.errors
					);
				}

				console.log(
					`Successfully loaded ${models.length} models from ${response.successful_providers} providers`
				);
			} else {
				throw new Error("Invalid response format from all-models endpoint");
			}
		} catch (error: any) {
			console.error("Error loading models:", error);

			this.setState({
				isLoading: false,
				error: "Failed to load models. Please try again.",
			});
		}
	};

	/**
	 * Handle model selection change
	 */
	handleModelChange = (modelId: string) => {
		const selectedModel = this.state.models.find(
			(model) => `${model.provider}_${model.serverId}_${model.name}` === modelId
		);

		if (selectedModel) {
			this.setState({ selectedModel }, () => {
				this.broadcastModelSelection(selectedModel);
			});
		}
	};

	broadcastModelSelection = (model: ModelInfo) => {
		if (!this.eventService && !this.props.services?.event) {
			console.error("Event service not available");
			return;
		}

		const modelInfo = {
			type: "model.selection",
			content: {
				model: {
					name: model.name,
					provider: model.provider,
					providerId: model.providerId,
					serverName: model.serverName,
					serverId: model.serverId,
				},
				timestamp: new Date().toISOString(),
			},
		};

		const target = this.props.targetComponent || "ai-prompt-chat";

		console.log(`Sending model selection to target: ${target}`, modelInfo);

		if (this.props.services?.event) {
			this.props.services.event.sendMessage(target, modelInfo.content);
			console.log("Model selection sent via services.event");
		}

		if (this.eventService) {
			this.eventService.sendMessage(target, modelInfo, { remote: true });
			console.log("Model selection sent via eventService");
		}
	};

	render() {
		const { models, selectedModel, isLoading, error, currentTheme } =
			this.state;
		const { label = "Select Model", labelPosition = "top" } = this.props;

		const isHorizontal = labelPosition === "top" || labelPosition === "bottom";
		const layoutClass = isHorizontal ? "horizontal" : "vertical";

		const labelOrder =
			labelPosition === "bottom" || labelPosition === "right" ? 2 : 1;
		const dropdownOrder =
			labelPosition === "bottom" || labelPosition === "right" ? 1 : 2;

		const getModelId = (model: ModelInfo) =>
			`${model.provider}_${model.serverId}_${model.name}`;

		const dropdownOptions = models.map((model) => ({
			id: getModelId(model),
			primaryText: model.name,
			secondaryText: model.serverName,
		}));

		return (
			<div
				className={`model-selection-container ${
					currentTheme === "dark" ? "dark-theme" : ""
				}`}
			>
				<div className={`model-selection-layout ${layoutClass}`}>
					<label
						htmlFor="model-select"
						className="model-selection-label"
						style={{ order: labelOrder }}
					>
						{label}
					</label>

					<div
						className="model-selection-dropdown"
						style={{ order: dropdownOrder }}
					>
						{isLoading ? (
							<div className="model-selection-loading"></div>
						) : error ? (
							<div className="model-selection-error">{error}</div>
						) : (
							<CustomDropdown
								options={dropdownOptions}
								selectedId={selectedModel ? getModelId(selectedModel) : ""}
								onChange={this.handleModelChange}
								placeholder="Select a model"
								disabled={models.length === 0}
								ariaLabel="Select AI model"
							/>
						)}
					</div>
				</div>
			</div>
		);
	}
}

export default ComponentModelSelection;
