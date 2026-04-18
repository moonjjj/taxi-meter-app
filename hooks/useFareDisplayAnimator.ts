import { useState, useCallback, useRef } from 'react';

export type UseFareDisplayAnimatorOptions = {
  /** 초기 표시 요금 (보통 기본요금) */
  initialDisplayFare: number;
};

export type UseFareDisplayAnimatorReturn = {
  /** 화면에 표시할 요금. 애니메이션 완료 시에만 +100 반영 */
  displayFare: number;
  /** 현재 롤링 애니메이션 진행 여부 */
  isFareAnimating: boolean;
  /** 아직 표시에 반영되지 않은 100원 step 수 */
  pendingStepCount: number;
  /** 100원 단위 step N개를 큐에 추가 (한 번에 +N×100원 대응) */
  enqueueFareIncrement: (steps: number) => void;
  /** 다음 step 처리: 큐에서 1개 꺼내 애니메이션 시작. 반환: 애니메이션을 시작했으면 true */
  processNextStep: () => boolean;
  /** 애니메이션 완료 시 호출. displayFare += 100, 다음 step 있으면 processNextStep 호출은 UI에서 */
  onAnimationComplete: () => void;
  /** displayFare를 actualFare로 강제 동기화, 큐 비우기 (복구/포그라운드/리셋용) */
  syncDisplayFareToActual: (actualFare: number) => void;
  /** 큐 비우기 + 표시 요금 설정 (리셋 시 기본요금 등) */
  reset: (displayFare: number) => void;
};

/**
 * FareDisplayAnimator 로직 (UI 없이 순수 상태/큐 관리).
 * - 요금 계산 엔진의 actualFare와 분리되어, 화면 표시용 displayFare와 100원 단위 애니메이션 큐만 관리.
 * - processNextStep()으로 한 step 씩 꺼내 애니메이션 트리거, onAnimationComplete()로 완료 처리.
 */
export function useFareDisplayAnimator(
  options: UseFareDisplayAnimatorOptions
): UseFareDisplayAnimatorReturn {
  const { initialDisplayFare } = options;

  const [displayFare, setDisplayFare] = useState(initialDisplayFare);
  const [isFareAnimating, setIsFareAnimating] = useState(false);
  /** 큐: 아직 표시에 반영되지 않은 100원 step 개수 */
  const [fareStepQueue, setFareStepQueue] = useState(0);

  const enqueueFareIncrement = useCallback((steps: number) => {
    if (steps <= 0) return;
    setFareStepQueue((q) => q + steps);
  }, []);

  const processNextStep = useCallback((): boolean => {
    if (isFareAnimating || fareStepQueue <= 0) return false;
    setFareStepQueue((q) => {
      if (q <= 0) return 0;
      setIsFareAnimating(true);
      return q - 1;
    });
    return true;
  }, [isFareAnimating, fareStepQueue]);

  const onAnimationComplete = useCallback(() => {
    setDisplayFare((prev) => prev + 100);
    setIsFareAnimating(false);
  }, []);

  const syncDisplayFareToActual = useCallback((actualFare: number) => {
    setDisplayFare(actualFare);
    setFareStepQueue(0);
    setIsFareAnimating(false);
  }, []);

  const reset = useCallback((newDisplayFare: number) => {
    setDisplayFare(newDisplayFare);
    setFareStepQueue(0);
    setIsFareAnimating(false);
  }, []);

  return {
    displayFare,
    isFareAnimating,
    pendingStepCount: fareStepQueue,
    enqueueFareIncrement,
    processNextStep,
    onAnimationComplete,
    syncDisplayFareToActual,
    reset,
  };
}
