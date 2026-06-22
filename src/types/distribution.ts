export type WarningKind =
  | 'DEPENDENCY_VIOLATION'
  | 'CAPACITY_OVERFLOW'
  | 'EPIC_WINDOW_EXCEEDED'
  | 'NO_ESTIMATE';

export interface DistributionWarning {
  kind: WarningKind;
  docId: string;
  message: string;
  context?: Record<string, unknown>;
}
