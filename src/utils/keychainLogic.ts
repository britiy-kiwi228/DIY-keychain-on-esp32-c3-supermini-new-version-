/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface BatteryStatus {
  millivolts: number;
  percentage: number;
  isCharging: boolean;
}

/**
 * Calculates battery percentage from millivolts using the 3.7V Li-Po discharge curve
 * matching the ESP32-C3 firmware implementation in battery.cpp.
 */
export function calculateBatteryPercentage(millivolts: number): number {
  if (millivolts >= 4150) return 100;
  if (millivolts >= 4050) return 90;
  if (millivolts >= 3950) return 80;
  if (millivolts >= 3850) return 65;
  if (millivolts >= 3750) return 45;
  if (millivolts >= 3650) return 20;
  if (millivolts >= 3550) return 10;
  if (millivolts >= 3400) return 5;
  return 0;
}

/**
 * Determines charging state with hysteresis to avoid oscillation near threshold.
 */
export function isChargingDetected(vbusMillivolts: number, currentlyCharging: boolean): boolean {
  const CHARGE_ON_THRESHOLD = 4000;
  const CHARGE_OFF_THRESHOLD = 3600;

  if (currentlyCharging) {
    return vbusMillivolts >= CHARGE_OFF_THRESHOLD;
  } else {
    return vbusMillivolts >= CHARGE_ON_THRESHOLD;
  }
}

/**
 * Converts 24-bit RGB (r: 0..255, g: 0..255, b: 0..255) to 16-bit RGB565 big-endian format.
 */
export function rgbToRgb565(r: number, g: number, b: number): { highByte: number; lowByte: number; value: number } {
  const r5 = (r >> 3) & 0x1f;
  const g6 = (g >> 2) & 0x3f;
  const b5 = (b >> 3) & 0x1f;

  const rgb16 = (r5 << 11) | (g6 << 5) | b5;
  return {
    value: rgb16,
    highByte: (rgb16 >> 8) & 0xff,
    lowByte: rgb16 & 0xff,
  };
}

/**
 * FSM Button action interpreter based on press duration in milliseconds.
 */
export type ButtonAction = 'NONE' | 'SHORT_CLICK' | 'LONG_PRESS' | 'DEEP_SLEEP';

export function evaluateButtonPress(durationMs: number): ButtonAction {
  const DEBOUNCE_MS = 30;
  const SHORT_PRESS_MS = 500;
  const LONG_PRESS_MS = 2500;
  const DEEP_SLEEP_MS = 5000;

  if (durationMs < DEBOUNCE_MS) {
    return 'NONE';
  }
  if (durationMs < SHORT_PRESS_MS) {
    return 'SHORT_CLICK';
  }
  if (durationMs >= DEEP_SLEEP_MS) {
    return 'DEEP_SLEEP';
  }
  if (durationMs >= LONG_PRESS_MS) {
    return 'LONG_PRESS';
  }
  return 'NONE';
}

/**
 * Cycles slot index: 1 -> 2 -> 3 -> 1
 */
export function getNextSlot(currentSlot: number, totalSlots: number = 3): number {
  if (currentSlot < 1 || currentSlot > totalSlots) return 1;
  return (currentSlot % totalSlots) + 1;
}

/**
 * Validates slot number for API endpoints
 */
export function isValidSlot(slot: number, totalSlots: number = 3): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= totalSlots;
}
