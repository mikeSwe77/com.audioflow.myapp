'use strict';

const Homey = require('homey');
const dgram = require('dgram');

class AudioflowDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is loaded.
   */
  async onInit() {
    this.log('Audioflow driver has been initialized');
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
   * onRepair logic (IP Update) - Allows users to fix connection if IP changes.
   */
  async onRepair(session, device) {
    this.log(`Repairing device ${device.getName()}...`);
    let discoverySocket = null;

    session.setHandler('list_devices', async () => {
      return new Promise((resolve) => {
        discoverySocket = dgram.createSocket('udp4');
        const currentSerial = device.getStoreValue('serial'); 
        
        discoverySocket.on('message', (msg, rinfo) => {
          const magic = msg.slice(0, 6).toString();
          if (magic === 'afpong') {
            const serial = msg.slice(14, 30).toString().replace(/\0/g, '').trim();
            
            // If serial matches the device we are repairing, we found the new IP! 
            if (serial === currentSerial) {
              this.log(`Repair: Found new IP for ${serial}: ${rinfo.address}`);
              
              resolve([{
                name: device.getName(),
                data: { id: device.getData().id },
                settings: { ip_address: rinfo.address } 
              }]);
              
              try { discoverySocket.close(); } catch(e) {}
              discoverySocket = null;
            }
          }
        });

        // Use random port binding here as well
        discoverySocket.bind(() => {
          try {
            discoverySocket.setBroadcast(true);
            const message = Buffer.from('afping');
            discoverySocket.send(message, 0, message.length, 10499, '255.255.255.255');
          } catch (err) {
             this.error('Repair socket error:', err);
          }
        });

        // Timeout after 5s if not found
        setTimeout(() => {
          if (discoverySocket) {
             try { discoverySocket.close(); } catch(e) {}
             resolve([]); // Return empty list if not found
          }
        }, 5000);
      });
    });
    
    session.setHandler('disconnect', () => {
      if (discoverySocket) {
        try { discoverySocket.close(); } catch(e) {}
      }
    });
  }
}

module.exports = AudioflowDriver;