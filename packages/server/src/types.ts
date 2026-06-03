export interface ServerConfig {
  port: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  agentsDir: string;
  sessionTtlMs: number;
  maxSessions: number;
  sessionStoreBackend: 'memory' | 'fs' | 'postgres';
  postgresUrl?: string;
  sessionStoreDir?: string;
  authTokens: string[];
  mcpAuthTokens: string[];
  corsAllowedOrigins: string[];
  maxRequestBytes: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  rateLimitSessionsPerHour: number;
  rateLimitMessagesPerHour: number;
  turnTimeoutMs: number;
  llmCircuitFailures: number;
  llmCircuitOpenMs: number;
  toolHttpHeaders?: Record<string, string>;
}

export interface CreateSessionRequest {
  agentId: string;
  context?: Record<string, unknown>;
}

export interface SendMessageRequest {
  message: string;
}
