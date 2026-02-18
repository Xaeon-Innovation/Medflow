// Simple in-memory cache for frequently accessed data
class SimpleCache {
  private cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
  private defaultTTL = 30000; // 30 seconds default TTL

  set(key: string, data: any, ttl: number = this.defaultTTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  get(key: string): any | null {
    const item = this.cache.get(key);
    if (!item) return null;

    // Check if expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    // Check if expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Get cache stats
  getStats() {
    const now = Date.now();
    let active = 0;
    let expired = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: this.cache.size,
      active,
      expired
    };
  }
}

// Export singleton instance
export const cache = new SimpleCache();

// Cache key generators
export const cacheKeys = {
  employees: () => 'employees:all',
  hospitals: () => 'hospitals:all',
  specialities: () => 'specialities:all',
  employeeByRole: (role: string) => `employees:role:${role}`,
  hospitalById: (id: string) => `hospital:id:${id}`,
  specialityById: (id: string) => `speciality:id:${id}`,
};
