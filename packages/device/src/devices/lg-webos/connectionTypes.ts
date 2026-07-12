export interface WebOSConnection {
  connect(options?: WebOSRequestOptions): Promise<void>;
  disconnect(): Promise<void>;
  request<T>(uri: string, payload?: object, options?: WebOSRequestOptions): Promise<T>;
  // biome-ignore lint/suspicious/noExplicitAny: WebOS subscription payloads have dynamic shapes that vary by URI
  subscribe(uri: string, payload: object, callback: (data: any) => void): Promise<void>;
  getInputSocket(options?: WebOSRequestOptions): Promise<RemoteInputSocket>;
  // biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
  on(event: ConnectionEvent, callback: (...args: any[]) => void): () => void;
  isConnected(): boolean;
  isPaired(): boolean;
  getClientKey(): string | undefined;
}

export interface WebOSRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ConnectionEvent = "connect" | "close" | "error" | "prompt" | "message";

export interface RemoteInputSocket {
  send(type: string, payload?: object): void;
  close(): void;
}

export interface WebOSRequestMessage {
  id: string;
  type: "register" | "request" | "subscribe";
  uri?: string;
  payload?: object;
}

export interface WebOSResponseMessage {
  id: string;
  type: "registered" | "response" | "purchased" | "error";
  payload?: Record<string, unknown>;
  error?: string;
  "client-key"?: string;
}

export interface ConnectionConfig {
  ip: string;
  mac?: string;
  clientKey?: string;
  timeout?: number;
  useSsl?: boolean;
}
