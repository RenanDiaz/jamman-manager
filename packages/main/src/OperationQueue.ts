import log from 'electron-log';
import { BrowserWindow } from 'electron';

/**
 * Priority levels for operations
 */
export enum OperationPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
}

/**
 * Operation status
 */
export enum OperationStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Operation metadata
 */
export interface Operation {
  id: string;
  type: string;
  description: string;
  priority: OperationPriority;
  status: OperationStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Queued operation with execution function
 */
interface QueuedOperation extends Operation {
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

/**
 * Operation queue for managing concurrent operations
 * Limits the number of simultaneous operations and provides priority-based scheduling
 */
export class OperationQueue {
  private queue: QueuedOperation[] = [];
  private running: Map<string, QueuedOperation> = new Map();
  private completed: Operation[] = [];
  private readonly maxConcurrent: number;
  private operationCounter = 0;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
    log.info(`OperationQueue initialized with max ${maxConcurrent} concurrent operations`);
  }

  /**
   * Add an operation to the queue
   */
  async enqueue<T>(
    type: string,
    description: string,
    fn: () => Promise<T>,
    priority: OperationPriority = OperationPriority.NORMAL,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const operation: QueuedOperation = {
        id: `op_${++this.operationCounter}`,
        type,
        description,
        priority,
        status: OperationStatus.QUEUED,
        createdAt: new Date(),
        execute: fn,
        resolve,
        reject,
      };

      // Insert into queue based on priority (higher priority first)
      const insertIndex = this.queue.findIndex(op => op.priority < priority);
      if (insertIndex === -1) {
        this.queue.push(operation);
      } else {
        this.queue.splice(insertIndex, 0, operation);
      }

      log.info(
        `Operation queued: ${operation.id} (${type}) - Priority: ${priority}, Queue size: ${this.queue.length}`,
      );

      this.notifyStatusChange();
      this.processQueue();
    });
  }

  /**
   * Process the next operation in the queue
   */
  private async processQueue(): Promise<void> {
    // Check if we can run more operations
    if (this.running.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    // Get next operation from queue (already sorted by priority)
    const operation = this.queue.shift();
    if (!operation) return;

    // Mark as running
    operation.status = OperationStatus.RUNNING;
    operation.startedAt = new Date();
    this.running.set(operation.id, operation);

    log.info(
      `Operation started: ${operation.id} (${operation.type}) - Running: ${this.running.size}/${this.maxConcurrent}`,
    );

    this.notifyStatusChange();

    try {
      // Execute the operation
      const result = await operation.execute();

      // Mark as completed
      operation.status = OperationStatus.COMPLETED;
      operation.completedAt = new Date();
      operation.resolve(result);

      log.info(
        `Operation completed: ${operation.id} (${operation.type}) - Duration: ${
          operation.completedAt.getTime() - operation.startedAt!.getTime()
        }ms`,
      );
    } catch (error) {
      // Mark as failed
      operation.status = OperationStatus.FAILED;
      operation.completedAt = new Date();
      operation.error = error instanceof Error ? error.message : String(error);
      operation.reject(error);

      log.error(`Operation failed: ${operation.id} (${operation.type})`, error);
    } finally {
      // Remove from running, add to completed
      this.running.delete(operation.id);
      this.completed.push({
        id: operation.id,
        type: operation.type,
        description: operation.description,
        priority: operation.priority,
        status: operation.status,
        createdAt: operation.createdAt,
        startedAt: operation.startedAt,
        completedAt: operation.completedAt,
        error: operation.error,
      });

      // Keep only last 50 completed operations
      if (this.completed.length > 50) {
        this.completed = this.completed.slice(-50);
      }

      this.notifyStatusChange();

      // Process next operation
      this.processQueue();
    }
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      queued: this.queue.map(op => ({
        id: op.id,
        type: op.type,
        description: op.description,
        priority: op.priority,
        status: op.status,
        createdAt: op.createdAt,
      })),
      running: Array.from(this.running.values()).map(op => ({
        id: op.id,
        type: op.type,
        description: op.description,
        priority: op.priority,
        status: op.status,
        createdAt: op.createdAt,
        startedAt: op.startedAt,
      })),
      completed: this.completed.slice(-10), // Last 10 completed
      stats: {
        queuedCount: this.queue.length,
        runningCount: this.running.size,
        completedCount: this.completed.length,
        maxConcurrent: this.maxConcurrent,
      },
    };
  }

  /**
   * Notify renderer process of status changes
   */
  private notifyStatusChange(): void {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const status = this.getStatus();
      windows[0].webContents.send('operation-queue:status', status);
    }
  }

  /**
   * Clear all completed operations from history
   */
  clearCompleted(): void {
    this.completed = [];
    log.info('Cleared completed operations history');
  }

  /**
   * Get statistics about operations
   */
  getStatistics() {
    const totalCompleted = this.completed.length;
    const successful = this.completed.filter(op => op.status === OperationStatus.COMPLETED).length;
    const failed = this.completed.filter(op => op.status === OperationStatus.FAILED).length;

    const durations = this.completed
      .filter(op => op.startedAt && op.completedAt)
      .map(op => op.completedAt!.getTime() - op.startedAt!.getTime());

    const avgDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      totalCompleted,
      successful,
      failed,
      successRate: totalCompleted > 0 ? (successful / totalCompleted) * 100 : 0,
      averageDuration: Math.round(avgDuration),
      currentlyQueued: this.queue.length,
      currentlyRunning: this.running.size,
    };
  }
}

// Export singleton instance
export const operationQueue = new OperationQueue(3); // Max 3 concurrent operations
