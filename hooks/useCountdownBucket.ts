import { useState, useRef, useEffect } from 'react';

const BASE_DISTANCE_M = 1600;
const METERED_BUCKET_M = 131;
const SPEED_THRESHOLD_KMH = 4;

export type CountdownMode = 'base' | 'distance';

export type CountdownBucketResult = {
  mode: CountdownMode;
  actualValue: number;
  unit: 'm';
};

export type UseCountdownBucketOptions = {
  totalDistanceM: number;
  speedKmh: number;
  elapsedSeconds: number;
  onFareIncrement?: (steps: number) => void;
};

/**
 * 카운트다운 버킷. 카운터가 0이 되면 +100원 후 리셋.
 *
 * 카운터는 하나만 존재한다:
 *   - 기본 구간: 1600 → 0 (기본요금 3000원 소진)
 *   - 미터 구간: 131 → 0, 반복 (+100원/회)
 *
 * 감소 방식:
 *   - 주행(speed ≥ 4 km/h): 이동 거리(m)만큼 감소
 *   - 정지/저속(speed < 4 km/h): 1초당 1씩 감소
 */
export function useCountdownBucket(
  options: UseCountdownBucketOptions
): CountdownBucketResult {
  const { totalDistanceM, speedKmh, elapsedSeconds, onFareIncrement } = options;

  const onFareRef = useRef(onFareIncrement);
  onFareRef.current = onFareIncrement;

  const bucketRemainingRef = useRef<number>(BASE_DISTANCE_M);
  const inMeteredPhaseRef = useRef<boolean>(false);
  const lastElapsedRef = useRef<number>(0);
  const lastTotalDistRef = useRef<number>(0);

  const [displayValue, setDisplayValue] = useState<number>(BASE_DISTANCE_M);
  const [inMeteredPhase, setInMeteredPhase] = useState<boolean>(false);

  useEffect(() => {
    // 리셋 감지
    if (elapsedSeconds === 0 && totalDistanceM === 0) {
      bucketRemainingRef.current = BASE_DISTANCE_M;
      inMeteredPhaseRef.current = false;
      lastElapsedRef.current = 0;
      lastTotalDistRef.current = 0;
      setDisplayValue(BASE_DISTANCE_M);
      setInMeteredPhase(false);
      return;
    }

    const dtSec = elapsedSeconds - lastElapsedRef.current;
    if (dtSec <= 0) {
      lastElapsedRef.current = elapsedSeconds;
      lastTotalDistRef.current = totalDistanceM;
      return;
    }

    const dDist = Math.max(0, totalDistanceM - lastTotalDistRef.current);
    lastElapsedRef.current = elapsedSeconds;
    lastTotalDistRef.current = totalDistanceM;

    // 주행 중이면 이동 거리, 정지/저속이면 경과 시간(초)을 감소량으로 사용
    const decrement = speedKmh < SPEED_THRESHOLD_KMH ? dtSec : dDist;

    let current = bucketRemainingRef.current - decrement;
    let fareSteps = 0;

    while (current <= 0) {
      fareSteps++;
      inMeteredPhaseRef.current = true;
      current += METERED_BUCKET_M;
    }

    // 버킷 최대값 초과 방지
    const bucketMax = inMeteredPhaseRef.current ? METERED_BUCKET_M : BASE_DISTANCE_M;
    bucketRemainingRef.current = Math.min(current, bucketMax);

    if (fareSteps > 0) {
      onFareRef.current?.(fareSteps);
      setInMeteredPhase(true);
    }

    setDisplayValue(Math.floor(bucketRemainingRef.current));
  }, [elapsedSeconds, speedKmh, totalDistanceM]);

  return {
    mode: inMeteredPhase ? 'distance' : 'base',
    actualValue: displayValue,
    unit: 'm',
  };
}
