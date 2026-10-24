#pragma once
#include <Arduino.h>

/**
 * ============================================================================
 * WEB PORTAL & CAPTIVE AP MODULE
 * SoftAP, Port 53 DNS redirection, WebServer routes, chunked flash upload.
 * ============================================================================
 */

void web_portal_start(uint8_t *p_active_slot);
void web_portal_stop(void);
void web_portal_update(void);
bool web_portal_has_clients(void);
