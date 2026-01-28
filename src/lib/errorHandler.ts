/**
 * 统一的错误处理工具
 */

/**
 * 错误日志级别
 */
export const ErrorLevel = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
} as const;

export type ErrorLevel = typeof ErrorLevel[keyof typeof ErrorLevel];

/**
 * 记录错误（仅在开发环境或关键错误时输出）
 */
export function logError(
  message: string,
  error?: unknown,
  level: ErrorLevel = ErrorLevel.ERROR
): void {
  // 在生产环境中，只记录关键错误
  const isDevelopment = import.meta.env.DEV;
  
  if (!isDevelopment && level !== ErrorLevel.ERROR) {
    return;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const fullMessage = error ? `${message}: ${errorMessage}` : message;

  switch (level) {
    case ErrorLevel.ERROR:
      console.error(fullMessage, error);
      break;
    case ErrorLevel.WARN:
      console.warn(fullMessage);
      break;
    case ErrorLevel.INFO:
      console.info(fullMessage);
      break;
  }
}

/**
 * 静默处理错误（不输出到控制台）
 * 用于非关键错误，如缓存失败等
 */
export function handleSilentError<T>(
  operation: () => T,
  fallback: T
): T {
  try {
    return operation();
  } catch {
    return fallback;
  }
}

/**
 * 异步静默处理错误
 */
export async function handleSilentAsyncError<T>(
  operation: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}
