import { useMemo, useRef, useEffect } from 'react';

const BASE_DISTANCE_M = 1600;
const DISTANCE_PER_100_M = 131;
const TIME_PER_100_SEC = 30;
const SPEED_THRESHOLD_KMH = 4;

export type CountdownMode = 'base' | 'distance' | 'time';

export type CountdownBucketResult = {
  mode: CountdownMode;
  actualValue: number;
  unit: 'm' | 'sec';
};

export type UseCountdownBucketOptions = {
  totalDistanceM: number;
  speedKmh: number;
  elapsedSeconds: number;
  onFareIncrement?: (steps: number) => void;
};

/**
 * 카운트다운 버킷: 숫자가 0이 되면 요금 +100원 후 리필.
 * - Base: 1600 → 0 되면 +100원, 이후 131m 또는 30초 버킷으로 전환
 * - Distance: 131 → 0 되면 +100원, 131로 리필 반복
 * - Time: 30 → 0 되면 +100원, 30으로 리필 반복
 */
export function useCountdownBucket(
  options: UseCountdownBucketOptions
): CountdownBucketResult {
  const { totalDistanceM, speedKmh, elapsedSeconds, onFareIncrement } = options;

  const onFareRef = useRef(onFareIncrement);
  onFareRef.current = onFareIncrement;

  const lastFiredBaseRef = useRef(false);
  const lastFiredDistanceBucketRef = useRef(0);
  const lastFiredTimeBucketRef = useRef(0);

  const extraDistanceM = Math.max(0, totalDistanceM - BASE_DISTANCE_M);

  const result = useMemo(() => {
    if (totalDistanceM < BASE_DISTANCE_M) {
      const remaining = (() => {
        // 속도가 0이면, Base를 "1초마다 1씩" 떨어뜨리는 느낌으로 표시
        if (speedKmh === 0) {
          return Math.max(0, Math.floor(BASE_DISTANCE_M - elapsedSeconds));
        }
        // 그 외에는 실제 이동 거리 기준으로 감소
        return Math.max(0, Math.floor(BASE_DISTANCE_M - totalDistanceM));
      })();

      return {
        mode: 'base' as CountdownMode,
        actualValue: remaining,
        unit: 'm' as const,
      };
    }

    if (speedKmh >= SPEED_THRESHOLD_KMH) {
      const remainder = extraDistanceM % DISTANCE_PER_100_M;
      const actualValue =
        remainder === 0 ? DISTANCE_PER_100_M : DISTANCE_PER_100_M - remainder;
      return {
        mode: 'distance' as CountdownMode,
        actualValue: Math.floor(actualValue),
        unit: 'm' as const,
      };
    }

    const remainder = elapsedSeconds % TIME_PER_100_SEC;
    const actualValue =
      remainder === 0 ? TIME_PER_100_SEC : TIME_PER_100_SEC - remainder;
    return {
      mode: 'time' as CountdownMode,
      actualValue: Math.floor(actualValue),
      unit: 'sec' as const,
    };
  }, [totalDistanceM, speedKmh, elapsedSeconds, extraDistanceM]);

  useEffect(() => {
    if (totalDistanceM === 0 && elapsedSeconds === 0) {
      lastFiredBaseRef.current = false;
      lastFiredDistanceBucketRef.current = 0;
      lastFiredTimeBucketRef.current = 0;
    }
  }, [totalDistanceM, elapsedSeconds]);

  useEffect(() => {
    if (totalDistanceM < BASE_DISTANCE_M) return;
    if (!lastFiredBaseRef.current) {
      lastFiredBaseRef.current = true;
      onFareRef.current?.(1);
    }
  }, [totalDistanceM]);

  useEffect(() => {
    if (totalDistanceM < BASE_DISTANCE_M || speedKmh < SPEED_THRESHOLD_KMH)
      return;
    const bucketIndex = Math.floor(extraDistanceM / DISTANCE_PER_100_M);
    if (bucketIndex > lastFiredDistanceBucketRef.current) {
      const delta = bucketIndex - lastFiredDistanceBucketRef.current;
      lastFiredDistanceBucketRef.current = bucketIndex;
      onFareRef.current?.(delta);
    }
  }, [totalDistanceM, speedKmh, extraDistanceM]);

  useEffect(() => {
    if (totalDistanceM < BASE_DISTANCE_M || speedKmh >= SPEED_THRESHOLD_KMH)
      return;
    const bucketIndex = Math.floor(elapsedSeconds / TIME_PER_100_SEC);
    if (bucketIndex > lastFiredTimeBucketRef.current) {
      const delta = bucketIndex - lastFiredTimeBucketRef.current;
      lastFiredTimeBucketRef.current = bucketIndex;
      onFareRef.current?.(delta);
    }
  }, [totalDistanceM, speedKmh, elapsedSeconds]);

  return result;
}
