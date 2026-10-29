#pragma once
#include <Arduino.h>

/**
 * ============================================================================
 * DISPLAY & STREAMING GIF PLAYER MODULE
 * Controls ST7789 240x240, LEDC PWM backlight, QR rendering & line-by-line GIF.
 * ============================================================================
 */

enum QrViewMode {
    QR_MODE_WIFI = 0,
    QR_MODE_URL  = 1
};

void display_init(void);
void display_set_backlight(uint8_t duty);
void display_sleep(void);
void display_wake(void);

// Playback routines
void display_open_slot(uint8_t slot);
void display_update_playback(void);
void display_show_placeholder(uint8_t slot);

// QR Portal routines
void display_show_qr(QrViewMode mode);

void display_show_system_info(void);
