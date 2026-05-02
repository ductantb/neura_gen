export type ProviderRequestError = Error & {
  statusCode?: number;
  responseBody?: string;
  retryable?: boolean;
  errorType?:
    | 'TRANSIENT_TIMEOUT'
    | 'TRANSIENT_INFRA'
    | 'TRANSIENT_OOM'
    | 'PERMANENT_INPUT'
    | 'PERMANENT_CONFIG';
};

export type AxiosLikeError = Error & {
  isAxiosError?: boolean;
  response?: {
    status?: number;
    data?: unknown;
  };
};
