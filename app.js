'use strict';
const Homey = require('homey');
class AudioflowApp extends Homey.App {
  async onInit() { this.log('Audioflow app has been initialized'); }
}
module.exports = AudioflowApp;