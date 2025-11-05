/**
 * Performance Monitoring Utilities
 *
 * Provides utilities for monitoring and logging application performance metrics.
 */

interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private maxMetrics = 100; // Keep last 100 metrics

  /**
   * Measure the execution time of a function
   */
  async measure<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const startTime = performance.now();

    try {
      const result = await fn();
      const duration = performance.now() - startTime;

      this.recordMetric(name, duration);

      if (duration > 1000) {
        console.warn(`[Performance] ${name} took ${duration.toFixed(2)}ms`);
      }

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.recordMetric(`${name} (error)`, duration);
      throw error;
    }
  }

  /**
   * Start a performance mark
   */
  mark(name: string): void {
    performance.mark(name);
  }

  /**
   * Measure between two marks
   */
  measureBetween(measureName: string, startMark: string, endMark: string): number {
    performance.mark(endMark);
    performance.measure(measureName, startMark, endMark);

    const measure = performance.getEntriesByName(measureName)[0] as PerformanceMeasure;
    const duration = measure.duration;

    this.recordMetric(measureName, duration);

    // Cleanup marks and measures
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(measureName);

    return duration;
  }

  /**
   * Record a custom metric
   */
  recordMetric(name: string, value: number): void {
    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
    });

    // Keep only last maxMetrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(filterName?: string): PerformanceMetric[] {
    if (filterName) {
      return this.metrics.filter(m => m.name.includes(filterName));
    }
    return [...this.metrics];
  }

  /**
   * Get average value for a metric
   */
  getAverage(name: string): number | null {
    const filtered = this.metrics.filter(m => m.name === name);
    if (filtered.length === 0) return null;

    const sum = filtered.reduce((acc, m) => acc + m.value, 0);
    return sum / filtered.length;
  }

  /**
   * Get performance summary
   */
  getSummary(): Record<string, { count: number; avg: number; min: number; max: number }> {
    const summary: Record<string, { count: number; avg: number; min: number; max: number }> = {};

    this.metrics.forEach(metric => {
      if (!summary[metric.name]) {
        summary[metric.name] = {
          count: 0,
          avg: 0,
          min: Infinity,
          max: -Infinity,
        };
      }

      const s = summary[metric.name];
      s.count++;
      s.avg = (s.avg * (s.count - 1) + metric.value) / s.count;
      s.min = Math.min(s.min, metric.value);
      s.max = Math.max(s.max, metric.value);
    });

    return summary;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Log performance summary to console
   */
  logSummary(): void {
    const summary = this.getSummary();
    console.table(
      Object.entries(summary).map(([name, stats]) => ({
        Operation: name,
        Count: stats.count,
        'Avg (ms)': stats.avg.toFixed(2),
        'Min (ms)': stats.min.toFixed(2),
        'Max (ms)': stats.max.toFixed(2),
      })),
    );
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Expose to window for debugging
declare global {
  interface Window {
    performanceMonitor: PerformanceMonitor;
  }
}

if (typeof window !== 'undefined') {
  window.performanceMonitor = performanceMonitor;
}
