import { useState, useRef, useEffect } from 'react';

const MAX_DT_SEC = 3;
const MS_PER_KMH_TO_M_PER_SEC = (1000 / 3600);

export type UseAccumulatedDistanceOptions = {
  /** 현재 속도 (km/h). GPS 없을 때 speed * dt 로 누적 */
  speedKmh: number;
  /** 경과 시간(초). 리셋 시 0이 되면 누적 거리도 0으로 초기화 */
  elapsedSeconds: number;
  /** (선택) GPS 기반으로 계산된 이번 틱의 거리(m). 있으면 이 값으로 누적, 없으면 speed*dt 사용 */
  deltaDistanceMFromGps?: number | null;
};

/**
 * 단조 증가하는 누적 거리(m).
 * - 매 틱 deltaDistanceM = (speedKmh * 1000/3600) * deltaSeconds 누적
 * - dt <= 0 무시, dt > MAX_DT_SEC(3초) cap (백그라운드 복귀 대비)
 * - totalDistanceM이 이전보다 작아지면 이전 값 유지
 * - elapsedSeconds가 이전보다 줄어들면(리셋) 누적 거리 0으로 초기화
 */
export function useAccumulatedDistance(
  options: UseAccumulatedDistanceOptions
): number {
  const { speedKmh, elapsedSeconds, deltaDistanceMFromGps } = options;

  const [totalDistanceM, setTotalDistanceM] = useState(0);
  const lastElapsedRef = useRef(elapsedSeconds);
  const lastTotalRef = useRef(0);

  useEffect(() => {
    const prevElapsed = lastElapsedRef.current;
    const deltaSeconds = elapsedSeconds - prevElapsed;

    if (deltaSeconds <= 0) {
      if (elapsedSeconds === 0) {
        setTotalDistanceM(0);
        lastTotalRef.current = 0;
      }
      lastElapsedRef.current = elapsedSeconds;
      return;
    }

    const cappedDt = Math.min(deltaSeconds, MAX_DT_SEC);

    let deltaM: number;
    if (
      deltaDistanceMFromGps != null &&
      !Number.isNaN(deltaDistanceMFromGps) &&
      deltaDistanceMFromGps >= 0
    ) {
      deltaM = Math.min(
        deltaDistanceMFromGps,
        speedKmh * MS_PER_KMH_TO_M_PER_SEC * cappedDt * 2
      );
    } else {
      deltaM = speedKmh * MS_PER_KMH_TO_M_PER_SEC * cappedDt;
    }

    lastElapsedRef.current = elapsedSeconds;

    setTotalDistanceM((prev) => {
      const next = prev + deltaM;
      const safe = Math.max(prev, next);
      lastTotalRef.current = safe;
      return safe;
    });
  }, [elapsedSeconds, speedKmh, deltaDistanceMFromGps]);

  return totalDistanceM;
}
