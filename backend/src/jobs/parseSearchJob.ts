import { NormalizedParsingFilters, SearchMode } from "@/types/parsing";

export interface ParseSearchJob {
  requestId?: string;
  searchId: string;
  userId: string;
  query: string;
  filters?: NormalizedParsingFilters;
  mode: SearchMode;
}
