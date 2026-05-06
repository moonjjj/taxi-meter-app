# PROJECT.md

This file provides project-specific context for this repository.

## App Purpose & Vision

**"Nostalgia for the old taxis"** — This app recreates the iconic experience of riding in classic Korean taxis from the 80s-90s era.

The inspiration comes from:
- A galloping horse that runs faster as the taxi speeds up
- Numbers dropping elegantly, with the fare ticking up by 100 won at a time
- The distinctive retro UI design of that golden era

Through this app, users experience the charm and joy of those times while driving — both in the app and on the road. The goal is to rekindle that nostalgic feeling and make meter-watching fun again.

## Commands

```bash
# Start development server
npx expo start

# Run on specific platforms
npx expo start --ios
npx expo start --android
npx expo start --web
```

There are no test commands configured. TypeScript type-checking is the primary code quality tool (`npx tsc --noEmit`).

## Architecture

This is a single-screen React Native / Expo app — a retro-styled taxi fare meter. There is no navigation library; the entire app is one screen (`screens/MainScreen.tsx`).

### Data Flow

```
useTimer (idle → running → paused)
    ↓
useGpsSpeed (expo-location, real GPS with smoothing + anomaly detection)
    ↓
useAccumulatedDistance (speed × time integration)
    ↓
useCountdownBucket (dual-mode fare engine: distance-based ≥4 km/h, time-based <4 km/h)
    ↓
useFareDisplayAnimator (queue-based: each +100 KRW step triggers 180ms animation)
    ↓
OdometerNumber (mechanical rolling digit animation, 220ms per digit)
```

`MainScreen.tsx` composes all hooks and passes data down to display components. All state lives in hooks; components are purely presentational.

### Fare Logic

- Base fare: **3,000 KRW**
- Base phase: first 1,600m accumulated → +100 KRW, then switch to metered mode
- **Distance mode** (speed ≥ 4 km/h): every 131m = +100 KRW
- **Time mode** (speed < 4 km/h): every 30 sec = +100 KRW
- Fare increments are queued in `useFareDisplayAnimator` so the odometer animates each +100 KRW step sequentially even if multiple steps arrive at once

### Key Components

- **SevenSegmentText** — renders retro LED 7-segment digits with glow effects; supports sizes `sm/md/lg/xl` and variants `primary` (cyan), `secondary` (teal), `fare` (red)
- **OdometerNumber** — mechanical rolling digit transitions with staggered timing
- **CountdownRollingDisplay** — wraps OdometerNumber to show distance/time remaining until next fare increment
- **HorseSprite** — Lottie animation with 4 speed levels (idle, low, mid, high)

### Unused / Legacy Files

These hooks exist but are not wired into `MainScreen`:
- `useSpeedMetrics.ts` — synthetic sinusoidal speed for testing
- `useTaxiMeterCalculator.ts` — earlier time-only fare model
- `useMeterCountdown.ts` — duplicates `useCountdownBucket` logic
- `LedHorseIcon.tsx` — static geometric horse icon (kept for reference)

### UI / Visual Design Rules

- All status/alert UI must match the retro instrument-panel aesthetic — no modern rounded cards or soft shadows.
- **Status banners** (GPS lost, permission errors, etc.) use `statusPanel` style: dark background `#030711`, 1px border, borderRadius 2, a thick left accent border (3px), and an inline `BlinkingLed` dot (Animated.View pulsing 0→1 opacity).
  - GPS signal lost: amber accent `#D4A84B`, ALL-CAPS text with `letterSpacing: 1.2`
  - Permission/error: red accent `#FF5050`, same text style
- Text in status banners is ALL CAPS, `fontSize: 8`, `letterSpacing: 1.2` — no sentence-case or modern typography.
- Avoid `rgba()` backgrounds with large radius in the meter frame area; prefer opaque dark backgrounds (`#030711`, `#02040A`) with explicit border colors.

### Platform & Build

- Expo SDK 54, React Native 0.81, React 19, TypeScript strict mode
- Bundle ID: `com.jeseon.taximeter`
- Location permissions are declared in `app.json`; the Korean-language permission message is set via the `expo-location` plugin
- EAS build profiles: `development` (internal distribution), `preview`, `production` (auto-increment version)
- Web support via `react-native-web`
