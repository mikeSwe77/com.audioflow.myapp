'use strict';

const http = require('http');

class AudioflowClient {
  constructor(ipAddress) {
    this.ipAddress = ipAddress;
    this.port = 80;
  }

  async _request(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.ipAddress,
        port: this.port,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': data !== null ? Buffer.byteLength(data.toString()) : 0
        },
        timeout: 5000
      };

      // DEBUG LOG: See exactly what is being sent
      // console.log(`[HTTP Debug] ${method} http://${this.ipAddress}${path} | Body: ${data || 'None'}`);

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          // DEBUG LOG: See the hardware's response
          // console.log(`[HTTP Response] Status: ${res.statusCode} | Body: ${body}`);
          
          try {
            resolve(body.startsWith('{') || body.startsWith('[') ? JSON.parse(body) : body);
          } catch (err) {
            resolve(body);
          }
        });
      });

      req.on('error', (err) => {
        console.error(`[HTTP Error] ${err.message}`);
        reject(new Error(`HTTP request failed: ${err.message}`));
      });
      
      req.on('timeout', () => { 
        req.destroy(); 
        console.error('[HTTP Timeout] Device did not respond');
        reject(new Error('Request timeout')); 
      });

      if (data !== null) req.write(data.toString());
      req.end();
    });
  }

  /**
   * GET /switch - Get switch name, model, serial, and exclusive status
   */
  async getSwitch() {
    return await this._request('GET', '/switch');
  }

  /**
   * GET /zones - Get all zone names and states
   */
  async getZones() {
    const response = await this._request('GET', '/zones');
    return response.zones || [];
  }

  /**
   * GET /zones/N - Get specific zone state
   */
  async getZone(zoneNumber) {
    return await this._request('GET', `/zones/${zoneNumber}`);
  }

  /**
   * PUT /zones/N - Set zone state
   */
  async setZoneState(homeyZoneNum, state) {
    const payload = state ? '1' : '0';
    console.log(`[Client] Sending PUT to /zones/${homeyZoneNum} with payload: ${payload}`);
    return await this._request('PUT', `/zones/${homeyZoneNum}`, payload);
  }

  /**
   * PUT /zones - Set all zone states
   */
  async setAllZones(statesString) {
    return await this._request('PUT', '/zones', statesString);
  }

  /**
   * PUT /zonename/N - Set zone name and enabled state
   */
  async setZoneName(zoneNumber, name, enabled = true) {
    const enabledFlag = enabled ? '1' : '0';
    const truncatedName = name.substring(0, 15); // Max 15 chars
    const payload = `${enabledFlag}${truncatedName}`;
    
    // Use the 1-based zoneNumber for the path
    return await this._request('PUT', `/zonename/${zoneNumber}`, payload);
  }

  /**
   * PUT /exclusive - Set Exclusive Mode
   * Accepts: 'enable' or 'disable'
   */
  async setExclusiveMode(mode) {
    if (mode !== 'enable' && mode !== 'disable') {
      throw new Error('Mode must be "enable" or "disable"');
    }
    // FIX: Added leading slash to path '/exclusive'
    return await this._request('PUT', '/exclusive', mode);
  }

  /**
   * GET /reboot_now - Reboot switch
   */
  async reboot() {
    return await this._request('GET', '/reboot_now');
  }
}

module.exports = AudioflowClient;