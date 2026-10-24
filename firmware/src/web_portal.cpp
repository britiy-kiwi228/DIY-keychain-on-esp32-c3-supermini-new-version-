#include "web_portal.h"
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

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

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

    // Fallback emergency upload form if LittleFS image is missing
    String html = F("<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    "<title>WIRED KEYCHAIN // EMERGENCY</title><style>body{background:#0b0f17;color:#00f0ff;font-family:monospace;padding:20px;text-align:center}"
                    "input,button{background:#111;color:#fff;border:1px solid #00f0ff;padding:12px;margin:10px auto;display:block;width:90%}</style></head>"
                    "<body><h2>WIRED KEYCHAIN // UPLOADER</h2>"
                    "<form method='POST' action='/api/upload?slot=1' enctype='multipart/form-data'>"
                    "<input type='file' name='data' accept='.gif'>"
                    "<button type='submit'>INJECT TO SLOT 1</button></form></body></html>");
    s_server.send(200, "text/html", html);
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

        // Remove previous files for this slot
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
            Serial.println(F("[WEB] Upload aborted by client. Cleaned up handle."));
        }
    }
}

// ============================================================================
// LIFECYCLE ROUTINES
// ============================================================================

void web_portal_start(uint8_t *p_active_slot) {
    s_p_active_slot = p_active_slot;

    // 1. Boost CPU to 160MHz for networking
    setCpuFrequencyMhz(160);

    // 2. Start SoftAP
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    delay(20);

    // 3. Start Captive DNS on port 53 (redirect all queries to 192.168.4.1)
    s_dns.setErrorReplyCode(DNSReplyCode::NoError);
    s_dns.start(DNS_PORT, "*", WiFi.softAPIP());

    // 4. Setup WebServer Endpoints
    s_server.on("/", HTTP_GET, handle_root);
    s_server.on("/hotspot-detect.html", HTTP_GET, handle_captive_redirect); // Apple Captive
    s_server.on("/generate_204", HTTP_GET, handle_captive_redirect);       // Android Captive
    s_server.on("/canonical.html", HTTP_GET, handle_captive_redirect);

    s_server.on("/api/status", HTTP_GET, handle_api_status);
    s_server.on("/api/select", HTTP_POST, handle_api_select);
    s_server.on("/api/delete", HTTP_POST, handle_api_delete);

    s_server.on("/api/upload", HTTP_POST, []() {
        s_server.sendHeader("Access-Control-Allow-Origin", "*");
        s_server.send(200, "application/json", "{\"status\":\"success\"}");
    }, handle_file_upload);

    s_server.on("/upload", HTTP_POST, []() {
        s_server.sendHeader("Access-Control-Allow-Origin", "*");
        s_server.send(200, "application/json", "{\"status\":\"success\"}");
    }, handle_file_upload);

    s_server.begin();
    Serial.printf("[WEB] Portal live: SSID=%s, IP=%s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
}

void web_portal_stop(void) {
    s_dns.stop();
    s_server.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    esp_wifi_stop();

    // Throttle CPU back to 80MHz to save battery
    setCpuFrequencyMhz(80);
    Serial.println(F("[WEB] Portal shut down. Wi-Fi powered OFF."));
}

void web_portal_update(void) {
    s_dns.processNextRequest();
    s_server.handleClient();
}

bool web_portal_has_clients(void) {
    return (WiFi.softAPgetStationNum() > 0);
}
