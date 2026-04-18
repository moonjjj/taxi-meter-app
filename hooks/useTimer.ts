import { useState, useRef, useCallback, useEffect } from 'react';

export type TimerState = 'idle' | 'running' | 'paused';

export type UseTimerReturn = {
  /** 경과 시간(초). 리셋 시 0, 일시정지 시 해당 시점에서 고정 */
  elapsedSeconds: number;
  /** idle | running | paused */
  state: TimerState;
  /** 타이머 시작 (idle 또는 paused → running) */
  start: () => void;
  /** 일시정지 (running → paused) */
  pause: () => void;
  /** 초기화: 경과 0, 상태 idle */
  reset: () => void;
  /** 재개 (paused → running). start()와 동일 동작 */
  resume: () => void;
};

const TICK_MS = 1000;

/**
 * 타이머 훅. 시작/일시정지/리셋 지원.
 * START 시 경과 시간이 1초마다 1씩 증가, PAUSE 시 해당 시점에서 고정, RESET 시 0으로 초기화.
 */
export function useTimer(): UseTimerReturn {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [state, setState] = useState<TimerState>('idle');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickAtRef = useRef<number>(0);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clearTimer();
    setState('running');
    lastTickAtRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
      lastTickAtRef.current = Date.now();
    }, TICK_MS);
  }, [clearTimer]);

  const pause = useCallback(() => {
    if (state !== 'running') return;
    clearTimer();
    setState('paused');
  }, [state, clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setElapsedSeconds(0);
    setState('idle');
  }, [clearTimer]);

  const resume = useCallback(() => {
    if (state === 'paused') start();
  }, [state, start]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return {
    elapsedSeconds,
    state,
    start,
    pause,
    reset,
    resume,
  };
}
