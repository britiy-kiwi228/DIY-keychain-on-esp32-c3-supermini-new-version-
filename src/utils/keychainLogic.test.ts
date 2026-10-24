/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBatteryPercentage,
  isChargingDetected,
  rgbToRgb565,
  evaluateButtonPress,
  getNextSlot,
  isValidSlot,
} from './keychainLogic.ts';

test('calculateBatteryPercentage accurately maps 3.7V Li-Po curve', () => {
  assert.equal(calculateBatteryPercentage(4200), 100);
  assert.equal(calculateBatteryPercentage(4150), 100);
  assert.equal(calculateBatteryPercentage(4080), 90);
  assert.equal(calculateBatteryPercentage(3950), 80);
  assert.equal(calculateBatteryPercentage(3850), 65);
  assert.equal(calculateBatteryPercentage(3750), 45);
  assert.equal(calculateBatteryPercentage(3650), 20);
  assert.equal(calculateBatteryPercentage(3550), 10);
  assert.equal(calculateBatteryPercentage(3420), 5);
  assert.equal(calculateBatteryPercentage(3300), 0);
});

test('isChargingDetected handles hysteresis thresholds', () => {
  // Not charging -> needs >= 4000mV to turn ON
  assert.equal(isChargingDetected(3900, false), false);
  assert.equal(isChargingDetected(4050, false), true);

  // Already charging -> stays ON until < 3600mV
  assert.equal(isChargingDetected(3800, true), true);
  assert.equal(isChargingDetected(3550, true), false);
});

test('rgbToRgb565 correctly encodes primary colors', () => {
  // Pure Black
  const black = rgbToRgb565(0, 0, 0);
  assert.equal(black.value, 0x0000);
  assert.equal(black.highByte, 0x00);
  assert.equal(black.lowByte, 0x00);

  // Pure White
  const white = rgbToRgb565(255, 255, 255);
  assert.equal(white.value, 0xffff);
  assert.equal(white.highByte, 0xff);
  assert.equal(white.lowByte, 0xff);

  // Pure Red: 0xF800
  const red = rgbToRgb565(255, 0, 0);
  assert.equal(red.value, 0xf800);

  // Pure Green: 0x07E0
  const green = rgbToRgb565(0, 255, 0);
  assert.equal(green.value, 0x07e0);

  // Pure Blue: 0x001F
  const blue = rgbToRgb565(0, 0, 255);
  assert.equal(blue.value, 0x001f);
});

test('evaluateButtonPress distinguishes short click, long press, and sleep', () => {
  // Noise under 30ms -> ignored
  assert.equal(evaluateButtonPress(15), 'NONE');

  // Short press: 30ms to 500ms
  assert.equal(evaluateButtonPress(120), 'SHORT_CLICK');
  assert.equal(evaluateButtonPress(450), 'SHORT_CLICK');

  // Mid duration: 500ms - 2500ms (held down, waiting)
  assert.equal(evaluateButtonPress(1200), 'NONE');

  // Long press: 2500ms - 5000ms
  assert.equal(evaluateButtonPress(2600), 'LONG_PRESS');
  assert.equal(evaluateButtonPress(4800), 'LONG_PRESS');

  // Deep sleep threshold: >= 5000ms
  assert.equal(evaluateButtonPress(5000), 'DEEP_SLEEP');
  assert.equal(evaluateButtonPress(6500), 'DEEP_SLEEP');
});

test('getNextSlot cycles properly across 3 slots', () => {
  assert.equal(getNextSlot(1), 2);
  assert.equal(getNextSlot(2), 3);
  assert.equal(getNextSlot(3), 1);
  assert.equal(getNextSlot(99), 1); // fallback
});

test('isValidSlot enforces bounds check', () => {
  assert.equal(isValidSlot(1), true);
  assert.equal(isValidSlot(2), true);
  assert.equal(isValidSlot(3), true);
  assert.equal(isValidSlot(0), false);
  assert.equal(isValidSlot(4), false);
  assert.equal(isValidSlot(-1), false);
  assert.equal(isValidSlot(1.5), false);
});
