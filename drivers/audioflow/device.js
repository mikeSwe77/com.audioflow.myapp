'use strict';

const Homey = require('homey');
const AudioflowClient = require('../../lib/AudioflowClient');

class AudioflowDevice extends Homey.Device {

  async onInit() {
    this.log('Audioflow device onInit started');
    
    const ip = this.getSetting('ip_address');
    const model = this.getStoreValue('model'); // Get the model saved during discovery
    
    // Determine how many zones this device has
    this.zoneCount = this._getZoneCount(model);
    this.log(`Model: ${model}, Zones: ${this.zoneCount}`);

    if (!ip) {
      this.setUnavailable('No IP address configured').catch(this.error);
      return; 
    } 
    
    this.client = new AudioflowClient(ip);

    // 1. Clean up excessive capabilities (e.g., remove zone 3 & 4 on a 2-zone device)
    for (let i = 1; i <= 4; i++) {
      const capabilityId = `zone_btn_${i}`;
      if (i > this.zoneCount && this.hasCapability(capabilityId)) {
        this.log(`Removing capability ${capabilityId} for model ${model}`);
        await this.removeCapability(capabilityId).catch(this.error);
      }
    }

    // 2. Register listeners ONLY for the valid zones
    for (let i = 1; i <= this.zoneCount; i++) {
      const capabilityId = `zone_btn_${i}`; 
      
      // Ensure the capability exists (in case it was previously removed or hidden)
      if (!this.hasCapability(capabilityId)) {
        await this.addCapability(capabilityId).catch(this.error);
      }

      this.registerCapabilityListener(capabilityId, async (value) => {
        this.log(`UI Button Action: Setting Zone ${i} to ${value}`);
        return await this.client.setZoneState(i, value);
      });
    }

    this._registerFlowActions();
    this._registerFlowConditions();
  
    // Run sync immediately
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

  _getZoneCount(model) {
    if (model === '3S-2Z') return 2;
    if (model === '3S-3Z') return 3;
    return 4; // Default to 4 for 3S-4Z or if unknown
  }

  _registerFlowActions() {
    this.homey.flow.getActionCard('turn_zone_on').registerRunListener(async (args) => {
      const zoneNum = parseInt(args.zone);
      if (zoneNum > this.zoneCount) throw new Error('Zone not available on this device');
      return await this.client.setZoneState(zoneNum, true);
    });

    this.homey.flow.getActionCard('turn_zone_off').registerRunListener(async (args) => {
      const zoneNum = parseInt(args.zone);
      if (zoneNum > this.zoneCount) throw new Error('Zone not available on this device');
      return await this.client.setZoneState(zoneNum, false);
    });

    this.homey.flow.getActionCard('turn_all_zones_off').registerRunListener(async () => {
      this.log('Flow Action: Turning ALL zones OFF');
      // Only iterate through supported zones
      for (let i = 1; i <= this.zoneCount; i++) {
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
      const zoneNum = parseInt(args.zone);
      const capabilityId = `zone_btn_${zoneNum}`; 
      
      if (zoneNum > this.zoneCount) return false;
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
      const data = await this.client.getZones(); 
      const zones = Array.isArray(data) ? data : (data.zones || []);

      let switchData = {};
      try {
        switchData = await this.client.getSwitch();
      } catch (err) { }

      // Sync Zones (Only iterate up to this.zoneCount)
      for (const zoneData of zones) {
        const zoneNum = parseInt(zoneData.id) + 1; 
        
        // Skip if hardware reports more zones than we support/expect for this model
        if (zoneNum > this.zoneCount) continue;

        const capabilityId = `zone_btn_${zoneNum}`;
        const settingId = `enabled_zone${zoneNum}`;
        
        const isCurrentlyOn = zoneData.state === 'on';
        const isHardwareEnabled = zoneData.enabled === 1; 
        const zoneName = zoneData.name || `Zone ${zoneNum}`;

        // Visibility Logic: Hide if disabled via hardware switch/settings
        if (!isHardwareEnabled && this.hasCapability(capabilityId)) {
          // Only hide it if it's within our valid range but disabled in settings
          await this.removeCapability(capabilityId);
          continue; 
        }

        // Visibility Logic: Show if enabled
        if (isHardwareEnabled && !this.hasCapability(capabilityId)) {
          await this.addCapability(capabilityId);
          this.registerCapabilityListener(capabilityId, async (value) => {
             return await this.client.setZoneState(zoneNum, value);
          });
        }

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
               await this.setCapabilityOptions(capabilityId, { title: zoneName });
               // Update settings label if settings exist
               const settingsConfig = this.getSettingsConfig ? await this.getSettingsConfig() : null; // Check availability
               if(settingsConfig) {
                   await this.setSettingsConfig({
                      [settingId]: {
                        label: { en: `Enable ${zoneName}`, sv: `Aktivera ${zoneName}` }
                      }
                   });
               }
            }
          } catch (err) { }
        }

        // Sync Checkbox Setting
        if (this.getSetting(settingId) !== isHardwareEnabled) {
          this.setSettings({ [settingId]: isHardwareEnabled }).catch(() => {});
        }
      }

      // Sync Exclusive Mode
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
      
      if (key.startsWith('enabled_zone')) {
        const zoneNum = parseInt(key.replace('enabled_zone', ''));
        // Safety check
        if (zoneNum > this.zoneCount) continue;

        const isEnabled = newSettings[key];
        
        try {
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

      if (key === 'exclusive_mode') {
         const mode = newSettings[key] ? 'enable' : 'disable';
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