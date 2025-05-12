/**
 * BaseService interface defines the core contract that all services must implement.
 * It provides lifecycle management, version control, and capability declarations.
 */

export interface ServiceCapability {
    name: string;
    description: string;
    version: string;
}

export interface ServiceVersion {
    major: number;
    minor: number;
    patch: number;
}

export interface BaseService {
    /**
     * Returns the unique identifier of the service
     */
    getName(): string;

    /**
     * Returns the semantic version of the service
     */
    getVersion(): ServiceVersion;

    /**
     * Returns the list of capabilities provided by this service
     */
    getCapabilities(): ServiceCapability[];

    /**
     * Initializes the service and its resources
     * @throws Error if initialization fails
     */
    initialize(): Promise<void>;

    /**
     * Cleans up resources and prepares service for shutdown
     */
    destroy(): Promise<void>;

    /**
     * Checks if the service supports a specific capability
     * @param capability The name of the capability to check
     */
    hasCapability(capability: string): boolean;

    /**
     * Validates version compatibility with a required version
     * @param required The minimum required version
     * @returns true if current version is compatible
     */
    isVersionCompatible(required: ServiceVersion): boolean;
}

/**
 * Utility function to compare two semantic versions
 * Returns: 
 *  1 if v1 > v2
 *  0 if v1 = v2
 * -1 if v1 < v2
 */
export function compareVersions(v1: ServiceVersion, v2: ServiceVersion): number {
    if (v1.major !== v2.major) return v1.major > v2.major ? 1 : -1;
    if (v1.minor !== v2.minor) return v1.minor > v2.minor ? 1 : -1;
    if (v1.patch !== v2.patch) return v1.patch > v2.patch ? 1 : -1;
    return 0;
}

/**
 * Abstract base class providing default implementations for common service functionality
 */
export abstract class AbstractBaseService implements BaseService {
    protected readonly name: string;
    protected readonly version: ServiceVersion;
    protected readonly capabilities: ServiceCapability[];

    constructor(name: string, version: ServiceVersion, capabilities: ServiceCapability[] = []) {
        this.name = name;
        this.version = version;
        this.capabilities = capabilities;
    }

    getName(): string {
        return this.name;
    }

    getVersion(): ServiceVersion {
        return this.version;
    }

    getCapabilities(): ServiceCapability[] {
        return this.capabilities;
    }

    hasCapability(capability: string): boolean {
        return this.capabilities.some(cap => cap.name === capability);
    }

    isVersionCompatible(required: ServiceVersion): boolean {
        // Major version must match exactly for compatibility
        if (this.version.major !== required.major) return false;
        
        // Current version must be greater than or equal to required version
        return compareVersions(this.version, required) >= 0;
    }

    abstract initialize(): Promise<void>;
    abstract destroy(): Promise<void>;
}
