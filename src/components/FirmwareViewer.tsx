/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Code2, Copy, Check, FileText } from 'lucide-react';

interface FileEntry {
  path: string;
  name: string;
  description: string;
  content: string;
}

const FIRMWARE_FILES: FileEntry[] = [
  {
    path: 'firmware/src/config.h',
    name: 'config.h',
    description: 'Hardware GPIO pinout, LEDC backlight constants, captive portal settings',
    content: `#pragma once
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
#define BTN_DEEP_SLEEP_MS     5000UL  // Extra-long press (> 5.0s) to enter Low-power Sleep

#define CHARGE_VBUS_THRESHOLD_MV 3800 // Threshold to detect 5V USB connection via divider

// --- 6. STORAGE & SLOTS ---
#define TOTAL_SLOTS       3`,
  },
  {
    path: 'firmware/src/main.cpp',
    name: 'main.cpp',
    description: 'System FSM (Playback, Portal, Charging Sleep, Low-Power Sleep), button debouncer & loop',
    content: `/**
 * ============================================================================
 * WIRED_KEYCHAIN // V.02 — PRODUCTION-GRADE FIRMWARE MAIN ENTRY
 * Target: ESP32-C3 SuperMini (RISC-V, 4MB Flash, No external PSRAM)
 * Architecture: Clean Procedural FSM, Modular Drivers, Zero Heap Churn
 * ============================================================================
 */

#include <Arduino.h>
#include <LittleFS.h>
#include <esp_sleep.h>
#include <driver/gpio.h>

#include "config.h"
#include "battery.h"
#include "display_player.h"
#include "web_portal.h"

// System FSM States
enum SystemState {
    STATE_PLAYBACK,
    STATE_PORTAL,
    STATE_CHARGING_SLEEP
};

static SystemState s_state           = STATE_PLAYBACK;
static uint8_t     s_active_slot     = 1;
static QrViewMode  s_qr_mode         = QR_MODE_WIFI;
static uint32_t    s_portal_start_ms = 0;

static uint32_t s_btn_press_ms   = 0;
static bool     s_btn_is_pressed = false;
static bool     s_btn_ignore_rel = false;

static void enter_deep_sleep(void) {
    Serial.println(F("[SYSTEM] Entering Low-Power Sleep. Wakeable via PIN_BUTTON (GPIO 10)..."));
    display_sleep();
    web_portal_stop();

    // On ESP32-C3, only GPIO 0..5 are in RTC domain for deep sleep.
    // GPIO 10 uses Light Sleep (~130uA draw), which reliably wakes up on GPIO 10 falling edge.
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

static void set_state_playback(void) {
    s_state = STATE_PLAYBACK;
    web_portal_stop();
    display_set_backlight(BACKLIGHT_DUTY_PLAYBACK);
    display_open_slot(s_active_slot);
    Serial.printf("[FSM] -> STATE_PLAYBACK (Slot %u, CPU 80MHz, WiFi OFF)\\n", s_active_slot);
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

static void button_update(void) {
    bool raw_pressed = (digitalRead(PIN_BUTTON) == LOW);
    uint32_t now = millis();

    if (raw_pressed && !s_btn_is_pressed) {
        s_btn_is_pressed = true;
        s_btn_press_ms   = now;
        s_btn_ignore_rel = false;
    } else if (raw_pressed && s_btn_is_pressed) {
        uint32_t duration = now - s_btn_press_ms;
        if (duration >= BTN_DEEP_SLEEP_MS && !s_btn_ignore_rel) {
            s_btn_ignore_rel = true;
            enter_deep_sleep();
        }
    } else if (!raw_pressed && s_btn_is_pressed) {
        uint32_t duration = now - s_btn_press_ms;
        s_btn_is_pressed  = false;

        if (s_btn_ignore_rel) return;

        if (duration >= BTN_DEBOUNCE_MS && duration < BTN_SHORT_PRESS_MS) {
            if (s_state == STATE_PLAYBACK) {
                s_active_slot = (s_active_slot % TOTAL_SLOTS) + 1;
                Serial.printf("[BUTTON] Switch slot -> %u\\n", s_active_slot);
                display_open_slot(s_active_slot);
            } else if (s_state == STATE_PORTAL) {
                display_show_qr(QR_MODE_WIFI);
            }
        } else if (duration >= BTN_LONG_PRESS_MS && duration < BTN_DEEP_SLEEP_MS) {
            if (s_state == STATE_PLAYBACK) {
                set_state_portal();
            } else if (s_state == STATE_PORTAL) {
                set_state_playback();
            }
        }
    }
}

void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println(F("\\n============================================="));
    Serial.println(F("WIRED_KEYCHAIN // ESP32-C3 SUPERMINI (MODULAR)"));
    Serial.println(F("============================================="));

    pinMode(PIN_BUTTON, INPUT_PULLUP);
    battery_init();
    display_init();

    if (!LittleFS.begin(true)) {
        Serial.println(F("[FS] LittleFS Mount Failed! Formatted new partition."));
    } else {
        Serial.printf("[FS] LittleFS Mounted: %u / %u KB used\\n",
            (unsigned int)(LittleFS.usedBytes() / 1024),
            (unsigned int)(LittleFS.totalBytes() / 1024)
        );
    }

    if (battery_is_charging()) {
        set_state_charging_sleep();
    } else {
        set_state_playback();
    }
}

void loop() {
    uint32_t now = millis();

    // USB VBUS Polled every 500ms to eliminate ADC lag during playback
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

    button_update();

    switch (s_state) {
        case STATE_PLAYBACK: {
            display_update_playback();
            break;
        }
        case STATE_PORTAL: {
            web_portal_update();
            if (!web_portal_has_clients()) {
                if (now - s_portal_start_ms > PORTAL_TIMEOUT_MS) {
                    Serial.println(F("[PORTAL] Auto-timeout elapsed. Exiting portal."));
                    set_state_playback();
                }
            } else {
                s_portal_start_ms = now;
            }
            break;
        }
        case STATE_CHARGING_SLEEP: {
            delay(150);
            break;
        }
    }
}`,
  },
  {
    path: 'firmware/src/web_portal.cpp',
    name: 'web_portal.cpp',
    description: 'Captive AP WebServer, DNS port 53 spoofer, chunked LittleFS file uploader with space checking',
    content: `#include "web_portal.h"
#include "config.h"
#include "battery.h"

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <esp_wifi.h>

static WebServer s_server(HTTP_PORT);
static DNSServer s_dns;
static File      s_uploadFile;
static uint8_t*  s_p_active_slot = nullptr;

static void handle_root() {
    if (LittleFS.exists("/index.html.gz")) {
        File f = LittleFS.open("/index.html.gz", "r");
        s_server.sendHeader("Content-Encoding", "gzip");
        s_server.streamFile(f, "text/html");
        f.close();
        return;
    } else if (LittleFS.exists("/index.html")) {
        File f = LittleFS.open("/index.html", "r");
        s_server.streamFile(f, "text/html");
        f.close();
        return;
    }
    s_server.send(200, "text/html", "<h2>WIRED KEYCHAIN // EMERGENCY UPLOADER</h2>");
}

static void handle_captive_redirect() {
    s_server.sendHeader("Location", "http://" AP_IP_STR "/", true);
    s_server.send(302, "text/plain", "");
}

static void handle_api_status() {
    uint16_t mv = battery_get_mv();
    uint8_t  pct = battery_get_percentage();
    bool     chg = battery_is_charging();
    size_t   freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
    uint8_t  slot = s_p_active_slot ? *s_p_active_slot : 1;

    char json[128];
    snprintf(json, sizeof(json),
        "{\\"vbat_mv\\":%u,\\"percent\\":%u,\\"slot\\":%u,\\"free_bytes\\":%u,\\"charging\\":%s}",
        mv, pct, slot, (unsigned int)freeBytes, chg ? "true" : "false"
    );

    s_server.sendHeader("Access-Control-Allow-Origin", "*");
    s_server.send(200, "application/json", json);
}

static void handle_api_select() {
    if (s_server.hasArg("slot") && s_p_active_slot) {
        uint8_t target = (uint8_t)s_server.arg("slot").toInt();
        if (target >= 1 && target <= TOTAL_SLOTS) {
            *s_p_active_slot = target;
            s_server.send(200, "application/json", "{\\"status\\":\\"ok\\"}");
            return;
        }
    }
    s_server.send(400, "application/json", "{\\"error\\":\\"invalid_slot\\"}");
}

static void handle_api_delete() {
    if (s_server.hasArg("slot")) {
        uint8_t s = (uint8_t)s_server.arg("slot").toInt();
        if (s >= 1 && s <= TOTAL_SLOTS) {
            char pathGif[16];
            char pathBin[16];
            snprintf(pathGif, sizeof(pathGif), "/slot%d.gif", s);
            snprintf(pathBin, sizeof(pathBin), "/slot%d.bin", s);
            bool removed = false;
            if (LittleFS.exists(pathGif)) {
                LittleFS.remove(pathGif);
                removed = true;
            }
            if (LittleFS.exists(pathBin)) {
                LittleFS.remove(pathBin);
                removed = true;
            }
            if (removed) {
                s_server.send(200, "application/json", "{\\"status\\":\\"deleted\\"}");
                return;
            }
        }
    }
    s_server.send(404, "application/json", "{\\"error\\":\\"not_found\\"}");
}

static void handle_file_upload() {
    HTTPUpload& upload = s_server.upload();

    if (upload.status == UPLOAD_FILE_START) {
        uint8_t targetSlot = 1;
        if (s_server.hasArg("slot")) {
            targetSlot = (uint8_t)s_server.arg("slot").toInt();
            if (targetSlot < 1 || targetSlot > TOTAL_SLOTS) targetSlot = 1;
        }

        bool isBin = upload.filename.endsWith(".bin");
        char path[16];
        snprintf(path, sizeof(path), isBin ? "/slot%d.bin" : "/slot%d.gif", targetSlot);
        Serial.printf("[WEB] Upload start: %s\\n", path);

        char altPath[16];
        snprintf(altPath, sizeof(altPath), isBin ? "/slot%d.gif" : "/slot%d.bin", targetSlot);
        if (LittleFS.exists(altPath)) LittleFS.remove(altPath);
        if (LittleFS.exists(path)) LittleFS.remove(path);

        s_uploadFile = LittleFS.open(path, "w");
    } else if (upload.status == UPLOAD_FILE_WRITE) {
        if (s_uploadFile) {
            size_t freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
            if (freeBytes < upload.currentSize + 2048) {
                Serial.println(F("[WEB] Error: LittleFS partition full!"));
                s_uploadFile.close();
            } else {
                s_uploadFile.write(upload.buf, upload.currentSize);
            }
        }
    } else if (upload.status == UPLOAD_FILE_END) {
        if (s_uploadFile) {
            s_uploadFile.close();
            Serial.printf("[WEB] Upload complete: %u bytes\\n", upload.totalSize);
        }
    } else if (upload.status == UPLOAD_FILE_ABORTED) {
        if (s_uploadFile) {
            s_uploadFile.close();
            Serial.println(F("[WEB] Upload aborted by client. Cleaned up handle."));
        }
    }
}

void web_portal_start(uint8_t *p_active_slot) {
    s_p_active_slot = p_active_slot;
    setCpuFrequencyMhz(160);

    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    delay(20);

    s_dns.setErrorReplyCode(DNSReplyCode::NoError);
    s_dns.start(DNS_PORT, "*", WiFi.softAPIP());

    s_server.on("/", HTTP_GET, handle_root);
    s_server.on("/hotspot-detect.html", HTTP_GET, handle_captive_redirect);
    s_server.on("/generate_204", HTTP_GET, handle_captive_redirect);
    s_server.on("/canonical.html", HTTP_GET, handle_captive_redirect);

    s_server.on("/api/status", HTTP_GET, handle_api_status);
    s_server.on("/api/select", HTTP_POST, handle_api_select);
    s_server.on("/api/delete", HTTP_POST, handle_api_delete);
    s_server.on("/api/upload", HTTP_POST, []() {
        s_server.sendHeader("Access-Control-Allow-Origin", "*");
        s_server.send(200, "application/json", "{\\"status\\":\\"success\\"}");
    }, handle_file_upload);

    s_server.begin();
    Serial.printf("[WEB] Portal live: SSID=%s, IP=%s\\n", AP_SSID, WiFi.softAPIP().toString().c_str());
}

void web_portal_stop(void) {
    s_dns.stop();
    s_server.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    esp_wifi_stop();
    setCpuFrequencyMhz(80);
    Serial.println(F("[WEB] Portal shut down. Wi-Fi powered OFF."));
}

void web_portal_update(void) {
    s_dns.processNextRequest();
    s_server.handleClient();
}

bool web_portal_has_clients(void) {
    return (WiFi.softAPgetStationNum() > 0);
}`,
  },
  {
    path: 'firmware/src/display_player.cpp',
    name: 'display_player.cpp',
    description: 'Line-by-line streaming GIF decoder, raw RGB565 binary player & QR code renderer',
    content: `#include "display_player.h"
#include "config.h"
#include "battery.h"

#include <LittleFS.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <AnimatedGIF.h>
#include <qrcode.h>
#include <driver/ledc.h>

static TFT_eSPI    s_tft = TFT_eSPI();
static AnimatedGIF s_gif;
static File        s_gifFile;
static uint16_t    s_lineBuffer[240];
static bool        s_is_gif_open = false;
static uint32_t    s_next_frame_ms = 0;
static uint8_t     s_current_slot = 1;

static void* GIF_open(const char *filename, int32_t *pFileSize) {
    s_gifFile = LittleFS.open(filename, "r");
    if (!s_gifFile || s_gifFile.isDirectory()) return NULL;
    *pFileSize = s_gifFile.size();
    return (void*)&s_gifFile;
}

static void GIF_close(void *pHandle) {
    File *f = (File*)pHandle;
    if (f && *f) f->close();
}

static int32_t GIF_read(GIFFILE *pFile, uint8_t *pBuf, int32_t iLen) {
    File *f = (File*)pFile->fHandle;
    if (!f || !(*f)) return 0;
    return f->read(pBuf, iLen);
}

static int32_t GIF_seek(GIFFILE *pFile, int32_t iPosition) {
    File *f = (File*)pFile->fHandle;
    if (!f || !(*f)) return 0;
    f->seek(iPosition, SeekSet);
    return f->position();
}

static void GIF_draw(GIFDRAW *pDraw) {
    uint8_t *s = pDraw->pPixels;
    uint16_t *pal = pDraw->pPalette;
    int width = pDraw->iWidth;
    int y = pDraw->iY + pDraw->y;
    int x = pDraw->iX;

    if (y < 0 || y >= 240) return;
    if (x < 0) {
        s += -x;
        width += x;
        x = 0;
    }
    if (x + width > 240) width = 240 - x;
    if (width <= 0) return;

    if (pDraw->ucHasTransparency) {
        uint8_t ucTransparent = pDraw->ucTransparent;
        for (int i = 0; i < width; i++) {
            uint8_t c = *s++;
            s_lineBuffer[i] = (c != ucTransparent) ? pal[c] : 0x0000;
        }
    } else {
        for (int i = 0; i < width; i++) s_lineBuffer[i] = pal[*s++];
    }

    s_tft.startWrite();
    s_tft.setAddrWindow(x, y, width, 1);
    s_tft.pushColors(s_lineBuffer, width, false);
    s_tft.endWrite();
}

void display_init(void) {
    ledcSetup(BACKLIGHT_LEDC_CH, BACKLIGHT_LEDC_FREQ, BACKLIGHT_LEDC_RES);
    ledcAttachPin(TFT_BLK, BACKLIGHT_LEDC_CH);
    display_set_backlight(BACKLIGHT_DUTY_OFF);

    s_tft.init();
    s_tft.setRotation(0);
    s_tft.fillScreen(TFT_BLACK);
    display_wake();
}

void display_set_backlight(uint8_t duty) {
    ledcWrite(BACKLIGHT_LEDC_CH, duty);
}

void display_sleep(void) {
    display_set_backlight(BACKLIGHT_DUTY_OFF);
    s_tft.writecommand(0x10);
    delay(10);
}

void display_wake(void) {
    s_tft.writecommand(0x11);
    delay(120);
    display_set_backlight(BACKLIGHT_DUTY_PLAYBACK);
}

void display_open_slot(uint8_t slot) {
    if (s_is_gif_open) {
        s_gif.close();
        s_is_gif_open = false;
    }

    s_current_slot = slot;
    char pathGif[16];
    char pathBin[16];
    snprintf(pathGif, sizeof(pathGif), "/slot%d.gif", slot);
    snprintf(pathBin, sizeof(pathBin), "/slot%d.bin", slot);

    if (LittleFS.exists(pathGif)) {
        s_tft.fillScreen(TFT_BLACK);
        if (s_gif.open(pathGif, GIF_open, GIF_close, GIF_read, GIF_seek, GIF_draw)) {
            s_is_gif_open = true;
            s_next_frame_ms = millis();
            return;
        }
    } else if (LittleFS.exists(pathBin)) {
        File f = LittleFS.open(pathBin, "r");
        if (f) {
            s_tft.fillScreen(TFT_BLACK);
            s_tft.startWrite();
            s_tft.setAddrWindow(0, 0, 240, 240);
            for (int y = 0; y < 240 && f.available() >= 480; y++) {
                f.read((uint8_t*)s_lineBuffer, 480);
                s_tft.pushColors(s_lineBuffer, 240, false);
            }
            s_tft.endWrite();
            f.close();
            return;
        }
    }
    display_show_placeholder(slot);
}`,
  },
  {
    path: 'firmware/src/battery.cpp',
    name: 'battery.cpp',
    description: 'ADC battery telemetry, EMA noise filtering, Li-Po discharge curve, VBUS sense hysteresis',
    content: `#include "battery.h"
#include "config.h"

static float s_filtered_mv = 3800.0f;
static bool  s_initialized = false;

void battery_init(void) {
    pinMode(PIN_BAT_ADC, INPUT);
    pinMode(PIN_VBUS_SENSE, INPUT);

    uint32_t raw_adc = analogReadMilliVolts(PIN_BAT_ADC);
    s_filtered_mv = (float)(raw_adc * 2);
    s_initialized = true;
}

uint16_t battery_get_mv(void) {
    if (!s_initialized) battery_init();

    uint32_t instant_mv = analogReadMilliVolts(PIN_BAT_ADC) * 2;
    const float alpha = 0.15f;
    s_filtered_mv = (alpha * (float)instant_mv) + ((1.0f - alpha) * s_filtered_mv);
    return (uint16_t)s_filtered_mv;
}

uint8_t battery_get_percentage(void) {
    uint16_t mv = battery_get_mv();
    if (mv >= 4150) return 100;
    if (mv >= 4050) return 90;
    if (mv >= 3950) return 80;
    if (mv >= 3850) return 65;
    if (mv >= 3750) return 45;
    if (mv >= 3650) return 20;
    if (mv >= 3550) return 10;
    if (mv >= 3400) return 5;
    return 0;
}

bool battery_is_charging(void) {
    static bool s_charging_state = false;
    uint32_t vbus_mv = analogReadMilliVolts(PIN_VBUS_SENSE) * 2;
    
    // Hysteresis prevents toggling chatter near 3.8V threshold
    if (s_charging_state) {
        if (vbus_mv < 3600) s_charging_state = false;
    } else {
        if (vbus_mv >= CHARGE_VBUS_THRESHOLD_MV) s_charging_state = true;
    }
    return s_charging_state;
}`,
  },
  {
    path: 'firmware/platformio.ini',
    name: 'platformio.ini',
    description: 'PlatformIO build flags, LittleFS 2.5MB partition table, ST7789 driver config',
    content: `; ==========================================================================
; PlatformIO Project Configuration for ESP32-C3 SuperMini Digital Keychain
; ==========================================================================

[env:esp32-c3-supermini]
platform = espressif32
board = esp32-c3-devkitm-1
framework = arduino

; Target: 160MHz CPU, 80MHz Flash QIO
board_build.mcu = esp32c3
board_build.f_cpu = 160000000L
board_build.f_flash = 80000000L
board_build.flash_mode = qio
board_build.filesystem = littlefs

; Partition Table: 4MB Flash (1.3MB App, 2.5MB LittleFS data partition)
board_build.partitions = default_littlefs.csv

monitor_speed = 115200
monitor_filters = esp32_exception_decoder

build_flags = 
    -DARDUINO_USB_CDC_ON_BOOT=1
    -DARDUINO_USB_MODE=1
    -DCORE_DEBUG_LEVEL=0
    
    ; --- TFT_eSPI Configuration for ST7789 240x240 on ESP32-C3 ---
    -DUSER_SETUP_LOADED=1
    -DST7789_DRIVER=1
    -DTFT_WIDTH=240
    -DTFT_HEIGHT=240
    -DTFT_MOSI=6
    -DTFT_SCLK=4
    -DTFT_CS=7
    -DTFT_DC=5
    -DTFT_RST=3
    -DTFT_BL=2
    -DTFT_BACKLIGHT_ON=HIGH
    -DLOAD_GLCD=1
    -DLOAD_FONT2=1
    -DLOAD_FONT4=1
    -DSPI_FREQUENCY=40000000
    -DSPI_READ_FREQUENCY=20000000

lib_deps =
    bodmer/TFT_eSPI@^2.5.43
    bitbankh/AnimatedGIF@^2.1.1
    ricmoo/QRCode@^0.0.1`,
  },
];

export function FirmwareViewer() {
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  const currentFile = FIRMWARE_FILES[selectedFileIdx];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-cyan-400" />
          <h2 className="text-base font-mono font-bold text-white tracking-wide">
            ПРОСМОТР И СКАЧИВАНИЕ ИСХОДНОГО КОДА ПРОШИВКИ (FIRMWARE C++)
          </h2>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-mono transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-cyan-400" />}
          <span>{copied ? 'СКОПИРОВАНО!' : 'КОПИРОВАТЬ ФАЙЛ'}</span>
        </button>
      </div>

      {/* File selector tabs */}
      <div className="flex flex-wrap gap-2 mt-4">
        {FIRMWARE_FILES.map((file, idx) => (
          <button
            key={file.path}
            onClick={() => setSelectedFileIdx(idx)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors ${
              selectedFileIdx === idx
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{file.name}</span>
          </button>
        ))}
      </div>

      {/* Description */}
      <div className="mt-3 text-xs font-mono text-slate-400">
        <span className="text-slate-500">{currentFile.path}</span> — {currentFile.description}
      </div>

      {/* Code container */}
      <div className="mt-3 relative bg-black/90 rounded-lg border border-slate-800 p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-[500px]">
        <pre>
          <code>{currentFile.content}</code>
        </pre>
      </div>
    </div>
  );
}
