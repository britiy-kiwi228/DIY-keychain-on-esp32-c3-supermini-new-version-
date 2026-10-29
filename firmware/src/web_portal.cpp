#include "web_portal.h"
#include "config.h"
#include "battery.h"

#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>
#include <esp_wifi.h>

static WebServer s_server(HTTP_PORT);
static File      s_uploadFile;
static uint8_t*  s_p_active_slot = nullptr;

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

static void handle_root() {
    Serial.println(F("[HTTP] >>> CLIENT CONNECTED TO ROOT / <<<"));

    if (LittleFS.exists("/index.html")) {
        File f = LittleFS.open("/index.html", "r");
        size_t sz = f.size();
        Serial.printf("[HTTP] Serving /index.html (Size: %u bytes)\n", (unsigned int)sz);
        s_server.streamFile(f, "text/html");
        f.close();
        return;
    }

    if (LittleFS.exists("/index.html.gz")) {
        File f = LittleFS.open("/index.html.gz", "r");
        s_server.sendHeader("Content-Encoding", "gzip");
        s_server.streamFile(f, "text/html");
        f.close();
        return;
    }

    Serial.println(F("[HTTP] ERROR: Files not found in LittleFS!"));
    s_server.send(200, "text/html", "<h1>ESP32 ALIVE BUT NO HTML FILE</h1>");
}

static void handle_api_status() {
    uint16_t mv = battery_get_mv();
    uint8_t  pct = battery_get_percentage();
    bool     chg = battery_is_charging();
    size_t   freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
    uint8_t  slot = s_p_active_slot ? *s_p_active_slot : 1;

    char json[128];
    snprintf(json, sizeof(json),
        "{\"vbat_mv\":%u,\"percent\":%u,\"slot\":%u,\"free_bytes\":%u,\"charging\":%s}",
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
            s_server.send(200, "application/json", "{\"status\":\"ok\"}");
            return;
        }
    }
    s_server.send(400, "application/json", "{\"error\":\"invalid_slot\"}");
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
                s_server.send(200, "application/json", "{\"status\":\"deleted\"}");
                return;
            }
        }
    }
    s_server.send(404, "application/json", "{\"error\":\"not_found\"}");
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
        Serial.printf("[WEB] Upload start: %s\n", path);

        // Авто-удаление противоположного формата (чтобы гифка и картинка не конфликтовали)
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
            Serial.printf("[WEB] Upload complete: %u bytes\n", upload.totalSize);
        }
    } else if (upload.status == UPLOAD_FILE_ABORTED) {
        if (s_uploadFile) {
            s_uploadFile.close();
            Serial.println(F("[WEB] Upload aborted by client."));
        }
    }
}

static String get_content_type(const String& path) {
    if (path.endsWith(".html")) return "text/html";
    else if (path.endsWith(".css")) return "text/css";
    else if (path.endsWith(".js")) return "application/javascript";
    else if (path.endsWith(".json")) return "application/json";
    else if (path.endsWith(".png")) return "image/png";
    else if (path.endsWith(".gif")) return "image/gif";
    else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    else if (path.endsWith(".ico")) return "image/x-icon";
    else if (path.endsWith(".svg")) return "image/svg+xml";
    return "text/plain";
}

static void handle_not_found() {
    String uri = s_server.uri();

    // 1. Ищем файл на LittleFS
    if (LittleFS.exists(uri)) {
        File f = LittleFS.open(uri, "r");
        s_server.streamFile(f, get_content_type(uri));
        f.close();
        return;
    }

    if (LittleFS.exists(uri + ".gz")) {
        File f = LittleFS.open(uri + ".gz", "r");
        s_server.sendHeader("Content-Encoding", "gzip");
        s_server.streamFile(f, get_content_type(uri));
        f.close();
        return;
    }

    // 2. Зонды ОС Android / Google: отвечаем 204 No Content (НЕ редиректим!)
    if (uri.indexOf("generate_204") >= 0 || uri.indexOf("gen_204") >= 0) {
        s_server.send(204, "text/plain", "");
        return;
    }

    // 3. Зонды Apple / iOS: отвечаем успехом (НЕ редиректим!)
    if (uri.indexOf("hotspot") >= 0 || uri.indexOf("canonical") >= 0) {
        s_server.send(200, "text/html", "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
        return;
    }

    // 4. Зонды Windows
    if (uri.indexOf("connecttest") >= 0 || uri.indexOf("ncsi") >= 0) {
        s_server.send(200, "text/plain", "Microsoft Connect Test");
        return;
    }

    s_server.send(404, "text/plain", "Not Found");
}

// ============================================================================
// LIFECYCLE ROUTINES
// ============================================================================

void web_portal_start(uint8_t *p_active_slot) {
    s_p_active_slot = p_active_slot;

    setCpuFrequencyMhz(160);
    delay(50);

    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);
    esp_wifi_start();

    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
    bool ap_ok = WiFi.softAP(AP_SSID, AP_PASS, 1, 0, 4);
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    delay(100);

    // Маршруты сервера
    s_server.on("/", HTTP_GET, handle_root);

    // Глушим сетевые проверки смартфонов без редиректов
    s_server.on("/generate_204", HTTP_GET, []() { s_server.send(204, "text/plain", ""); });
    s_server.on("/gen_204", HTTP_GET, []() { s_server.send(204, "text/plain", ""); });
    s_server.on("/hotspot-detect.html", HTTP_GET, []() {
        s_server.send(200, "text/html", "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
    });
    s_server.on("/canonical.html", HTTP_GET, []() {
        s_server.send(200, "text/html", "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
    });

    s_server.on("/api/status", HTTP_GET, handle_api_status);
    s_server.on("/api/select", HTTP_POST, handle_api_select);
    s_server.on("/api/delete", HTTP_POST, handle_api_delete);

    s_server.on("/api/upload", HTTP_POST, []() {
        s_server.sendHeader("Access-Control-Allow-Origin", "*");
        s_server.send(200, "application/json", "{\"status\":\"success\"}");
    }, handle_file_upload);

    s_server.onNotFound(handle_not_found);
    s_server.begin();

    Serial.printf("[WEB] Portal live: Status=%s, SSID=%s, IP=%s\n",
                  ap_ok ? "OK" : "FAIL",
                  AP_SSID, 
                  WiFi.softAPIP().toString().c_str());
}

void web_portal_stop(void) {
    s_server.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    esp_wifi_stop();

    setCpuFrequencyMhz(80);
    Serial.println(F("[WEB] Portal shut down. Wi-Fi powered OFF."));
}

void web_portal_update(void) {
    s_server.handleClient();
}

bool web_portal_has_clients(void) {
    return (WiFi.softAPgetStationNum() > 0);
}