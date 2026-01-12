'use strict';

const Homey = require('homey');
const AudioflowClient = require('../../lib/AudioflowClient');

class AudioflowDevice extends Homey.Device {

  async onInit() {
    this.log('Audioflow device onInit started');
    
    const ip = this.getSetting('ip_address');
    
    if (!ip) {
      this.setUnavailable('No IP address configured').catch(this.error);
      return; 
    } 
    
    this.client = new AudioflowClient(ip);

    // Register listeners for button capabilities
    for (let i = 1; i <= 4; i++) {
      const capabilityId = `zone_btn_${i}`; 
      if (this.hasCapability(capabilityId)) {
        this.registerCapabilityListener(capabilityId, async (value) => {
          this.log(`UI Button Action: Setting Zone ${i} to ${value}`);
          return await this.client.setZoneState(i, value);
        });
      }
    }

    this._registerFlowActions();
    this._registerFlowConditions();
  
    // Run sync immediately to handle visibility and naming
    await this._syncWithHardware();

    // Start periodic polling
    this._startPolling(5);
  }

  async onDeleted() {
    this.log('Device deleted, stopping polling...');
    if (this.pollingInterval) {
      this.homey.clearInterval(this.pollingInterval);
    }
  }  

  _registerFlowActions() {
    this.homey.flow.getActionCard('turn_zone_on').registerRunListener(async (args) => {
      const zoneNum = parseInt(args.zone);
      return await this.client.setZoneState(zoneNum, true);
    });

    this.homey.flow.getActionCard('turn_zone_off').registerRunListener(async (args) => {
      const zoneNum = parseInt(args.zone);
      return await this.client.setZoneState(zoneNum, false);
    });

    this.homey.flow.getActionCard('turn_all_zones_off').registerRunListener(async () => {
      this.log('Flow Action: Turning ALL zones OFF');
      for (let i = 1; i <= 4; i++) {
        try {
          await this.client.setZoneState(i, false);
        } catch (err) {
          this.error(`Failed to turn off zone ${i}:`, err.message);
        }
      }
      return true; 
    });
  }

  _registerFlowConditions() {
    this.homey.flow.getConditionCard('is_zone_on').registerRunListener(async (args) => {
      const capabilityId = `zone_btn_${args.zone}`; 
      
      // If button is hidden/disabled, it is treated as off
      if (!this.hasCapability(capabilityId)) return false;

      return !!this.getCapabilityValue(capabilityId);
    });
  }

  _startPolling(intervalSeconds) {
    if (this.pollingInterval) this.homey.clearInterval(this.pollingInterval);
    this.pollingInterval = this.homey.setInterval(() => this._syncWithHardware(), intervalSeconds * 1000);
  }

  async _syncWithHardware() {
    try {
      // Fetch Zones
      const data = await this.client.getZones(); 
      const zones = Array.isArray(data) ? data : (data.zones || []);

      // Fetch Switch Settings (Exclusive Mode)
      let switchData = {};
      try {
        switchData = await this.client.getSwitch();
      } catch (err) {
        // Silently fail if getSwitch isn't implemented or supported yet
      }

      // --- SYNC ZONES ---
      for (const zoneData of zones) {
        const zoneNum = parseInt(zoneData.id) + 1; 
        const capabilityId = `zone_btn_${zoneNum}`;
        const settingId = `enabled_zone${zoneNum}`;
        
        const isCurrentlyOn = zoneData.state === 'on';
        const isHardwareEnabled = zoneData.enabled === 1; 
        const zoneName = zoneData.name || `Zone ${zoneNum}`;

        // Visibility Logic: Hide if disabled
        if (!isHardwareEnabled && this.hasCapability(capabilityId)) {
          this.log(`Hiding ${capabilityId} because it is disabled.`);
          await this.removeCapability(capabilityId);
          continue; 
        }

        // Visibility Logic: Show if enabled
        if (isHardwareEnabled && !this.hasCapability(capabilityId)) {
          this.log(`Showing ${capabilityId} because it is enabled.`);
          await this.addCapability(capabilityId);
          
          this.registerCapabilityListener(capabilityId, async (value) => {
             this.log(`UI Button Action: Setting Zone ${zoneNum} to ${value}`);
             return await this.client.setZoneState(zoneNum, value);
          });
        }

        // Sync State and Name (Only if visible)
        if (this.hasCapability(capabilityId)) {
          const previousState = this.getCapabilityValue(capabilityId);
          if (previousState !== isCurrentlyOn) {
            this.setCapabilityValue(capabilityId, isCurrentlyOn).catch(this.error);
            
            const triggerId = isCurrentlyOn ? 'zone_turned_on' : 'zone_turned_off';
            this.homey.flow.getDeviceTriggerCard(triggerId)
              .trigger(this, { zone_name: zoneName }, { zone: String(zoneNum) })
              .catch(() => {});
          }

          // Force Name Update
          try {
            const currentOptions = this.getCapabilityOptions(capabilityId);
            if (!currentOptions || currentOptions.title !== zoneName) {
               this.log(`Updating name for ${capabilityId} to ${zoneName}`);
               await this.setCapabilityOptions(capabilityId, { title: zoneName });
               
               await this.setSettingsConfig({
                  [settingId]: {
                    label: { en: `Enable ${zoneName}`, sv: `Aktivera ${zoneName}` }
                  }
               });
            }
          } catch (err) {
             this.error('Error updating zone name:', err);
          }
        }

        // Sync Checkbox Setting
        if (this.getSetting(settingId) !== isHardwareEnabled) {
          this.setSettings({ [settingId]: isHardwareEnabled }).catch(() => {});
        }
      }

      // --- SYNC EXCLUSIVE MODE ---
      if (switchData && typeof switchData.exclusive !== 'undefined') {
        const isExclusive = switchData.exclusive === true;
        if (this.getSetting('exclusive_mode') !== isExclusive) {
          this.setSettings({ 'exclusive_mode': isExclusive }).catch(() => {});
        }
      }

    } catch (err) {
      this.error('Polling failed:', err.message);
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    for (const key of changedKeys) {
      
      // Zone Enable/Disable
      if (key.startsWith('enabled_zone')) {
        const zoneNum = parseInt(key.replace('enabled_zone', ''));
        const isEnabled = newSettings[key];
        
        this.log(`Settings: Changing Zone ${zoneNum} enabled state to ${isEnabled}`);

        try {
          // Preserve name during toggle
          const capabilityId = `zone_btn_${zoneNum}`;
          let currentName = `Zone ${zoneNum}`;
          if (this.hasCapability(capabilityId)) {
            const options = this.getCapabilityOptions(capabilityId);
            if (options && options.title) currentName = options.title;
          }

          await this.client.setZoneName(zoneNum, currentName, isEnabled);
        } catch (err) {
          throw new Error(`Hardware update failed: ${err.message}`);
        }
      }

      // Exclusive Mode Toggle
      if (key === 'exclusive_mode') {
         const mode = newSettings[key] ? 'enable' : 'disable';
         this.log(`Settings: Setting exclusive mode to ${mode}`);
         try {
           await this.client.setExclusiveMode(mode);
         } catch(err) {
           throw new Error(`Failed to set exclusive mode: ${err.message}`);
         }
      }
    }
  }
}

module.exports = AudioflowDevice;