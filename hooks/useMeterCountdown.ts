import { useMemo } from 'react';

const BASE_DISTANCE_M = 1600;
const DISTANCE_PER_100_M = 131;
const TIME_PER_100_SEC = 30;
const SPEED_THRESHOLD_KMH = 4;

export type CountdownMode = 'base' | 'distance' | 'time';

export type MeterCountdown = {
  mode: CountdownMode;
  actualValue: number;
  unit: 'm' | 'sec';
};

export type UseMeterCountdownOptions = {
  /** 총 주행 거리 (m) */
  totalDistanceM: number;
  /** 현재 속도 (km/h) */
  speedKmh: number;
  /** 경과 시간 (초) */
  elapsedSeconds: number;
};

/**
 * 택시 미터기 스타일 카운트다운 값 계산.
 * - 기본거리(1.6km) 소진 전: 기본거리 남은 값(m)
 * - 기본거리 소진 후: 속도 임계값에 따라 거리 모드(m) 또는 시간 모드(sec)
 */
export function useMeterCountdown(
  options: UseMeterCountdownOptions
): MeterCountdown {
  const { totalDistanceM, speedKmh, elapsedSeconds } = options;

  const { mode, actualValue, unit } = useMemo(() => {
    if (totalDistanceM < BASE_DISTANCE_M) {
      const remainingBaseDistanceM = Math.max(
        0,
        Math.floor(BASE_DISTANCE_M - totalDistanceM)
      );
      return {
        mode: 'base' as CountdownMode,
        actualValue: remainingBaseDistanceM,
        unit: 'm' as const,
      };
    }

    const extraDistanceM = totalDistanceM - BASE_DISTANCE_M;

    if (speedKmh >= SPEED_THRESHOLD_KMH) {
      const remainder = extraDistanceM % DISTANCE_PER_100_M;
      const remainingToNextDistanceM =
        remainder === 0 ? DISTANCE_PER_100_M : DISTANCE_PER_100_M - remainder;
      return {
        mode: 'distance' as CountdownMode,
        actualValue: Math.floor(remainingToNextDistanceM),
        unit: 'm' as const,
      };
    }

    const remainder = elapsedSeconds % TIME_PER_100_SEC;
    const remainingToNextTimeSec =
      remainder === 0 ? TIME_PER_100_SEC : TIME_PER_100_SEC - remainder;
    return {
      mode: 'time' as CountdownMode,
      actualValue: Math.floor(remainingToNextTimeSec),
      unit: 'sec' as const,
    };
  }, [totalDistanceM, speedKmh, elapsedSeconds]);

  return { mode, actualValue, unit };
}
