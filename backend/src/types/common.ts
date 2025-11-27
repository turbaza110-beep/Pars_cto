export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
  requestId?: string;
}

export interface ApiResponse<T> {
  data: T;
  requestId?: string;
}

export interface ApiListResponse<T> {
  data: T[];
  requestId?: string;
}

export interface HealthStatus {
  status: "ok" | "error";
  service: string;
  timestamp: string;
  details?: Record<string, unknown>;
}
