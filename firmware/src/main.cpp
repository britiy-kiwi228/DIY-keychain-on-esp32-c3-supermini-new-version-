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
static void set_state_playback();
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
    Serial.println(F("[SYSTEM] Entering Low-Power Sleep..."));
    display_sleep();
    web_portal_stop();

    // Ждем, пока пользователь уберет палец с кнопки!
    while (digitalRead(PIN_BUTTON) == LOW) {
        delay(20);
    }
    delay(100);

    gpio_wakeup_enable((gpio_num_t)PIN_BUTTON, GPIO_INTR_LOW_LEVEL);
    esp_sleep_enable_gpio_wakeup();
    esp_light_sleep_start();

    // Проснулись: ждем пока отпустишь кнопку
    while (digitalRead(PIN_BUTTON) == LOW) {
        delay(20);
    }
    delay(100);

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

static uint8_t s_brightness_level = 0; // 0=40%, 1=75%, 2=100%

static void cycle_brightness(void) {
    s_brightness_level = (s_brightness_level + 1) % 3;
    uint8_t duty = BACKLIGHT_DUTY_PLAYBACK; // 102 (40%)
    if (s_brightness_level == 1) duty = 190; // ~75%
    else if (s_brightness_level == 2) duty = 255; // 100%
    display_set_backlight(duty);
    Serial.printf("[BRIGHTNESS] Set to level %u (PWM %u)\n", s_brightness_level, duty);
}

static void button_update(void) {
    bool raw_pressed = (digitalRead(PIN_BUTTON) == LOW);
    uint32_t now = millis();
    static uint32_t s_last_release_ms = 0;
    static uint8_t  s_pending_clicks = 0;

    if (raw_pressed && !s_btn_is_pressed) {
        s_btn_is_pressed = true;
        s_btn_press_ms   = now;
        s_btn_ignore_rel = false;
    } 
    else if (raw_pressed && s_btn_is_pressed) {
        uint32_t duration = now - s_btn_press_ms;
        if (duration >= BTN_DEEP_SLEEP_MS && !s_btn_ignore_rel) {
            s_btn_ignore_rel = true;
            s_pending_clicks = 0;
            enter_deep_sleep();
        }
    } 
    else if (!raw_pressed && s_btn_is_pressed) {
        uint32_t duration = now - s_btn_press_ms;
        s_btn_is_pressed  = false;

        if (s_btn_ignore_rel) return;

        // Короткий клик
        if (duration >= BTN_DEBOUNCE_MS && duration < BTN_LONG_PRESS_MS) {
            if (s_state == STATE_PLAYBACK) {
                s_pending_clicks++;
                s_last_release_ms = now;
            } else if (s_state == STATE_PORTAL) {
                s_qr_mode = (s_qr_mode == QR_MODE_WIFI) ? QR_MODE_URL : QR_MODE_WIFI;
                display_show_qr(s_qr_mode);
            }
        } 
        // Долгое нажатие (3 сек)
        else if (duration >= BTN_LONG_PRESS_MS && duration < BTN_DEEP_SLEEP_MS) {
            s_pending_clicks = 0;
            if (s_state == STATE_PLAYBACK) set_state_portal();
            else if (s_state == STATE_PORTAL) set_state_playback();
        }
    }

    // Обработка одиночного и двойного клика в режиме воспроизведения
    if (s_pending_clicks > 0 && (now - s_last_release_ms > 300)) {
        if (s_pending_clicks == 1) {
            // Одиночный клик: переключаем слот (1 -> 2 -> 3 -> 4)
            s_active_slot = (s_active_slot % TOTAL_SLOTS) + 1;
            Serial.printf("[BUTTON] Switch slot -> %u\n", s_active_slot);
            display_open_slot(s_active_slot);
        } else if (s_pending_clicks >= 2) {
            // Двойной клик: меняем яркость!
            cycle_brightness();
        }
        s_pending_clicks = 0;
    }
}

// ============================================================================
// ARDUINO SETUP & LOOP
// ============================================================================

void setup() {
    Serial.begin(115200);
    Serial.setTxTimeoutMs(0); // КРИТИЧНО: чтобы плата не висла без открытого монитора порта
    delay(700);
    Serial.println(F("\n============================================="));
    Serial.println(F("WIRED_KEYCHAIN // ESP32-C3 SUPERMINI (MODULAR)"));
    Serial.println(F("============================================="));

    // 1. Initialize Inputs & Telemetry
    pinMode(PIN_BUTTON, INPUT_PULLUP);
    battery_init();

    // 2. Initialize ST7789 Display & LEDC Backlight
    display_init();

    // 3. Mount LittleFS Flash Filesystem
    if (!LittleFS.begin(true, "/littlefs", 10, "littlefs")) {
        Serial.println(F("[FS] LittleFS Mount Failed! Formatted new partition."));
    } else {
        Serial.printf("[FS] LittleFS Mounted: %u / %u KB used\n",
            (unsigned int)(LittleFS.usedBytes() / 1024),
            (unsigned int)(LittleFS.totalBytes() / 1024)
        );
    }

    // 4. Determine Initial Boot State
    set_state_playback(); // Принудительно включаем экран
}

void loop() {
    uint32_t now = millis();

    // --- 1. USB VBUS CHARGING DETECTION (Polled every 500ms to eliminate ADC lag during playback) ---
    /* 
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
    */
    /*static uint32_t s_last_heartbeat = 0;
    if (now - s_last_heartbeat >= 1000) {
        s_last_heartbeat = now;
        Serial.printf("[HEARTBEAT] Uptime: %lu sec | State: %d | FreeHeap: %u\n", 
                      now / 1000, (int)s_state, ESP.getFreeHeap());
    }*/


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
