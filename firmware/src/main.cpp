/**
 * ============================================================================
 * WIRED_KEYCHAIN // V.02 — PRODUCTION-GRADE FIRMWARE MAIN ENTRY
 * Target: ESP32-C3 SuperMini (RISC-V, 4MB Flash, No external PSRAM)
 * Architecture: Clean Procedural FSM, Modular Drivers, Zero Heap Churn
 * ============================================================================
 */

#include <Arduino.h>
#include <LittleFS.h>
#include <esp_sleep.h>

#include "config.h"
#include "battery.h"
#include "display_player.h"
#include "web_portal.h"

// ============================================================================
// SYSTEM FSM STATES
// ============================================================================
enum SystemState {
    STATE_PLAYBACK,
    STATE_PORTAL,
    STATE_CHARGING_SLEEP
};

static SystemState s_state           = STATE_PLAYBACK;
static uint8_t     s_active_slot     = 1;
static QrViewMode  s_qr_mode         = QR_MODE_WIFI;
static uint32_t    s_portal_start_ms = 0;

// Button non-blocking debouncer state
static uint32_t s_btn_press_ms   = 0;
static bool     s_btn_is_pressed = false;
static bool     s_btn_ignore_rel = false;

// ============================================================================
// POWER ACTIONS & DEEP SLEEP
// ============================================================================

static void enter_deep_sleep(void) {
    Serial.println(F("[SYSTEM] Entering Low-Power Sleep. Wakeable via PIN_BUTTON (GPIO 10)..."));
    display_sleep();
    web_portal_stop();

    // NOTE: On ESP32-C3, only GPIO 0..5 are in the RTC domain for Deep Sleep.
    // GPIO 10 is in VDD3P3_CPU domain, so standard Deep Sleep would permanently freeze the device.
    // We use Light Sleep (~130uA draw), which reliably wakes up on GPIO 10 falling edge.
    gpio_wakeup_enable((gpio_num_t)PIN_BUTTON, GPIO_INTR_LOW_LEVEL);
    esp_sleep_enable_gpio_wakeup();
    esp_light_sleep_start();

    // Resumed from sleep: wait for button release
    while (digitalRead(PIN_BUTTON) == LOW) {
        delay(20);
    }
    delay(50);
    display_wake();
    set_state_playback();
}

// ============================================================================
// FSM TRANSITIONS
// ============================================================================

static void set_state_playback(void) {
    s_state = STATE_PLAYBACK;
    web_portal_stop();
    display_set_backlight(BACKLIGHT_DUTY_PLAYBACK);
    display_open_slot(s_active_slot);
    Serial.printf("[FSM] -> STATE_PLAYBACK (Slot %u, CPU 80MHz, WiFi OFF)\n", s_active_slot);
}

static void set_state_portal(void) {
    s_state = STATE_PORTAL;
    s_portal_start_ms = millis();
    s_qr_mode = QR_MODE_WIFI;

    web_portal_start(&s_active_slot);
    display_show_qr(s_qr_mode);
    Serial.println(F("[FSM] -> STATE_PORTAL (CPU 160MHz, SoftAP Live)"));
}

static void set_state_charging_sleep(void) {
    s_state = STATE_CHARGING_SLEEP;
    web_portal_stop();
    display_sleep();
    Serial.println(F("[FSM] -> STATE_CHARGING_SLEEP (USB connected, Display OFF)"));
}

// ============================================================================
// NON-BLOCKING BUTTON ENGINE
// ============================================================================

static void button_update(void) {
    bool raw_pressed = (digitalRead(PIN_BUTTON) == LOW);
    uint32_t now = millis();

    if (raw_pressed && !s_btn_is_pressed) {
        // Press initiated
        s_btn_is_pressed = true;
        s_btn_press_ms   = now;
        s_btn_ignore_rel = false;
    } else if (raw_pressed && s_btn_is_pressed) {
        uint32_t duration = now - s_btn_press_ms;

        // Extra-Long Press (> 5.0s): Deep Sleep
        if (duration >= BTN_DEEP_SLEEP_MS && !s_btn_ignore_rel) {
            s_btn_ignore_rel = true;
            enter_deep_sleep();
        }
    } else if (!raw_pressed && s_btn_is_pressed) {
        // Release detected
        uint32_t duration = now - s_btn_press_ms;
        s_btn_is_pressed  = false;

        if (s_btn_ignore_rel) {
            return;
        }

        if (duration >= BTN_DEBOUNCE_MS && duration < BTN_SHORT_PRESS_MS) {
            // SHORT CLICK (< 0.5s)
            if (s_state == STATE_PLAYBACK) {
                // Cycle active playback slot: 1 -> 2 -> 3 -> 1
                s_active_slot = (s_active_slot % TOTAL_SLOTS) + 1;
                Serial.printf("[BUTTON] Switch slot -> %u\n", s_active_slot);
                display_open_slot(s_active_slot);
            } else if (s_state == STATE_PORTAL) {
                // Refresh single unified QR code
                display_show_qr(QR_MODE_WIFI);
            }
        } else if (duration >= BTN_LONG_PRESS_MS && duration < BTN_DEEP_SLEEP_MS) {
            // LONG PRESS (2.5s - 5.0s)
            if (s_state == STATE_PLAYBACK) {
                set_state_portal();
            } else if (s_state == STATE_PORTAL) {
                set_state_playback();
            }
        }
    }
}

// ============================================================================
// ARDUINO SETUP & LOOP
// ============================================================================

void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println(F("\n============================================="));
    Serial.println(F("WIRED_KEYCHAIN // ESP32-C3 SUPERMINI (MODULAR)"));
    Serial.println(F("============================================="));

    // 1. Initialize Inputs & Telemetry
    pinMode(PIN_BUTTON, INPUT_PULLUP);
    battery_init();

    // 2. Initialize ST7789 Display & LEDC Backlight
    display_init();

    // 3. Mount LittleFS Flash Filesystem
    if (!LittleFS.begin(true)) {
        Serial.println(F("[FS] LittleFS Mount Failed! Formatted new partition."));
    } else {
        Serial.printf("[FS] LittleFS Mounted: %u / %u KB used\n",
            (unsigned int)(LittleFS.usedBytes() / 1024),
            (unsigned int)(LittleFS.totalBytes() / 1024)
        );
    }

    // 4. Determine Initial Boot State
    if (battery_is_charging()) {
        set_state_charging_sleep();
    } else {
        set_state_playback();
    }
}

void loop() {
    uint32_t now = millis();

    // --- 1. USB VBUS CHARGING DETECTION (Polled every 500ms to eliminate ADC lag during playback) ---
    static uint32_t s_last_charge_check_ms = 0;
    if (now - s_last_charge_check_ms >= 500) {
        s_last_charge_check_ms = now;
        bool is_charging = battery_is_charging();
        if (s_state != STATE_CHARGING_SLEEP && is_charging) {
            set_state_charging_sleep();
        } else if (s_state == STATE_CHARGING_SLEEP && !is_charging) {
            display_wake();
            set_state_playback();
        }
    }

    // --- 2. TACTILE BUTTON DEBOUNCER ---
    button_update();

    // --- 3. DETERMINISTIC FSM EXECUTION ---
    switch (s_state) {
        case STATE_PLAYBACK: {
            display_update_playback();
            break;
        }

        case STATE_PORTAL: {
            web_portal_update();

            // Auto-timeout if no Wi-Fi station connects within 5 minutes
            if (!web_portal_has_clients()) {
                if (now - s_portal_start_ms > PORTAL_TIMEOUT_MS) {
                    Serial.println(F("[PORTAL] Auto-timeout elapsed. Exiting portal."));
                    set_state_playback();
                }
            } else {
                s_portal_start_ms = now; // Refresh timer while client is connected
            }
            break;
        }

        case STATE_CHARGING_SLEEP: {
            // Low-power sleep polling delay
            delay(150);
            break;
        }
    }
}
