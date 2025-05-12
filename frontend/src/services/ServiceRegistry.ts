import { BaseService, ServiceVersion, compareVersions } from './base/BaseService';

/**
 * Error thrown when service registration or access fails
 */
export class ServiceRegistryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ServiceRegistryError';
    }
}

/**
 * Registry configuration options
 */
export interface ServiceRegistryOptions {
    /**
     * Whether to allow service overrides during registration
     */
    allowOverrides?: boolean;

    /**
     * Whether to validate service dependencies during registration
     */
    validateDependencies?: boolean;
}

/**
 * Service dependency requirement
 */
export interface ServiceDependency {
    serviceName: string;
    minimumVersion: ServiceVersion;
    required: boolean;
}

/**
 * Service Registry manages the registration, discovery, and validation of services
 */
export class ServiceRegistry {
    private services: Map<string, BaseService>;
    private dependencies: Map<string, ServiceDependency[]>;
    private options: ServiceRegistryOptions;

    constructor(options: ServiceRegistryOptions = {}) {
        this.services = new Map();
        this.dependencies = new Map();
        this.options = {
            allowOverrides: false,
            validateDependencies: true,
            ...options
        };
    }

    /**
     * Register a service with optional dependencies
     */
    registerService(service: BaseService, dependencies: ServiceDependency[] = []): void {
        const serviceName = service.getName();

        // Check if service already exists
        if (this.services.has(serviceName) && !this.options.allowOverrides) {
            throw new ServiceRegistryError(
                `Service '${serviceName}' is already registered and overrides are not allowed`
            );
        }

        // Validate dependencies if enabled
        if (this.options.validateDependencies) {
            this.validateDependencies(dependencies);
        }

        // Store the service and its dependencies
        this.services.set(serviceName, service);
        this.dependencies.set(serviceName, dependencies);
    }

    /**
     * Get a registered service by name
     */
    getService<T extends BaseService>(name: string): T {
        const service = this.services.get(name);
        if (!service) {
            throw new ServiceRegistryError(`Service '${name}' not found`);
        }
        return service as T;
    }

    /**
     * Check if a service is registered
     */
    hasService(name: string): boolean {
        return this.services.has(name);
    }

    /**
     * List all registered services
     */
    listServices(): string[] {
        return Array.from(this.services.keys());
    }

    /**
     * Get all services that provide a specific capability
     */
    findServicesByCapability(capability: string): BaseService[] {
        return Array.from(this.services.values())
            .filter(service => service.hasCapability(capability));
    }

    /**
     * Get service dependencies
     */
    getServiceDependencies(serviceName: string): ServiceDependency[] {
        return this.dependencies.get(serviceName) || [];
    }

    /**
     * Initialize all registered services in dependency order
     */
    async initializeAll(): Promise<void> {
        const initialized = new Set<string>();
        const services = Array.from(this.services.entries());

        while (initialized.size < services.length) {
            let progress = false;

            for (const [name, service] of services) {
                if (initialized.has(name)) continue;

                const dependencies = this.getServiceDependencies(name);
                const dependenciesMet = dependencies.every(dep => 
                    !dep.required || initialized.has(dep.serviceName)
                );

                if (dependenciesMet) {
                    await service.initialize();
                    initialized.add(name);
                    progress = true;
                }
            }

            if (!progress && initialized.size < services.length) {
                throw new ServiceRegistryError('Circular dependency detected during initialization');
            }
        }
    }

    /**
     * Destroy all services in reverse dependency order
     */
    async destroyAll(): Promise<void> {
        const services = Array.from(this.services.values()).reverse();
        for (const service of services) {
            await service.destroy();
        }
    }

    /**
     * Validate service dependencies
     */
    private validateDependencies(dependencies: ServiceDependency[]): void {
        for (const dep of dependencies) {
            const service = this.services.get(dep.serviceName);
            
            if (dep.required && !service) {
                throw new ServiceRegistryError(
                    `Required dependency '${dep.serviceName}' not found`
                );
            }

            if (service && dep.minimumVersion) {
                const currentVersion = service.getVersion();
                if (compareVersions(currentVersion, dep.minimumVersion) < 0) {
                    throw new ServiceRegistryError(
                        `Service '${dep.serviceName}' version ${JSON.stringify(currentVersion)} ` +
                        `does not meet minimum required version ${JSON.stringify(dep.minimumVersion)}`
                    );
                }
            }
        }
    }
}
