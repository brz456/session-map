import { useCallback, useState } from 'react';

export interface ErrorController {
  message: string | null;
  set(message: string | null): void;
  clear(): void;
}

export function useErrors(): ErrorController {
  const [message, setMessage] = useState<string | null>(null);

  const set = useCallback((nextMessage: string | null) => {
    setMessage(nextMessage);
  }, []);

  const clear = useCallback(() => {
    setMessage(null);
  }, []);

  return { message, set, clear };
}
