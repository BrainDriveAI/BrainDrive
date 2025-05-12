import { BaseService } from '../../services/base/BaseService';
import { ResourceMonitor, ResourceLimits, ResourceUsage } from './ResourceMonitor';
import { ServiceIsolator } from './ServiceIsolator';

export interface SecurityPolicy {
  allowedServices: {
    [serviceName: string]: {
      allowedMethods: string[];
      allowedEvents?: string[];
      resourceLimits?: ResourceLimits;
    };
  };
  maxConcurrentOperations?: number;
  maxQueueSize?: number;
  timeoutMs?: number;
}

export interface SecurityViolation {
  type: 'method_access' | 'event_access' | 'resource_limit' | 'isolation';
  message: string;
  serviceName?: string;
  methodName?: string;
  resourceType?: string;
  timestamp: number;
}

/**
 * Manages security policies and access control for plugins
 */
export class PluginSecurityManager {
  private policies: Map<string, SecurityPolicy>;
  private violations: Map<string, SecurityViolation[]>;
  private resourceMonitor: ResourceMonitor;
  private serviceIsolator: ServiceIsolator;

  constructor() {
    this.policies = new Map();
    this.violations = new Map();
    this.resourceMonitor = new ResourceMonitor();
    this.serviceIsolator = new ServiceIsolator();
  }

  /**
   * Set security policy for a plugin
   */
  setPluginPolicy(pluginId: string, policy: SecurityPolicy): void {
    this.policies.set(pluginId, policy);
    this.resourceMonitor.setLimits(pluginId, this.getResourceLimits(policy));
  }

  /**
   * Verify method access permission
   */
  verifyMethodAccess(
    pluginId: string,
    serviceName: string,
    methodName: string
  ): void {
    const policy = this.policies.get(pluginId);
    if (!policy) {
      throw this.createSecurityError(
        'No security policy defined for plugin',
        pluginId
      );
    }

    const servicePolicy = policy.allowedServices[serviceName];
    if (!servicePolicy || !servicePolicy.allowedMethods.includes(methodName)) {
      const violation: SecurityViolation = {
        type: 'method_access',
        message: `Unauthorized method access: ${methodName}`,
        serviceName,
        methodName,
        timestamp: Date.now(),
      };
      this.recordViolation(pluginId, violation);
      throw this.createSecurityError(violation.message, pluginId);
    }
  }

  /**
   * Verify event access permission
   */
  verifyEventAccess(pluginId: string, serviceName: string, eventName: string): void {
    const policy = this.policies.get(pluginId);
    if (!policy) {
      throw this.createSecurityError(
        'No security policy defined for plugin',
        pluginId
      );
    }

    const servicePolicy = policy.allowedServices[serviceName];
    if (
      !servicePolicy ||
      !servicePolicy.allowedEvents ||
      !servicePolicy.allowedEvents.includes(eventName)
    ) {
      const violation: SecurityViolation = {
        type: 'event_access',
        message: `Unauthorized event access: ${eventName}`,
        serviceName,
        timestamp: Date.now(),
      };
      this.recordViolation(pluginId, violation);
      throw this.createSecurityError(violation.message, pluginId);
    }
  }

  /**
   * Create isolated service instance for a plugin
   */
  createIsolatedService<T extends BaseService>(
    pluginId: string,
    service: T
  ): T {
    return this.serviceIsolator.isolateService(pluginId, service);
  }

  /**
   * Track resource usage for a plugin
   */
  trackResourceUsage(pluginId: string, usage: ResourceUsage): void {
    try {
      this.resourceMonitor.trackUsage(pluginId, usage);
    } catch (error) {
      const violation: SecurityViolation = {
        type: 'resource_limit',
        message: error.message,
        resourceType: usage.type,
        timestamp: Date.now(),
      };
      this.recordViolation(pluginId, violation);
      throw this.createSecurityError(violation.message, pluginId);
    }
  }

  /**
   * Get resource usage for a plugin
   */
  getResourceUsage(pluginId: string): ResourceUsage[] {
    return this.resourceMonitor.getUsage(pluginId);
  }

  /**
   * Get security violations for a plugin
   */
  getViolations(pluginId: string): SecurityViolation[] {
    return this.violations.get(pluginId) || [];
  }

  /**
   * Clean up resources for a plugin
   */
  cleanupPlugin(pluginId: string): void {
    this.policies.delete(pluginId);
    this.violations.delete(pluginId);
    this.resourceMonitor.cleanup(pluginId);
    this.serviceIsolator.cleanup(pluginId);
  }

  private recordViolation(pluginId: string, violation: SecurityViolation): void {
    if (!this.violations.has(pluginId)) {
      this.violations.set(pluginId, []);
    }
    this.violations.get(pluginId)!.push(violation);
  }

  private createSecurityError(message: string, pluginId: string): Error {
    const error = new Error(`Security violation (${pluginId}): ${message}`);
    error.name = 'SecurityError';
    return error;
  }

  private getResourceLimits(policy: SecurityPolicy): ResourceLimits {
    return {
      maxConcurrentOperations: policy.maxConcurrentOperations || 5,
      maxQueueSize: policy.maxQueueSize || 100,
      timeoutMs: policy.timeoutMs || 5000,
      ...Object.values(policy.allowedServices).reduce(
        (limits, service) => ({ ...limits, ...service.resourceLimits }),
        {}
      ),
    };
  }
}
