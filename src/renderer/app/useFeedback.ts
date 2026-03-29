import { useCallback, useEffect, useRef, useState } from 'react';

export const FEEDBACK_AUTO_CLEAR_MS = 3000;

export interface FeedbackController {
  message: string | null;
  show(message: string): void;
  clear(): void;
}

export function useFeedback(): FeedbackController {
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    clearTimeoutRef();
    setMessage(null);
  }, [clearTimeoutRef]);

  const show = useCallback(
    (nextMessage: string) => {
      clearTimeoutRef();
      setMessage(nextMessage);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        setMessage(null);
      }, FEEDBACK_AUTO_CLEAR_MS);
    },
    [clearTimeoutRef]
  );

  useEffect(() => {
    return () => {
      clearTimeoutRef();
    };
  }, [clearTimeoutRef]);

  return { message, show, clear };
}
