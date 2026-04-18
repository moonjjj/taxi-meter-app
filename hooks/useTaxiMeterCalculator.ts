import { useRef, useMemo, useEffect } from 'react';

/** 100원 단위 증가 시 호출. deltaSteps: 이번에 증가한 100원 step 수 */
export type OnFareIncrement = (deltaSteps: number) => void;

export type UseTaxiMeterCalculatorOptions = {
  /** 기본요금 (원). START 시점 요금 */
  baseFare: number;
  /** 경과 시간(초). 타이머 훅에서 전달 */
  elapsedSeconds: number;
  /** 현재 속도 (km/h). 모의 값 또는 실제 GPS */
  speedKmh: number;
  /** 타이머가 동작 중일 때만 요금 누적할지 (일시정지 시 경과가 멈춘 상태면 true 권장) */
  isRunning: boolean;
  /** 100원 단위 증가 시 외부에 전달할 콜백 (예: FareDisplayAnimator.enqueueFareIncrement) */
  onFareIncrement?: OnFareIncrement;
  /** 100원 증가 기준 시간(초). 기본 60초마다 100원 */
  fareIntervalSeconds?: number;
};

export type UseTaxiMeterCalculatorReturn = {
  /** 실제 계산된 요금 (100원 단위). 즉시 반영 */
  actualFare: number;
  /** 현재 속도 구간 가중치 (1 = 저속, 1.5 = 중속, 2 = 고속) */
  speedFactor: number;
};

/**
 * 속도 구간별 요금 증가 가중치 (F-6 초안)
 * 저속(0~4): 1, 중속(4~10): 1.5, 고속(10~): 2
 */
function getSpeedFactor(speedKmh: number): number {
  if (speedKmh < 4) return 1;
  if (speedKmh < 10) return 1.5;
  return 2;
}

/**
 * 요금 계산 엔진.
 * - actualFare = baseFare + (누적 step × 100원)
 * - 누적 step = 경과 시간을 속도 가중치 반영해 기준 간격으로 나눈 값
 * - 100원 증가 시 onFareIncrement(deltaSteps) 호출
 */
export function useTaxiMeterCalculator(
  options: UseTaxiMeterCalculatorOptions
): UseTaxiMeterCalculatorReturn {
  const {
    baseFare,
    elapsedSeconds,
    speedKmh,
    isRunning,
    onFareIncrement,
    fareIntervalSeconds = 60,
  } = options;

  const prevStepsRef = useRef(0);
  const onFareIncrementRef = useRef(onFareIncrement);
  onFareIncrementRef.current = onFareIncrement;

  const speedFactor = useMemo(() => getSpeedFactor(speedKmh), [speedKmh]);

  // 경과 시간 × 속도 가중치(effective seconds) 기준으로 step 계산 → fareIntervalSeconds마다 100원
  const accumulatedSteps = useMemo(() => {
    const effectiveSeconds = elapsedSeconds * speedFactor;
    return Math.floor(effectiveSeconds / fareIntervalSeconds);
  }, [elapsedSeconds, speedFactor, fareIntervalSeconds]);

  const actualFare = baseFare + accumulatedSteps * 100;

  // 누적 step이 증가했을 때만 onFareIncrement 호출 (ref 사용으로 최신 콜백 보장)
  useEffect(() => {
    const prev = prevStepsRef.current;
    if (accumulatedSteps > prev) {
      const delta = accumulatedSteps - prev;
      prevStepsRef.current = accumulatedSteps;
      onFareIncrementRef.current?.(delta);
    }
  }, [accumulatedSteps]);

  // 리셋 시 elapsedSeconds가 0으로 바뀌면 prev 동기화
  useEffect(() => {
    if (elapsedSeconds === 0) prevStepsRef.current = 0;
  }, [elapsedSeconds]);

  return { actualFare, speedFactor };
}
