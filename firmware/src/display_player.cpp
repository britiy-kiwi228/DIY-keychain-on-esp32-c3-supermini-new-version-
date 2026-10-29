#include "display_player.h"
#include "config.h"
#include "battery.h"

#include <LittleFS.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <AnimatedGIF.h>
#include <qrcode.h>
#include <driver/ledc.h>
#define PIN_LCD_BLK 2

// Internal display & GIF decoder instances
static TFT_eSPI    s_tft = TFT_eSPI();
static AnimatedGIF s_gif;
static File        s_gifFile;

// Single line render buffer: 240 pixels * 2 bytes = 480 bytes RAM budget
static uint16_t s_lineBuffer[240];

static bool     s_is_gif_open = false;
static uint32_t s_next_frame_ms = 0;
static uint8_t  s_current_slot = 1;
static uint8_t s_current_brightness_duty = BACKLIGHT_DUTY_PLAYBACK;

// ============================================================================
// ANIMATEDGIF LITTLEFS FILE CALLBACKS
// ============================================================================

static void* GIF_open(const char *filename, int32_t *pFileSize) {
    if (s_gifFile) {
        s_gifFile.close();
    }
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
    int32_t bytesRead = f->read(pBuf, iLen);
    pFile->iPos += bytesRead; // ОБЯЗАТЕЛЬНО обновляем смещение!
    return bytesRead;
}

static int32_t GIF_seek(GIFFILE *pFile, int32_t iPosition) {
    File *f = (File*)pFile->fHandle;
    if (!f || !(*f)) return 0;
    f->seek(iPosition, SeekSet);
    pFile->iPos = (int32_t)f->position(); // ОБЯЗАТЕЛЬНО синхронизируем позицию!
    return pFile->iPos;
}

/**
 * Line draw callback: reads palette indices, builds single scanline in s_lineBuffer,
 * and pushes directly to GC9A01/ST7789 display window via SPI.
 */
static void GIF_draw(GIFDRAW *pDraw) {
    if (!pDraw || !pDraw->pPixels || !pDraw->pPalette) return;

    uint8_t *s = pDraw->pPixels;
    uint16_t *pal = pDraw->pPalette;
    int width = pDraw->iWidth;
    int y = pDraw->iY + pDraw->y;
    int x = pDraw->iX;

    // Авто-центрирование гифки по центру круглого экрана 240х240:
    if (pDraw->iWidth < 240) {
        x += (240 - pDraw->iWidth) / 2;
    }
    if (pDraw->iHeight < 240) {
        y += (240 - pDraw->iHeight) / 2;
    }

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
                s_lineBuffer[i] = 0x0000;
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

void display_set_backlight(uint8_t duty) {
    s_current_brightness_duty = duty;
    ledcWrite(BACKLIGHT_LEDC_CH, duty);
}

void display_init(void) {
    // 1. Сначала запускаем контроллер GC9A01
    s_tft.init();
    s_tft.setRotation(0);
    s_tft.fillScreen(TFT_BLACK);

    // 2. И только ПОСЛЕ этого перехватываем GPIO 2 под аппаратный ШИМ
    ledcSetup(BACKLIGHT_LEDC_CH, BACKLIGHT_LEDC_FREQ, BACKLIGHT_LEDC_RES);
    ledcAttachPin(PIN_LCD_BLK, BACKLIGHT_LEDC_CH);
    display_set_backlight(BACKLIGHT_DUTY_PLAYBACK);

    // 3. Запуск декодера GIF
    s_gif.begin(BIG_ENDIAN_PIXELS);

    display_wake();
}

void display_sleep(void) {
    // Закрываем любые открытые файлы GIF, чтобы освободить дескрипторы для LittleFS
    if (s_is_gif_open) {
        s_gif.close();
        s_is_gif_open = false;
    }
    if (s_gifFile) {
        s_gifFile.close();
    }

    display_set_backlight(BACKLIGHT_DUTY_OFF);
    s_tft.writecommand(0x10); // SLPIN (Sleep In)
    delay(10);
}

void display_wake(void) {
    s_tft.writecommand(0x11); // SLPOUT (Sleep Out)
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
    s_tft.drawString("HOLD 3s -> WIFI", 120, 130, 2);

    uint16_t mv = battery_get_mv();
    uint8_t  pct = battery_get_percentage();
    snprintf(buf, sizeof(buf), "BAT: %d.%02dV (%d%%)", mv / 1000, (mv % 1000) / 10, pct);
    s_tft.setTextColor(TFT_GREEN, TFT_BLACK);
    s_tft.drawString(buf, 120, 165, 2);
}

void display_open_slot(uint8_t slot) {
    if (s_is_gif_open) {
        s_gif.close();
        s_is_gif_open = false;
    }
    if (s_gifFile) {
        s_gifFile.close();
    }

    s_current_slot = slot;
    if (slot == 4) {
        display_show_system_info();
        return;
    }
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
            Serial.printf("[DISPLAY] Failed to decode GIF: %s (Error code: %d)\n", pathGif, s_gif.getLastError());
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
        // Передаем false, чтобы библиотека не блокировала процессор через delay()
        int res = s_gif.playFrame(false, &frame_delay_ms);

        if (res == 1) {
            // Кадр успешно отрисован, ждем указанную задержку (минимум 30 мс)
            s_next_frame_ms = now + (frame_delay_ms > 0 ? frame_delay_ms : 100);
        } else if (res == 0) {
            // Достигнут конец гифки (последний кадр) — перезапускаем анимацию по кругу!
            s_gif.reset();
            s_next_frame_ms = now + (frame_delay_ms > 0 ? frame_delay_ms : 100);
        } else {
            // Произошла реальная ошибка декодирования
            int err = s_gif.getLastError();
            Serial.printf("[DISPLAY] PlayFrame returned %d, LastError: %d in slot %d\n", res, err, s_current_slot);

            // Если ошибка не критическая, пробуем сбросить на начало вместо удаления
            static uint8_t s_error_count = 0;
            s_error_count++;

            if (s_error_count < 3) {
                s_gif.reset();
                s_next_frame_ms = now + 100;
            } else {
                s_error_count = 0;
                Serial.printf("[DISPLAY] Unrecoverable GIF error. Removing /slot%d.gif\n", s_current_slot);
                s_gif.close();
                s_is_gif_open = false;

                char badPath[16];
                snprintf(badPath, sizeof(badPath), "/slot%d.gif", s_current_slot);
                LittleFS.remove(badPath);

                display_show_placeholder(s_current_slot);
            }
        }
    }
}

// ============================================================================
// QR CODE RENDERING (OPTIMIZED FOR 1.28" ROUND 240x240 DISPLAY)
// ============================================================================

static void render_qr_canvas(const char *payload, const char *title, const char *subtitle, const char *hint) {
    s_tft.fillScreen(TFT_BLACK);

    QRCode qrcode;
    uint8_t qrcodeData[qrcode_getBufferSize(3)];
    qrcode_initText(&qrcode, qrcodeData, 3, 0, payload);

    const int scale = 4; // 29 * 4 = 116px
    const int qrSize = qrcode.size * scale;
    const int startX = (240 - qrSize) / 2;
    const int startY = (240 - qrSize) / 2 - 2;

    // Белая рамка вокруг QR (нужна для надежного распознавания камерой)
    s_tft.fillRect(startX - 4, startY - 4, qrSize + 8, qrSize + 8, TFT_WHITE);

    // Отрисовка модулей QR
    for (uint8_t y = 0; y < qrcode.size; y++) {
        for (uint8_t x = 0; x < qrcode.size; x++) {
            if (qrcode_getModule(&qrcode, x, y)) {
                s_tft.fillRect(startX + (x * scale), startY + (y * scale), scale, scale, TFT_BLACK);
            }
        }
    }

    // Верхний заголовок (по центру, точно вписывается в круг)
    s_tft.setTextDatum(TC_DATUM);
    s_tft.setTextColor(TFT_CYAN, TFT_BLACK);
    s_tft.drawString(title, 120, 22, 2);

    // Нижняя подпись
    s_tft.setTextColor(TFT_WHITE, TFT_BLACK);
    s_tft.drawString(subtitle, 120, 190, 2);

    // Подсказка по переключению
    s_tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
    s_tft.drawString(hint, 120, 212, 1);
}

void display_show_qr(QrViewMode mode) {
    if (s_is_gif_open) {
        s_gif.close();
        s_is_gif_open = false;
    }
    if (s_gifFile) {
        s_gifFile.close();
    }

    display_set_backlight(BACKLIGHT_DUTY_PORTAL);

    if (mode == QR_MODE_WIFI) {
        // T:WPA ОБЯЗАТЕЛЬНО идет первым для Android/iOS:
        const char *wifiPayload = "WIFI:T:WPA;S:" AP_SSID ";P:" AP_PASS ";;";
        render_qr_canvas(wifiPayload, "1. CONNECT WI-FI", AP_SSID, "CLICK: OPEN SITE QR");
    } else {
        // QR №2: Прямая ссылка для открытия в Safari/Chrome
        const char *urlPayload = "http://" AP_IP_STR "/";
        render_qr_canvas(urlPayload, "2. OPEN BROWSER", AP_IP_STR, "CLICK: WI-FI QR");
    }
}
void display_show_system_info(void) {
    s_tft.fillScreen(TFT_BLACK);
    s_tft.drawCircle(120, 120, 115, TFT_DARKGREY);
    s_tft.drawCircle(120, 120, 113, TFT_CYAN);

    s_tft.setTextDatum(TC_DATUM);
    s_tft.setTextColor(TFT_CYAN, TFT_BLACK);
    s_tft.drawString("SYSTEM INFO", 120, 18, 2);

    // 1. Процент заряда
    uint16_t mv = battery_get_mv();
    uint8_t  pct = battery_get_percentage();
    char buf[32];
    snprintf(buf, sizeof(buf), "%d%%", pct);
    s_tft.setTextColor(TFT_GREEN, TFT_BLACK);
    s_tft.drawString(buf, 120, 42, 4);

    snprintf(buf, sizeof(buf), "VOLTAGE: %d.%02dV", mv / 1000, (mv % 1000) / 10);
    s_tft.setTextColor(TFT_WHITE, TFT_BLACK);
    s_tft.drawString(buf, 120, 75, 2);

    // 2. Текущая яркость экрана (ВЫВОДИМ СЮДА)
    uint8_t bright_pct = (s_current_brightness_duty * 100) / 255;
    snprintf(buf, sizeof(buf), "BRIGHTNESS: %d%%", bright_pct);
    s_tft.setTextColor(TFT_YELLOW, TFT_BLACK);
    s_tft.drawString(buf, 120, 98, 2);

    // 3. Подсказка по управлению кнопкой
    s_tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
    s_tft.drawString("CONTROLS:", 120, 124, 2);

    s_tft.setTextColor(TFT_WHITE, TFT_BLACK);
    s_tft.drawString("1x CLICK : NEXT SLOT", 120, 145, 1);
    s_tft.drawString("2x CLICK : BRIGHTNESS", 120, 160, 1);
    s_tft.drawString("HOLD 3s  : WI-FI PORTAL", 120, 175, 1);
    s_tft.drawString("HOLD 5s  : POWER OFF", 120, 190, 1);
}