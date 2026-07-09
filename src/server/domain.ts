export type BrowserStatus = "unknown" | "connected" | "not_connected" | "login_required" | "paused";
export type FilterStatus = "idle" | "filtering" | "completed" | "failed";
export type SendStatus = "idle" | "sending" | "paused" | "completed" | "failed";
export type ScheduleMode = "safe" | "auto";
export type ScheduleStatus = "disabled" | "enabled";

export type Job = {
  id: number;
  name: string;
  city: string | null;
  keywords: string | null;
  salary_min: number | null;
  salary_max: number | null;
  active_within: string | null;
  exclude_contacted: number;
  created_at: string;
  updated_at: string;
};

export type Template = {
  id: number;
  name: string;
  body: string;
  is_default: number;
  created_at: string;
  updated_at: string;
};

export type CandidateRecord = {
  id: number;
  external_key: string;
  display_name: string | null;
  job_id: number | null;
  source_url: string | null;
  status: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type Schedule = {
  id: number;
  enabled: number;
  run_time: string;
  job_id: number | null;
  template_id: number | null;
  mode: ScheduleMode;
  daily_cap: number;
  interval_min_seconds: number;
  interval_max_seconds: number;
  updated_at: string;
};

export type AdapterCandidate = {
  externalKey: string;
  displayName?: string;
  sourceUrl?: string;
};

export type FilterInput = {
  jobName: string;
  city?: string;
  keywords?: string;
  activeWithin?: string;
  salaryMin?: number;
  salaryMax?: number;
  excludeContacted: boolean;
};

export type BlockingState = "ok" | "captcha" | "login_required" | "page_error";

export interface SiteAdapter {
  ensureLoggedIn(): Promise<boolean>;
  runFilter(input: FilterInput): Promise<AdapterCandidate[]>;
  sendGreeting(candidate: AdapterCandidate, message: string): Promise<void>;
  detectBlockingState(): Promise<BlockingState>;
}
