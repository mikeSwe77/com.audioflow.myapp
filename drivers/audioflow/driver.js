'use strict';

const Homey = require('homey');
const dgram = require('dgram');
const AudioflowClient = require('../../lib/AudioflowClient');

class AudioflowDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is loaded.
   */
  async onInit() {
    this.log('Audioflow driver has been initialized');
    this._registerFlowAutocomplete();
    this._registerFlowRunListeners();
  }

  _registerFlowRunListeners() {
    this.getActionCard('turn_zone_on').registerRunListener(async (args) => {
      const device = args.device;
      const zoneNum = parseInt(args.zone.id);
      if (isNaN(zoneNum) || zoneNum > device.zoneCount) throw new Error('Zone not available on this device');
      return device.client.setZoneState(zoneNum, true);
    });

    this.getActionCard('turn_zone_off').registerRunListener(async (args) => {
      const device = args.device;
      const zoneNum = parseInt(args.zone.id);
      if (isNaN(zoneNum) || zoneNum > device.zoneCount) throw new Error('Zone not available on this device');
      return device.client.setZoneState(zoneNum, false);
    });

    this.getActionCard('turn_all_zones_on').registerRunListener(async (args) => {
      const device = args.device;
      device.log('Flow Action: Turning ALL zones ON');
      for (let i = 1; i <= device.zoneCount; i++) {
        try { await device.client.setZoneState(i, true); } catch (err) {
          device.error(`Failed to turn on zone ${i}:`, err.message);
        }
      }
      return true;
    });

    this.getActionCard('turn_all_zones_off').registerRunListener(async (args) => {
      const device = args.device;
      device.log('Flow Action: Turning ALL zones OFF');
      for (let i = 1; i <= device.zoneCount; i++) {
        try { await device.client.setZoneState(i, false); } catch (err) {
          device.error(`Failed to turn off zone ${i}:`, err.message);
        }
      }
      return true;
    });

    this.getConditionCard('is_zone_on').registerRunListener(async (args) => {
      const device = args.device;
      const zoneNum = parseInt(args.zone.id);
      const capabilityId = `zone_btn_${zoneNum}`;
      if (isNaN(zoneNum) || zoneNum > device.zoneCount) return false;
      if (!device.hasCapability(capabilityId)) return false;
      return !!device.getCapabilityValue(capabilityId);
    });

    this.getDeviceTriggerCard('zone_turned_on')
      .registerRunListener(async (args, state) => args.zone.id === state.zone);

    this.getDeviceTriggerCard('zone_turned_off')
      .registerRunListener(async (args, state) => args.zone.id === state.zone);
  }

  _getZoneList(query, device) {
    const results = [];
    const zoneCount = device ? (device.zoneCount || 4) : 4;

    for (let i = 1; i <= zoneCount; i++) {
      const capId = `zone_btn_${i}`;
      let name = `Zone ${i}`;
      if (device && device.hasCapability(capId)) {
        const opts = device.getCapabilityOptions(capId);
        if (opts && opts.title) name = opts.title;
      }
      if (!query || name.toLowerCase().includes(query.toLowerCase())) {
        results.push({ id: String(i), name });
      }
    }
    return results;
  }

  _registerFlowAutocomplete() {
    const autocomplete = async (query, args) => this._getZoneList(query, args.device);

    this.getDeviceTriggerCard('zone_turned_on').registerArgumentAutocompleteListener('zone', autocomplete);
    this.getDeviceTriggerCard('zone_turned_off').registerArgumentAutocompleteListener('zone', autocomplete);
    this.getActionCard('turn_zone_on').registerArgumentAutocompleteListener('zone', autocomplete);
    this.getActionCard('turn_zone_off').registerArgumentAutocompleteListener('zone', autocomplete);
    this.getConditionCard('is_zone_on').registerArgumentAutocompleteListener('zone', autocomplete);
  }

  /**
   * Handles the pairing process using UDP Discovery.
   */
  async onPair(session) {
    let discoverySocket = null;
    const foundDevices = {};

    this.log('Audioflow pairing session started');

    // 1. Handle the 'list_devices' view (UDP Discovery)
    session.setHandler('list_devices', async () => {
      this.log('Discovery: Starting UDP broadcast...');
      
      return new Promise((resolve) => {
        // Setup UDP Socket 
        discoverySocket = dgram.createSocket('udp4');

        discoverySocket.on('message', (msg, rinfo) => {
          this._handleDiscoveryMessage(msg, rinfo, foundDevices);
        });

        discoverySocket.on('error', (err) => {
          this.error('Discovery error:', err);
        });

        // BIND TO RANDOM PORT (This is critical: it worked in your first test)
        discoverySocket.bind(() => {
          try {
            discoverySocket.setBroadcast(true);
            
            // Send "afping" payload to port 10499 
            const message = Buffer.from('afping');
            
            // Send to 255.255.255.255 (Global Broadcast)
            discoverySocket.send(message, 0, message.length, 10499, '255.255.255.255', (err) => {
               if (err) this.error('Failed to send broadcast:', err);
               else this.log('Discovery: Broadcast sent to 255.255.255.255:10499');
            });
          } catch (err) {
            this.error('Socket bind callback error:', err);
          }
        });

        // Wait 3 seconds for devices to respond before resolving the list
        setTimeout(() => {
          const deviceList = Object.values(foundDevices);
          this.log(`Discovery: Found ${deviceList.length} devices.`);
          resolve(deviceList);
        }, 3000);
      });
    });

    // Clean up socket when the user closes the pair window
    session.setHandler('disconnect', () => {
      if (discoverySocket) {
        try { discoverySocket.close(); } catch (err) { }
        this.log('Discovery: Socket closed');
      }
    });
  }

  /**
   * Parses the UDP response packet.
   */
  _handleDiscoveryMessage(msg, rinfo, foundDevices) {
    try {
      // 1. Validate Magic Number "afpong" 
      const magic = msg.slice(0, 6).toString();
      if (magic !== 'afpong') return;

      // 2. Parse Model (8 bytes) 
      const model = msg.slice(6, 14).toString().replace(/\0/g, '').trim();

      // 3. Parse Serial (16 bytes) 
      const serial = msg.slice(14, 30).toString().replace(/\0/g, '').trim();

      // Create a unique, safe ID for Homey
      const deviceId = serial || `AF_${rinfo.address.replace(/\./g, '_')}`;

      // Prevent duplicates
      if (!foundDevices[deviceId]) {
        this.log(`Discovery: Found ${model} (${serial}) at ${rinfo.address}`);

        foundDevices[deviceId] = {
          name: `Audioflow ${model}`,
          data: {
            id: deviceId
          },
          settings: {
            ip_address: rinfo.address // Save IP for the device instance
          },
          store: {
            model: model,
            serial: serial
          }
        };
      }
    } catch (err) {
      this.error('Error parsing discovery packet:', err);
    }
  }

  /**
   * onRepair - Reconnects a device after its IP address has changed.
   * Tries UDP auto-discovery first; falls back to manual IP entry.
   */
  async onRepair(session, device) {
    this.log(`Repair started for ${device.getName()}`);
    let socket = null;

    // Auto-discovery: broadcast afping and match by serial number
    session.setHandler('scan', async () => {
      return new Promise((resolve) => {
        const currentSerial = device.getStoreValue('serial');
        let resolved = false;

        socket = dgram.createSocket('udp4');

        socket.on('message', (msg, rinfo) => {
          const magic = msg.slice(0, 6).toString();
          if (magic !== 'afpong' || resolved) return;

          const serial = msg.slice(14, 30).toString().replace(/\0/g, '').trim();
          if (serial === currentSerial) {
            resolved = true;
            this.log(`Repair: Found ${device.getName()} at new IP ${rinfo.address}`);
            try { socket.close(); } catch (e) {}
            socket = null;
            resolve({ found: true, ip: rinfo.address });
          }
        });

        socket.bind(() => {
          try {
            socket.setBroadcast(true);
            socket.send(Buffer.from('afping'), 0, 6, 10499, '255.255.255.255');
          } catch (err) {
            this.error('Repair scan error:', err);
          }
        });

        setTimeout(() => {
          if (!resolved) {
            try { socket.close(); } catch (e) {}
            socket = null;
            this.log(`Repair: Auto-discovery timed out for ${device.getName()}`);
            resolve({ found: false });
          }
        }, 5000);
      });
    });

    // Validate the IP by connecting, then save it
    session.setHandler('set_ip', async ({ ip }) => {
      const client = new AudioflowClient(ip);
      try {
        await client.getSwitch();
      } catch (err) {
        throw new Error(`Could not connect to Audioflow switch at ${ip}. Please check the IP address and try again.`);
      }
      await device.setSettings({ ip_address: ip });
      device.updateClient(ip);
      this.log(`Repair: IP updated to ${ip} for ${device.getName()}`);
    });

    session.setHandler('disconnect', () => {
      if (socket) {
        try { socket.close(); } catch (e) {}
        socket = null;
      }
    });
  }
}

module.exports = AudioflowDriver;