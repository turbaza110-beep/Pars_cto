export interface CleanupDataJob {
  entity: string;
  olderThan: string;
  batchSize?: number;
  dryRun?: boolean;
}
