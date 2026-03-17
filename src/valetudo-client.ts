/**
 * Valetudo API Client
 *
 * @file valetudo-client.ts
 * @description Client for communicating with Valetudo REST API
 */

import * as http from 'node:http';
import * as zlib from 'node:zlib';

import { AnsiLogger } from 'matterbridge/logger';
import mqtt from 'mqtt';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ValetudoInfo {
  embedded?: boolean;
  systemId: string;
  welcomeDialogDismissed?: boolean;
}

export interface ValetudoRobotInfo {
  manufacturer: string;
  modelName: string;
  modelDetails?: {
    supportedAttachments: ('dustbin' | 'watertank' | 'mop')[];
  };
  implementation?: string;
}

export interface ValetudoCustomizations {
  friendlyName?: string;
}

export type BatteryFlag = 'none' | 'charging' | 'discharging' | 'charged';
export type AttachmentType = 'dustbin' | 'watertank' | 'mop';
export type PresetType = 'fan_speed' | 'water_grade' | 'operation_mode';
export type PresetLevel = 'off' | 'min' | 'low' | 'medium' | 'high' | 'max' | 'turbo' | 'custom';
export type ValetudoOperationMode = 'vacuum' | 'mop' | 'vacuum_and_mop' | 'vacuum_then_mop';
export type PresetValue = PresetLevel | ValetudoOperationMode;
export type ConsumableUnit = 'percent' | 'minutes';
export type StatusStateAttributeValue = 'error' | 'docked' | 'idle' | 'returning' | 'cleaning' | 'paused' | 'manual_control' | 'moving';
export type StatusStateAttributeFlag = 'none' | 'zone' | 'segment' | 'spot' | 'target' | 'resumable' | 'mapping';

export interface BatteryStateAttribute {
  __class: 'BatteryStateAttribute';
  type: 'BatteryStateAttribute';
  level: number;
  flag: BatteryFlag;
}

export interface AttachmentStateAttribute {
  __class: 'AttachmentStateAttribute';
  type: AttachmentType;
  attached: boolean;
}

export interface PresetSelectionStateAttribute {
  __class: 'PresetSelectionStateAttribute';
  type: PresetType;
  value: PresetValue;
  customValue?: number;
}

export interface StatusStateAttribute {
  __class: 'StatusStateAttribute';
  type: 'StatusStateAttribute';
  value: StatusStateAttributeValue;
  flag?: StatusStateAttributeFlag;
  error?: { description: string };
}

export interface DockStatusStateAttribute {
  __class: 'DockStatusStateAttribute';
  type: 'DockStatusStateAttribute';
  value: 'docked' | 'undocked' | 'emptying' | 'drying' | 'cleaning';
}

export type StateAttribute = BatteryStateAttribute | AttachmentStateAttribute | PresetSelectionStateAttribute | StatusStateAttribute | DockStatusStateAttribute;

export interface MapSegment {
  __class: 'ValetudoMapSegment';
  id: string;
  name: string;
  metaData: Record<string, unknown>;
}

export interface ConsumableRemaining {
  value: number;
  unit: ConsumableUnit;
}

export interface ValetudoConsumable {
  __class: 'ValetudoConsumable';
  type: string;
  subType: string;
  remaining: ConsumableRemaining;
}

export interface ConsumableProperties {
  type: string;
  subType: string;
  unit: ConsumableUnit;
  maxValue: number;
}

export interface ValetudoDataPoint {
  timestamp: string;
  type: 'time' | 'area' | 'count';
  value: number;
  metaData?: Record<string, unknown>;
}

export interface MapSegmentationProperties {
  iterationCount: {
    min: number;
    max: number;
  };
  customOrderSupported: boolean;
}

export interface MapEntity {
  __class: string;
  metaData?: Record<string, unknown>;
  points: number[];
  type: string;
}

export interface MapLayerDimensions {
  x: {
    min: number;
    max: number;
    mid: number;
    avg: number;
  };
  y: {
    min: number;
    max: number;
    mid: number;
    avg: number;
  };
  pixelCount: number;
}

export interface MapLayer {
  __class: string;
  metaData: {
    segmentId: string;
    active?: boolean;
    source?: string;
    name?: string;
    area?: number;
  };
  type: string;
  pixels: number[];
  dimensions: MapLayerDimensions;
  compressedPixels: number[];
}

export interface MapData {
  __class: string;
  metaData: {
    version: number;
  };
  size: {
    x: number;
    y: number;
  };
  pixelSize: number;
  layers: MapLayer[];
  entities: MapEntity[];
}

/**
 * Cached map layers for efficient position tracking
 * Contains only the segment boundary data needed for position lookups
 */
export interface CachedMapLayers {
  layers: MapLayer[];
  size: { x: number; y: number };
  pixelSize: number;
  timestamp: number; // When cache was created
  version: number; // Map version from metaData
}

/**
 * Lightweight position-only map response
 * Contains only entities for position tracking
 */
export interface MapPositionData {
  entities: MapEntity[];
  metaData?: { version: number };
}

// ============================================================================
// Abstract Valetudo Client
// ============================================================================

export abstract class ValetudoClient {
  protected log: AnsiLogger;

  constructor(log: AnsiLogger) {
    this.log = log;
  }

  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;

  // ==========================================================================
  // General Information
  // ==========================================================================
  abstract getInfo(): Promise<ValetudoInfo | null>;
  abstract getCustomizations(): Promise<ValetudoCustomizations | null>;
  abstract getRobotInfo(): Promise<ValetudoRobotInfo | null>;
  abstract getCapabilities(): Promise<string[] | null>;

  // ==========================================================================
  // State Monitoring
  // ==========================================================================
  abstract getStateAttributes(): Promise<StateAttribute[] | null>;

  // ==========================================================================
  // Basic Control
  // ==========================================================================
  abstract executeBasicControl(action: 'start' | 'stop' | 'pause' | 'home'): Promise<boolean>;

  /**
   * Start cleaning
   */
  async start(): Promise<boolean> {
    return this.executeBasicControl('start');
  }

  /**
   * Stop cleaning
   */
  async stop(): Promise<boolean> {
    return this.executeBasicControl('stop');
  }

  /**
   * Pause cleaning
   */
  async pause(): Promise<boolean> {
    return this.executeBasicControl('pause');
  }

  /**
   * Return to dock
   */
  async home(): Promise<boolean> {
    return this.executeBasicControl('home');
  }
  /**
   * Start cleaning (alias for start)
   */
  async startCleaning(): Promise<boolean> {
    return this.start();
  }
  /**
   * Stop cleaning (alias for stop)
   */
  async stopCleaning(): Promise<boolean> {
    return this.stop();
  }
  /**
   * Pause cleaning (alias for pause)
   */
  async pauseCleaning(): Promise<boolean> {
    return this.pause();
  }
  /**
   * Return home (alias for home)
   */
  async returnHome(): Promise<boolean> {
    return this.home();
  }

  // ==========================================================================
  // Preset Controls
  // ==========================================================================
  abstract getFanSpeedPresets(): Promise<PresetLevel[] | null>;
  abstract setFanSpeed(preset: PresetLevel): Promise<boolean>;
  abstract getWaterUsagePresets(): Promise<PresetLevel[] | null>;
  abstract setWaterUsage(preset: PresetLevel): Promise<boolean>;
  abstract getOperationModePresets(): Promise<ValetudoOperationMode[] | null>;
  abstract setOperationMode(preset: ValetudoOperationMode): Promise<boolean>;
  abstract getMapSegments(): Promise<MapSegment[] | null>;
  abstract getMapSegmentationProperties(): Promise<MapSegmentationProperties | null>;
  abstract cleanSegments(segmentIds: string[], iterations: number, customOrder: boolean): Promise<boolean>;
  abstract getMapDataWithTimeout(timeoutMs: number): Promise<MapData | null>;
  abstract getMapPositionData(): Promise<MapPositionData | null>;

  /**
   * Find which segment contains a given point using cached layers
   * This is a static method that works with cached data
   *
   * @param cachedLayers - Cached map layers
   * @param x - X coordinate
   * @param y - Y coordinate
   * @returns The segment layer containing the point, or null if not found
   */
  findSegmentAtPositionCached(cachedLayers: CachedMapLayers, x: number, y: number): MapLayer | null {
    const segments = cachedLayers.layers.filter((layer) => layer.type === 'segment');

    // Find all segments whose bounds contain this position
    const matchingSegments: Array<{ segment: MapLayer; distance: number }> = [];

    for (const segment of segments) {
      const dims = segment.dimensions;
      const inBounds = x >= dims.x.min && x <= dims.x.max && y >= dims.y.min && y <= dims.y.max;

      if (inBounds) {
        // Calculate distance from segment midpoint
        const distanceFromMid = Math.sqrt(Math.pow(x - dims.x.mid, 2) + Math.pow(y - dims.y.mid, 2));
        matchingSegments.push({ segment, distance: distanceFromMid });
      }
    }

    if (matchingSegments.length === 0) {
      return null;
    }

    if (matchingSegments.length === 1) {
      return matchingSegments[0].segment;
    }

    // Multiple segments contain this position - use closest midpoint
    matchingSegments.sort((a, b) => a.distance - b.distance);
    const closest = matchingSegments[0];
    this.log.debug(`Multiple segments at (${x}, ${y}) - selected "${closest.segment.metaData.segmentId}" (closest midpoint, distance: ${closest.distance.toFixed(1)})`);

    return closest.segment;
  }

  /**
   * Create cached layers from full map data
   *
   * @param mapData - Full map data from Valetudo
   * @returns Cached layers suitable for position tracking
   */
  createCachedLayers(mapData: MapData): CachedMapLayers {
    return {
      layers: mapData.layers,
      size: mapData.size,
      pixelSize: mapData.pixelSize,
      timestamp: Date.now(),
      version: mapData.metaData.version,
    };
  }

  // ==========================================================================
  // Additional Features
  // ==========================================================================
  abstract locate(): Promise<boolean>;
  abstract getConsumables(): Promise<ValetudoConsumable[] | null>;
  abstract getConsumablesProperties(): Promise<ConsumableProperties[] | null>;

  /**
   * Test connection to Valetudo
   */
  async testConnection(): Promise<boolean> {
    const info = await this.getInfo();
    return info !== null;
  }
}

// ============================================================================
// HTTP Valetudo Client
// ============================================================================

export class ValetudoHttpClient extends ValetudoClient {
  private baseUrl: string;
  private authHeader: string | null = null;

  constructor(ip: string, log: AnsiLogger, username?: string, password?: string) {
    super(log);
    this.baseUrl = `http://${ip}`;

    // Pre-compute Base64 Authorization header if credentials are provided
    if (username && password) {
      this.authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
  }

  override async connect(): Promise<boolean> {
    return this.testConnection();
  }

  override async disconnect(): Promise<void> {
    return;
  }

  // ==========================================================================
  // General Information
  // ==========================================================================

  /**
   * Fetch basic Valetudo information
   */
  override async getInfo(): Promise<ValetudoInfo | null> {
    try {
      const url = `${this.baseUrl}/api/v2/valetudo`;
      this.log.debug(`Fetching Valetudo info from: ${url}`);

      const data = await this.httpGet(url);
      this.log.debug(`Valetudo info received: ${JSON.stringify(data)}`);
      return data as ValetudoInfo;
    } catch (error) {
      this.log.error(`Error fetching Valetudo info: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async getCustomizations(): Promise<ValetudoCustomizations | null> {
    try {
      const url = `${this.baseUrl}/api/v2/valetudo/config/customizations`;
      const data = await this.httpGet(url);
      this.log.debug(`Customizations recieved: ${JSON.stringify(data)}`);
      return data as ValetudoCustomizations;
    } catch (error) {
      this.log.error(`Error fetching customizations: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get robot information
   */
  override async getRobotInfo(): Promise<ValetudoRobotInfo | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot`);
      return data as ValetudoRobotInfo;
    } catch (error) {
      this.log.error(`Error fetching robot info: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get supported capabilities
   */
  override async getCapabilities(): Promise<string[] | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/capabilities`);
      return data as string[];
    } catch (error) {
      this.log.error(`Error fetching capabilities: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // ==========================================================================
  // State Monitoring
  // ==========================================================================

  /**
   * Get robot state attributes (battery, attachments, presets)
   */
  override async getStateAttributes(): Promise<StateAttribute[] | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/state/attributes`);
      return data as StateAttribute[];
    } catch (error) {
      this.log.error(`Error fetching state attributes: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // ==========================================================================
  // Basic Control
  // ==========================================================================

  /**
   * Execute basic control command
   *
   * @param action
   */
  override async executeBasicControl(action: 'start' | 'stop' | 'pause' | 'home'): Promise<boolean> {
    try {
      const result = await this.httpPut(`${this.baseUrl}/api/v2/robot/capabilities/BasicControlCapability`, {
        action,
      });
      return result !== null;
    } catch (error) {
      this.log.error(`Error executing basic control (${action}): ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // ==========================================================================
  // Preset Controls
  // ==========================================================================

  /**
   * Get available fan speed presets
   */
  override async getFanSpeedPresets(): Promise<PresetLevel[] | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/capabilities/FanSpeedControlCapability/presets`);
      return data as PresetLevel[];
    } catch (error) {
      this.log.error(`Error fetching fan speed presets: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Set fan speed preset
   *
   * @param preset
   */
  override async setFanSpeed(preset: PresetLevel): Promise<boolean> {
    try {
      const result = await this.httpPut(`${this.baseUrl}/api/v2/robot/capabilities/FanSpeedControlCapability/preset`, {
        name: preset,
      });
      return result !== null;
    } catch (error) {
      this.log.error(`Error setting fan speed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get available water usage presets
   */
  override async getWaterUsagePresets(): Promise<PresetLevel[] | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/capabilities/WaterUsageControlCapability/presets`);
      return data as PresetLevel[];
    } catch (error) {
      this.log.error(`Error fetching water usage presets: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Set water usage preset
   *
   * @param preset
   */
  override async setWaterUsage(preset: PresetLevel): Promise<boolean> {
    try {
      const result = await this.httpPut(`${this.baseUrl}/api/v2/robot/capabilities/WaterUsageControlCapability/preset`, {
        name: preset,
      });
      return result !== null;
    } catch (error) {
      this.log.error(`Error setting water usage: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get available operation mode presets
   */
  override async getOperationModePresets(): Promise<ValetudoOperationMode[] | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/capabilities/OperationModeControlCapability/presets`);
      return data as ValetudoOperationMode[];
    } catch (error) {
      this.log.error(`Error fetching operation mode presets: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Set operation mode preset (vacuum, mop, vacuum_and_mop, etc.)
   *
   * @param preset
   */
  override async setOperationMode(preset: ValetudoOperationMode): Promise<boolean> {
    try {
      const result = await this.httpPut(`${this.baseUrl}/api/v2/robot/capabilities/OperationModeControlCapability/preset`, {
        name: preset,
      });
      return result !== null;
    } catch (error) {
      this.log.error(`Error setting operation mode: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // ==========================================================================
  // Segment/Room Cleaning
  // ==========================================================================

  /**
   * Get available map segments (rooms)
   */
  override async getMapSegments(): Promise<MapSegment[] | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/capabilities/MapSegmentationCapability`);
      return data as MapSegment[];
    } catch (error) {
      this.log.error(`Error fetching map segments: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get map segmentation properties (iteration support, custom order support)
   */
  override async getMapSegmentationProperties(): Promise<MapSegmentationProperties | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/capabilities/MapSegmentationCapability/properties`);
      return data as MapSegmentationProperties;
    } catch (error) {
      this.log.error(`Error fetching map segmentation properties: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Clean specific segments/rooms
   *
   * @param segmentIds
   * @param iterations
   * @param customOrder
   */
  override async cleanSegments(segmentIds: string[], iterations = 1, customOrder = false): Promise<boolean> {
    try {
      const payload = {
        action: 'start_segment_action',
        segment_ids: segmentIds,
        iterations,
        customOrder,
      };
      this.log.debug(`cleanSegments: ${JSON.stringify(payload)}`);
      const result = await this.httpPut(`${this.baseUrl}/api/v2/robot/capabilities/MapSegmentationCapability`, payload);
      return result !== null;
    } catch (error) {
      this.log.error(`Error cleaning segments: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get full map data with extended timeout for initial caching
   * Used during startup to populate the map cache
   *
   * @param timeoutMs - Timeout in milliseconds
   * @returns Map data or null if fetch fails
   */
  override async getMapDataWithTimeout(timeoutMs: number): Promise<MapData | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/state/map`, timeoutMs);
      return data as MapData;
    } catch (error) {
      this.log.error(`Error fetching map data: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get only position data from map (still calls full endpoint but extracts only entities)
   * In the future, this could be optimized if Valetudo adds a position-only endpoint
   *
   * @returns Position data with entities and metadata version
   */
  override async getMapPositionData(): Promise<MapPositionData | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/state/map`);
      const mapData = data as MapData;

      // Return only what we need for position tracking
      return {
        entities: mapData.entities,
        metaData: mapData.metaData,
      };
    } catch (error) {
      this.log.error(`Error fetching position data: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // ==========================================================================
  // Additional Features
  // ==========================================================================

  /**
   * Locate robot (play sound)
   */
  override async locate(): Promise<boolean> {
    try {
      const result = await this.httpPut(`${this.baseUrl}/api/v2/robot/capabilities/LocateCapability`, {
        action: 'locate',
      });
      return result !== null;
    } catch (error) {
      this.log.error(`Error locating robot: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get consumables status (brush, filter, etc.)
   */
  override async getConsumables(): Promise<ValetudoConsumable[] | null> {
    try {
      const data = await this.httpGet(`${this.baseUrl}/api/v2/robot/capabilities/ConsumableMonitoringCapability`);
      return data as ValetudoConsumable[];
    } catch (error) {
      this.log.error(`Error fetching consumables: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get consumables properties (max lifetime etc.)
   */
  override async getConsumablesProperties(): Promise<ConsumableProperties[] | null> {
    try {
      const data = (await this.httpGet(`${this.baseUrl}/api/v2/robot/capabilities/ConsumableMonitoringCapability/properties`)) as { availableConsumables: ConsumableProperties[] };
      return data.availableConsumables;
    } catch (error) {
      this.log.error(`Error fetching available consumables: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // ==========================================================================
  // HTTP Methods
  // ==========================================================================

  /**
   * Perform HTTP GET request
   *
   * @param url - The URL to fetch
   * @param timeoutMs - Optional timeout in milliseconds (default: 10000)
   * @throws {Error} If the request fails or times out
   */
  private async httpGet(url: string, timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs ?? 10000; // Default 10 second timeout, allow override
      let timeoutId: NodeJS.Timeout | null = null;

      const headers: Record<string, string> = { accept: 'application/json' };
      if (this.authHeader) {
        headers['Authorization'] = this.authHeader;
      }

      const req = http
        .get(url, { headers }, (res) => {
          let data = '';

          if (res.statusCode !== 200) {
            const error = new Error(`HTTP GET failed with status code: ${res.statusCode} for ${url}`);
            this.log.error(error.message);
            reject(error);
            return;
          }

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (timeoutId) clearTimeout(timeoutId);
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (error) {
              const parseError = new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`);
              this.log.error(parseError.message);
              reject(parseError);
            }
          });
        })
        .on('error', (error) => {
          if (timeoutId) clearTimeout(timeoutId);
          this.log.error(`HTTP GET error: ${error.message}`);
          reject(error);
        });

      // Set timeout
      timeoutId = setTimeout(() => {
        req.destroy();
        const timeoutError = new Error(`HTTP GET request timed out after ${timeout}ms for ${url}`);
        this.log.error(timeoutError.message);
        reject(timeoutError);
      }, timeout);
    });
  }

  /**
   * Perform HTTP PUT request
   *
   * @param url
   * @param body
   * @throws {Error} If the request fails or times out
   */
  private async httpPut(url: string, body: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = 10000; // 10 second timeout
      let timeoutId: NodeJS.Timeout | null = null;

      const bodyString = JSON.stringify(body);
      const urlObj = new URL(url);

      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        'Accept': 'application/json',
      };
      if (this.authHeader) {
        headers['Authorization'] = this.authHeader;
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 80,
        path: urlObj.pathname,
        method: 'PUT',
        headers,
      };

      const req = http.request(options, (res) => {
        let data = '';

        if (res.statusCode !== 200) {
          const error = new Error(`HTTP PUT failed with status code: ${res.statusCode} for ${url}`);
          this.log.error(error.message);
          reject(error);
          return;
        }

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (timeoutId) clearTimeout(timeoutId);
          try {
            if (data) {
              // Try to parse as JSON, but if it fails and data is just "OK", treat as success
              try {
                const parsed = JSON.parse(data);
                resolve(parsed);
              } catch {
                // If parse fails but response is "OK" or similar success text, treat as success
                if (data.trim() === 'OK' || data.trim() === 'ok') {
                  resolve({ success: true });
                } else {
                  const parseError = new Error(`Failed to parse JSON response: ${data}`);
                  this.log.error(parseError.message);
                  reject(parseError);
                }
              }
            } else {
              resolve({}); // Success with empty response
            }
          } catch (error) {
            const handleError = new Error(`Failed to handle response: ${error instanceof Error ? error.message : String(error)}`);
            this.log.error(handleError.message);
            reject(handleError);
          }
        });
      });

      req.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.log.error(`HTTP PUT error: ${error.message}`);
        reject(error);
      });

      // Set timeout
      timeoutId = setTimeout(() => {
        req.destroy();
        const timeoutError = new Error(`HTTP PUT request timed out after ${timeout}ms for ${url}`);
        this.log.error(timeoutError.message);
        reject(timeoutError);
      }, timeout);

      req.write(bodyString);
      req.end();
    });
  }
}

// ============================================================================
// MQTT Valetudo Client
// ============================================================================
interface HomieProperty {
  $name?: string;
  $datatype?: string;
  $format?: string;
  $settable?: string;
  $retained?: boolean;
  $unit?: string;
  value?: string;
}

interface HomieNode {
  $name?: string;
  $type?: string;
  $properties?: string;
  properties: Record<string, HomieProperty>;
}

// All of these are actually mandatory but we add them one message at a time
interface HomieDevice {
  $homie?: string;
  $name?: string;
  $state?: string;
  $implementation?: string;
  $nodes?: string;
  nodes: Record<string, HomieNode>;
}

export class ValetudoMQTTClient extends ValetudoClient {
  private client?: mqtt.MqttClient;
  private topicPrefix: string;

  private homieDevice: HomieDevice = { nodes: {} };

  private brokerUrl: string;

  private options: mqtt.IClientOptions = {
    keepalive: 60,
    protocolVersion: 5,
    reconnectPeriod: 5000,
    connectTimeout: 60 * 1000,
    username: undefined,
    password: undefined,
  };

  constructor(log: AnsiLogger, host: string, port: number, topicPrefix: string, username?: string, password?: string, rejectUnauthorized?: boolean) {
    super(log);

    this.topicPrefix = topicPrefix;
    if (!host.startsWith('mqtt://')) {
      throw new Error(`Invalid mqtt host: ${host}`);
    }

    this.options.username = username !== undefined && username !== '' ? username : undefined;
    this.options.password = password !== undefined && password !== '' ? password : undefined;
    this.options.rejectUnauthorized = rejectUnauthorized;

    this.brokerUrl = `${host}:${port}`;
  }

  override async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.client = mqtt.connect(this.brokerUrl, this.options);

      this.client.on('connect', () => {
        this.log.info(`Connected to MQTT Broker at ${this.brokerUrl}. Subscribing to ${this.topicPrefix}/#`);
        this.client?.subscribe(`${this.topicPrefix}/#`);
        resolve(true);
      });

      this.client.on('message', (topic, message) => {
        this.log.debug(`Received message from ${topic}`);
        const payload = topic === `${this.topicPrefix}/MapData/map-data` ? zlib.inflateSync(message) : message;
        this.parseHomieTopic(topic, payload.toString());
      });
    });
  }

  override async disconnect(): Promise<void> {
    this.client?.end();
  }

  private parseHomieTopic(topic: string, payload: string) {
    const path = topic.substring(this.topicPrefix.length + 1);
    const parts = path.split('/');

    if (parts.length === 1 && parts[0].startsWith('$')) {
      const attr = parts[0] as keyof HomieDevice;
      (this.homieDevice[attr] as string) = payload;
      return;
    }
    const nodeId = parts[0];
    const propertyId = parts.length > 1 ? parts[1] : null;
    const attributeId = parts.length > 2 ? parts[2] : null;

    if (!this.homieDevice.nodes[nodeId]) {
      this.homieDevice.nodes[nodeId] = { properties: {} };
    }
    const node = this.homieDevice.nodes[nodeId];

    if (propertyId && propertyId.startsWith('$')) {
      const attr = propertyId as keyof HomieNode;
      (node[attr] as string) = payload;
      return;
    }

    if (propertyId) {
      if (!node.properties[propertyId]) {
        node.properties[propertyId] = {};
      }
      const property = node.properties[propertyId];

      if (attributeId && attributeId.startsWith('$')) {
        const attr = attributeId as keyof HomieProperty;
        (property[attr] as string) = payload;
      } else if (!attributeId) {
        property.value = payload;
      }
    }
  }

  override async testConnection(): Promise<boolean> {
    this.log.debug(`state: ${this.homieDevice.$state}`);
    return this.homieDevice.$state === 'ready';
  }

  override async getInfo(): Promise<ValetudoInfo | null> {
    return { systemId: this.topicPrefix } as ValetudoInfo;
  }
  override async getCustomizations(): Promise<ValetudoCustomizations | null> {
    return { friendlyName: this.homieDevice.$name } as ValetudoCustomizations;
  }
  override async getRobotInfo(): Promise<ValetudoRobotInfo | null> {
    return {
      manufacturer: this.homieDevice.$implementation ?? '',
      modelName: this.homieDevice.$name ?? '',
    };
  }
  override async getCapabilities(): Promise<string[] | null> {
    return this.homieDevice.$nodes?.split(',') || null;
  }
  override async getStateAttributes(): Promise<StateAttribute[] | null> {
    const attributes: StateAttribute[] = [];
    const batteryNode = this.homieDevice.nodes['BatteryStateAttribute'];
    if (batteryNode) {
      attributes.push({
        __class: 'BatteryStateAttribute',
        type: 'BatteryStateAttribute',
        level: parseInt(batteryNode.properties['level']?.value ?? '0', 10),
        flag: (batteryNode.properties['status']?.value ?? 'none') as BatteryFlag,
      } as BatteryStateAttribute);
    }

    const statusNode = this.homieDevice.nodes['StatusStateAttribute'];
    if (statusNode) {
      attributes.push({
        __class: 'StatusStateAttribute',
        type: 'StatusStateAttribute',
        value: (statusNode.properties['status']?.value ?? 'idle') as StatusStateAttributeValue,
        flag: statusNode.properties['error_description']?.value as StatusStateAttributeFlag,
      } as StatusStateAttribute);
    }

    return attributes.length > 0 ? attributes : null;
  }
  override executeBasicControl(action: 'start' | 'stop' | 'pause' | 'home'): Promise<boolean> {
    return this.publishCommand('BasicControlCapability', 'operation', action.toUpperCase());
  }
  override async getFanSpeedPresets(): Promise<PresetLevel[] | null> {
    const node = this.homieDevice.nodes['FanSpeedControlCapability'];
    if (!node || !node.properties['preset']) return null;
    return (node.properties['preset'].$format?.split(',') as PresetLevel[]) ?? null;
  }
  override setFanSpeed(preset: PresetLevel): Promise<boolean> {
    return this.publishCommand('FanSpeedControlCapability', 'preset', preset);
  }
  override async getWaterUsagePresets(): Promise<PresetLevel[] | null> {
    const node = this.homieDevice.nodes['WaterUsageControlCapability'];
    if (!node || !node.properties['preset']) return null;
    return (node.properties['preset'].$format?.split(',') as PresetLevel[]) ?? null;
  }
  override setWaterUsage(preset: PresetLevel): Promise<boolean> {
    return this.publishCommand('WaterUsageControlCapability', 'preset', preset);
  }
  override async getOperationModePresets(): Promise<ValetudoOperationMode[] | null> {
    const node = this.homieDevice.nodes['OperationModeControlCapability'];
    if (!node || !node.properties['preset']) return null;
    return (node.properties['preset'].$format?.split(',') as ValetudoOperationMode[]) ?? null;
  }
  override setOperationMode(preset: ValetudoOperationMode): Promise<boolean> {
    return this.publishCommand('OperationModeControlCapability', 'preset', preset);
  }
  override async getMapSegments(): Promise<MapSegment[] | null> {
    const node = this.homieDevice.nodes['MapData'];
    if (!node || !node.properties['segments'] || !node.properties['segments'].value) return null;
    const rawSegments = JSON.parse(node.properties['segments'].value) as Record<string, string>;
    return Object.entries(rawSegments).map(([id, name]) => ({
      __class: 'ValetudoMapSegment',
      id: id,
      name: name,
      metaData: {},
    }));
  }
  override getMapSegmentationProperties(): Promise<MapSegmentationProperties | null> {
    // No mqtt endpoint for this
    return Promise.resolve(null);
  }
  override cleanSegments(segmentIds: string[], iterations: number, customOrder: boolean): Promise<boolean> {
    const payload = {
      action: 'start_segment_action',
      segment_ids: segmentIds,
      iterations,
      customOrder,
    };
    this.log.debug(`cleanSegments: ${JSON.stringify(payload)}`);
    return this.publishCommand('MapSegmentationCapability', 'clean', JSON.stringify(payload));
  }
  override async getMapDataWithTimeout(timeoutMs: number = 0): Promise<MapData | null> {
    const node = this.homieDevice.nodes['MapData'];
    if (!node || !node.properties['map-data'] || !node.properties['map-data'].value) return null;
    try {
      return JSON.parse(node.properties['map-data'].value) as MapData;
    } catch (error) {
      this.log.error(`Error parsing map data: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  override async getMapPositionData(): Promise<MapPositionData | null> {
    const mapData = await this.getMapDataWithTimeout();
    if (!mapData) {
      this.log.info(`No map data can't get position data`);
      return null;
    }
    return {
      entities: mapData.entities,
      metaData: mapData.metaData,
    };
  }
  override locate(): Promise<boolean> {
    return this.publishCommand('LocateCapability', 'locate', 'PERFORM');
  }
  override getConsumables(): Promise<ValetudoConsumable[] | null> {
    return Promise.resolve(null);
  }
  override getConsumablesProperties(): Promise<ConsumableProperties[] | null> {
    return Promise.resolve(null);
  }

  private async publishCommand(nodeId: string, propertyId: string, payload: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.client?.connect) {
        this.log.error('MQTT client not connected');
        return resolve(false);
      }
      const node = this.homieDevice.nodes[nodeId];
      const property = node?.properties[propertyId];

      if (!property) {
        this.log.error(`Cannot send command. Property '${nodeId}/${propertyId}' does not exist.`);
        return resolve(false);
      }
      if (property.$settable !== 'true') {
        this.log.error(`Cannot send command. Property '${nodeId}/${propertyId}' is not settable.`);
        return resolve(false);
      }
      const topic = `${this.topicPrefix}/${nodeId}/${propertyId}/set`;

      this.client.publish(topic, payload, { qos: 2 }, (error) => {
        if (error) {
          this.log.error(`Failed to publish to ${topic}: ${error.message}`);
          resolve(false);
        }
        this.log.debug(`Command sent: ${topic} -> ${payload}`);
        resolve(true);
      });
    });
  }
}
