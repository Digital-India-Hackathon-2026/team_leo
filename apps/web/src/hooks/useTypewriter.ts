import { useEffect, useRef, useState } from "react";

/**
 * Smooth typewriter hook.
 * Buffers incoming text and reveals it character-by-character at `speed` chars/ms.
 * When streaming stops, instantly shows the full text (no lag after completion).
 */
export function useTypewriter(target: string, isStreaming: boolean, speed = 18): string {
  const [displayed, setDisplayed] = useState(target);
  const bufferRef = useRef(target);
  const indexRef = useRef(target.length);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // When a new target arrives during streaming, update the buffer
  useEffect(() => {
    if (!isStreaming) {
      // Streaming ended — immediately show full text, cancel animation
      cancelAnimationFrame(rafRef.current);
      bufferRef.current = target;
      indexRef.current = target.length;
      setDisplayed(target);
      return;
    }
    // New text arrived from stream — extend the buffer
    bufferRef.current = target;
  }, [target, isStreaming]);

  // Animation loop — runs only during streaming
  useEffect(() => {
    if (!isStreaming) return;

    // Reset on new stream start (when target shrinks = new message)
    if (target.length < indexRef.current) {
      indexRef.current = 0;
      setDisplayed("");
    }

    const tick = (now: number) => {
      const elapsed = now - lastTimeRef.current;
      const charsToAdd = Math.max(1, Math.floor(elapsed * speed));

      if (indexRef.current < bufferRef.current.length) {
        indexRef.current = Math.min(
          indexRef.current + charsToAdd,
          bufferRef.current.length
        );
        setDisplayed(bufferRef.current.slice(0, indexRef.current));
        lastTimeRef.current = now;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isStreaming, speed]);

  return displayed;
}
