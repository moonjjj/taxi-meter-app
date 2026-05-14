# 개발 가이드

## 사전 준비

```bash
# Node.js 설치 확인 (18 이상 권장)
node -v

# Expo CLI 전역 설치
npm install -g expo-cli

# EAS CLI 전역 설치 (빌드/배포용)
npm install -g eas-cli

# 프로젝트 의존성 설치
npm install
```

---

## 프로젝트 실행 (개발)

### 기본 시작

```bash
npx expo start
```

터미널에 QR코드가 뜨면:
- **iOS**: Expo Go 앱으로 QR 스캔
- **Android**: Expo Go 앱으로 QR 스캔
- **`i`** 입력: iOS 시뮬레이터 실행
- **`a`** 입력: Android 에뮬레이터 실행

### 캐시 초기화 후 시작 (오류 시)

```bash
npx expo start --clear
```

### 네이티브 코드 포함 실행

```bash
# iOS (Mac + Xcode 필요)
npm run ios

# Android (Android Studio 필요)
npm run android
```

---

## 빌드 (EAS Build)

> EAS 빌드는 Expo 클라우드 서버에서 실행됩니다. `eas login`으로 로그인 필요.

```bash
eas login
```

### iOS 빌드

| 목적 | 명령어 |
|------|--------|
| 개발용 (내부 배포) | `eas build --platform ios --profile development` |
| 테스트용 (내부 배포) | `eas build --platform ios --profile preview` |
| 앱스토어 제출용 | `eas build --platform ios --profile production` |

### Android 빌드

| 목적 | 명령어 |
|------|--------|
| 개발용 (내부 배포) | `eas build --platform android --profile development` |
| 테스트용 (APK) | `eas build --platform android --profile preview` |
| 플레이스토어 제출용 | `eas build --platform android --profile production` |

### iOS + Android 동시 빌드

```bash
eas build --platform all --profile production
```

---

## 스토어 제출

```bash
# App Store (iOS)
eas submit --platform ios

# Google Play (Android)
eas submit --platform android
```

---

## 프로젝트 정보

| 항목 | 값 |
|------|----|
| 앱 이름 | 추억의 택시미터기 |
| 버전 | 1.0.2 |
| Expo SDK | 55 |
| iOS Bundle ID | com.jeseon.taximeter |
| Android Package | com.jeseon.taximeter |
| EAS Project ID | a43b5bfc-c3df-4663-bb71-6d5b7b367f56 |
