#pragma once
#include <Arduino.h>

/**
 * ============================================================================
 * WIRED_KEYCHAIN // V.02 — HARDWARE CONFIGURATION & CONSTANTS
 * Target: ESP32-C3 SuperMini (RISC-V) + 1.3"/1.28" IPS ST7789 240x240
 * ============================================================================
 */

// --- 1. DISPLAY HARDWARE SPI PINOUT ---
#define TFT_SCLK          4   // SPI Clock (SCK)
#define TFT_MOSI          6   // SPI MOSI / SDA
#define TFT_CS            7   // SPI Chip Select (CS)
#define TFT_DC            5   // Data / Command (DC)
#define TFT_RST           3   // Hardware Reset (RES)
#define TFT_BLK           2   // Backlight LED (LEDC PWM)

// --- 2. INPUTS & TELEMETRY PINOUT ---
#define PIN_BUTTON        10  // Tactile push button to GND (INPUT_PULLUP)
#define PIN_BAT_ADC       0   // ADC1_CH0 (Battery voltage divider 100k / 100k)
#define PIN_VBUS_SENSE    1   // ADC1_CH1 / Digital IN (USB 5V sense divider 100k / 100k)

// --- 3. HARDWARE PWM BACKLIGHT (LEDC) ---
#define BACKLIGHT_LEDC_CH       0
#define BACKLIGHT_LEDC_FREQ     5000  // 5 kHz frequency prevents audible coil whine
#define BACKLIGHT_LEDC_RES      8     // 8-bit resolution (0..255)
#define BACKLIGHT_DUTY_PLAYBACK 102   // 40% duty cycle (~102/255)
#define BACKLIGHT_DUTY_PORTAL   200   // ~78% duty cycle for crisp QR camera scanning
#define BACKLIGHT_DUTY_OFF      0     // 0% (off)

// --- 4. WI-FI & CAPTIVE PORTAL CONSTANTS ---
#define AP_SSID           "WIRED_KEYCHAIN"
#define AP_PASS           "love_keychain"
#define AP_IP_STR         "192.168.4.1"
#define DNS_PORT          53
#define HTTP_PORT         80
#define PORTAL_TIMEOUT_MS 300000UL    // 5 minutes auto-timeout if no client connects

// --- 5. TIMING CONSTANTS & THRESHOLDS ---
#define BTN_DEBOUNCE_MS       30UL    // Button contact debounce threshold
#define BTN_SHORT_PRESS_MS    500UL   // Short click (< 500ms)
#define BTN_LONG_PRESS_MS     2500UL  // Long press (2.5s) to enter/exit Portal mode
#define BTN_DEEP_SLEEP_MS     5000UL  // Extra-long press (> 5.0s) to enter Deep Sleep

#define CHARGE_VBUS_THRESHOLD_MV 3800 // Threshold to detect 5V USB connection via divider

// --- 6. STORAGE & SLOTS ---
#define TOTAL_SLOTS       3
