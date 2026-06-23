import type { AiConfig } from "@/stores/use-config-store";

/** Result of parsing an image generation API response */
export interface ImageResult {
  id: string;
  dataUrl: string;
}

/** A preset size option displayed in the UI */
export interface PresetSize {
  id: string;
  label: string;
  width: number;
  height: number;
  icon?: "square" | "landscape" | "portrait";
}

/** UI configuration that the settings panel reads to render controls */
export interface ImageAdapterUi {
  /** How the size/ratio control works */
  sizeMode: "dynamic" | "preset" | "none";
  /** Available presets when sizeMode is "preset" */
  presetSizes?: PresetSize[];
  /** Whether the quality control is shown */
  qualitySupported?: boolean;
  /** Whether the count (n) control is shown */
  countSupported?: boolean;
  /** Whether image editing is supported */
  editSupported?: boolean;
  /** Whether this model uses the default OpenAI /images/generations endpoint */
  useDefaultEndpoint?: boolean;
}

/**
 * Each image model gets its own adapter.
 * The adapter is responsible for:
 *   - Building the correct request body from user config
 *   - Parsing the API response
 *   - Prescribing how the UI settings panel should render
 */
export interface ImageAdapter {
  /** Unique identifier, e.g. "gpt-image-2", "seedream" */
  id: string;
  /** Human-readable name */
  name: string;

  /**
   * Build the request body for the API call.
   * URL and headers are handled by the caller (image.ts).
   */
  buildBody(config: AiConfig, prompt: string, count: number): Record<string, unknown>;

  /**
   * Parse the raw API response into ImageResult[].
   * Throw on error / empty result.
   */
  parseResponse(raw: unknown): ImageResult[];

  /** UI configuration */
  ui: ImageAdapterUi;
}
