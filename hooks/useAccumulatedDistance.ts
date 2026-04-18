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
  /**
   * useGpsSpeed의 gpsUpdateId. 이 값이 변할 때만 deltaDistanceMFromGps를 소비한다.
   * 타이머 틱(1s)과 GPS 업데이트(1.5s)의 주기가 달라 동일한 delta가 중복 반영되는 것을 방지한다.
   */
  gpsUpdateId?: number;
};

/**
 * 단조 증가하는 누적 거리(m).
 * - GPS delta(gpsUpdateId 변경 시 1회만 소비) → speed*dt 폴백 순으로 거리를 누적.
 * - dt <= 0 무시, dt > MAX_DT_SEC(3초) cap (백그라운드 복귀 대비)
 * - totalDistanceM이 이전보다 작아지면 이전 값 유지
 * - elapsedSeconds가 이전보다 줄어들면(리셋) 누적 거리 0으로 초기화
 */
export function useAccumulatedDistance(
  options: UseAccumulatedDistanceOptions
): number {
  const { speedKmh, elapsedSeconds, deltaDistanceMFromGps, gpsUpdateId = 0 } = options;

  const [totalDistanceM, setTotalDistanceM] = useState(0);
  const lastElapsedRef = useRef(elapsedSeconds);
  const lastTotalRef = useRef(0);
  /** 마지막으로 소비한 gpsUpdateId. 같은 GPS 업데이트를 중복 반영하지 않는다. */
  const lastConsumedGpsUpdateIdRef = useRef(-1);

  useEffect(() => {
    const prevElapsed = lastElapsedRef.current;
    const deltaSeconds = elapsedSeconds - prevElapsed;

    if (deltaSeconds <= 0) {
      if (elapsedSeconds === 0) {
        setTotalDistanceM(0);
        lastTotalRef.current = 0;
        lastConsumedGpsUpdateIdRef.current = -1;
      }
      lastElapsedRef.current = elapsedSeconds;
      return;
    }

    const cappedDt = Math.min(deltaSeconds, MAX_DT_SEC);

    let deltaM: number;
    // [FIX] gpsUpdateId가 마지막 소비 id보다 클 때만 GPS delta를 사용한다.
    // 이를 통해 타이머 틱이 GPS 업데이트보다 자주 발생해도 동일한 delta를 중복 반영하지 않는다.
    const isNewGpsUpdate = gpsUpdateId > lastConsumedGpsUpdateIdRef.current;
    if (
      isNewGpsUpdate &&
      deltaDistanceMFromGps != null &&
      !Number.isNaN(deltaDistanceMFromGps) &&
      deltaDistanceMFromGps >= 0
    ) {
      lastConsumedGpsUpdateIdRef.current = gpsUpdateId;
      // GPS delta를 상한으로 클램핑: speed * dt * 2 초과는 이상값으로 본다
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
  }, [elapsedSeconds, speedKmh, deltaDistanceMFromGps, gpsUpdateId]);

  return totalDistanceM;
}
