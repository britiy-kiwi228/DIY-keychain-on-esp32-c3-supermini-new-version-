#include "display_player.h"
#include "config.h"
#include "battery.h"

#include <LittleFS.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <AnimatedGIF.h>
#include <qrcode.h>
#include <driver/ledc.h>

// Internal display & GIF decoder instances
static TFT_eSPI    s_tft = TFT_eSPI();
static AnimatedGIF s_gif;
static File        s_gifFile;

// Single line render buffer: 240 pixels * 2 bytes = 480 bytes RAM budget
static uint16_t s_lineBuffer[240];

static bool     s_is_gif_open = false;
static uint32_t s_next_frame_ms = 0;
static uint8_t  s_current_slot = 1;

// ============================================================================
// ANIMATEDGIF LITTLEFS FILE CALLBACKS
// ============================================================================

static void* GIF_open(const char *filename, int32_t *pFileSize) {
    s_gifFile = LittleFS.open(filename, "r");
    if (!s_gifFile || s_gifFile.isDirectory()) {
        return NULL;
    }
    *pFileSize = s_gifFile.size();
    return (void*)&s_gifFile;
}

static void GIF_close(void *pHandle) {
    File *f = (File*)pHandle;
    if (f && *f) {
        f->close();
    }
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

/**
 * Line draw callback: reads palette indices, builds single scanline in s_lineBuffer,
 * and pushes directly to ST7789 display window via SPI.
 */
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
    if (x + width > 240) {
        width = 240 - x;
    }
    if (width <= 0) return;

    if (pDraw->ucHasTransparency) {
        uint8_t ucTransparent = pDraw->ucTransparent;
        for (int i = 0; i < width; i++) {
            uint8_t c = *s++;
            if (c != ucTransparent) {
                s_lineBuffer[i] = pal[c];
            } else {
                s_lineBuffer[i] = 0x0000; // Black background for transparent pixels
            }
        }
    } else {
        for (int i = 0; i < width; i++) {
            s_lineBuffer[i] = pal[*s++];
        }
    }

    s_tft.startWrite();
    s_tft.setAddrWindow(x, y, width, 1);
    s_tft.pushColors(s_lineBuffer, width, false);
    s_tft.endWrite();
}

// ============================================================================
// HARDWARE INITIALIZATION & POWER MANAGEMENT
// ============================================================================

void display_init(void) {
    // 1. Initialize Backlight PWM (LEDC)
    ledcSetup(BACKLIGHT_LEDC_CH, BACKLIGHT_LEDC_FREQ, BACKLIGHT_LEDC_RES);
    ledcAttachPin(TFT_BLK, BACKLIGHT_LEDC_CH);
    display_set_backlight(BACKLIGHT_DUTY_OFF);

    // 2. Initialize ST7789 SPI Display
    s_tft.init();
    s_tft.setRotation(0);
    s_tft.fillScreen(TFT_BLACK);

    display_wake();
}

void display_set_backlight(uint8_t duty) {
    ledcWrite(BACKLIGHT_LEDC_CH, duty); // Должен быть КАНАЛ (BACKLIGHT_LEDC_CH), а не пин!
}

void display_sleep(void) {
    display_set_backlight(BACKLIGHT_DUTY_OFF);
    s_tft.writecommand(0x10); // ST7789 command: SLPIN
    delay(10);
}

void display_wake(void) {
    s_tft.writecommand(0x11); // ST7789 command: SLPOUT
    delay(120);
    display_set_backlight(BACKLIGHT_DUTY_PLAYBACK);
}

// ============================================================================
// GIF PLAYBACK FUNCTIONS
// ============================================================================

void display_show_placeholder(uint8_t slot) {
    s_tft.fillScreen(TFT_BLACK);
    s_tft.drawCircle(120, 120, 110, TFT_DARKGREY);
    s_tft.drawCircle(120, 120, 112, TFT_NAVY);

    s_tft.setTextDatum(MC_DATUM);
    s_tft.setTextColor(TFT_CYAN, TFT_BLACK);

    char buf[32];
    snprintf(buf, sizeof(buf), "SLOT 0%d EMPTY", slot);
    s_tft.drawString(buf, 120, 95, 4);

    s_tft.setTextColor(TFT_WHITE, TFT_BLACK);
    s_tft.drawString("HOLD BUTTON 3s", 120, 130, 2);
    s_tft.drawString("FOR WEB PORTAL", 120, 150, 2);

    uint16_t mv = battery_get_mv();
    uint8_t  pct = battery_get_percentage();
    snprintf(buf, sizeof(buf), "BAT: %d.%02dV (%d%%)", mv / 1000, (mv % 1000) / 10, pct);
    s_tft.setTextColor(TFT_GREEN, TFT_BLACK);
    s_tft.drawString(buf, 120, 185, 2);
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
        } else {
            Serial.printf("[DISPLAY] Failed to decode GIF: %s\n", pathGif);
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
}

void display_update_playback(void) {
    if (!s_is_gif_open) return;

    uint32_t now = millis();
    if (now >= s_next_frame_ms) {
        int frame_delay_ms = 0;
        int res = s_gif.playFrame(true, &frame_delay_ms);

        if (res == 1) {
            s_next_frame_ms = now + frame_delay_ms;
        } else if (res == 0) {
            // Loop reached end: rewind to start
            s_gif.reset();
            s_next_frame_ms = now;
        } else {
            // Error occurred
            s_gif.close();
            s_is_gif_open = false;
            display_show_placeholder(s_current_slot);
        }
    }
}

// ============================================================================
// QR CODE RENDERING (DUAL QR CAPTIVE VIEWS)
// ============================================================================

static void render_qr_canvas(const char *payload, const char *title, const char *subtitle) {
    s_tft.fillScreen(TFT_BLACK);

    QRCode qrcode;
    uint8_t qrcodeData[qrcode_getBufferSize(3)];
    // Version 3 (29x29 modules), ECC Level Low
    qrcode_initText(&qrcode, qrcodeData, 3, 0, payload);

    const int scale = 4; // 29 * 4 = 116px (fits centered in 240x240 screen)
    const int qrSize = qrcode.size * scale;
    const int startX = (240 - qrSize) / 2;
    const int startY = (240 - qrSize) / 2 - 4;

    // White quiet border
    s_tft.fillRect(startX - 6, startY - 6, qrSize + 12, qrSize + 12, TFT_WHITE);

    // Draw QR pixels
    for (uint8_t y = 0; y < qrcode.size; y++) {
        for (uint8_t x = 0; x < qrcode.size; x++) {
            if (qrcode_getModule(&qrcode, x, y)) {
                s_tft.fillRect(startX + (x * scale), startY + (y * scale), scale, scale, TFT_BLACK);
            }
        }
    }

    // Header label
    s_tft.setTextDatum(TC_DATUM);
    s_tft.setTextColor(TFT_CYAN, TFT_BLACK);
    s_tft.drawString(title, 120, 16, 2);

    // Footer label
    s_tft.setTextColor(TFT_WHITE, TFT_BLACK);
    s_tft.drawString(subtitle, 120, 204, 2);

    // Navigation sub-caption
    s_tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
    s_tft.drawString("[HOLD: EXIT TO GIF]", 120, 222, 1);
}

void display_show_qr(QrViewMode mode) {
    (void)mode;
    if (s_is_gif_open) {
        s_gif.close();
        s_is_gif_open = false;
    }

    display_set_backlight(BACKLIGHT_DUTY_PORTAL);

    // Single unified QR: Phone scans, connects to Wi-Fi, and Captive Portal pops up web interface automatically!
    const char *wifiPayload = "WIFI:S:" AP_SSID ";T:WPA;P:" AP_PASS ";;";
    render_qr_canvas(wifiPayload, "WIRED KEYCHAIN", "192.168.4.1 AUTO-PORTAL");
}
