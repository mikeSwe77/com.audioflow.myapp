/**
 * Audioflow API Discovery Helper
 * 
 * Use this script to test and discover the correct HTTP endpoints
 * for your Audioflow device.
 * 
 * Run with: node api-discovery.js <audioflow-ip>
 */

const http = require('http');

const AUDIOFLOW_IP = process.argv[2] || '192.168.1.100';

console.log(`Testing Audioflow API at ${AUDIOFLOW_IP}\n`);

// Test different endpoint patterns
const endpointsToTest = [
  // Status endpoints
  { method: 'GET', path: '/switch', description: 'Get device status' },
  //{ method: 'GET', path: '/state', description: 'Get device state' },
  //{ method: 'GET', path: '/api/status', description: 'Get API status' },
  //{ method: 'GET', path: '/info', description: 'Get device info' },
  { method: 'GET', path: '/zones', description: 'Get zones info' },
  
  // Network info endpoints
  //{ method: 'GET', path: '/network', description: 'Get network info' },
  //{ method: 'GET', path: '/wifi', description: 'Get WiFi info' },
  //{ method: 'GET', path: '/api/network', description: 'Get API network' },
];

async function testEndpoint(method, path, data = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: AUDIOFLOW_IP,
      port: 80,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        resolve({
          success: true,
          statusCode: res.statusCode,
          body: body,
          headers: res.headers
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Timeout'
      });
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function runDiscovery() {
  console.log('='.repeat(70));
  console.log('AUDIOFLOW API DISCOVERY');
  console.log('='.repeat(70));
  console.log();

  for (const endpoint of endpointsToTest) {
    console.log(`Testing: ${endpoint.method} ${endpoint.path}`);
    console.log(`Description: ${endpoint.description}`);
    
    const result = await testEndpoint(endpoint.method, endpoint.path);
    
    if (result.success) {
      console.log(`✓ Status: ${result.statusCode}`);
      console.log(`Response:`);
      
      try {
        const json = JSON.parse(result.body);
        console.log(JSON.stringify(json, null, 2));
      } catch (e) {
        console.log(result.body);
      }
      
      console.log();
    } else {
      console.log(`✗ Error: ${result.error}`);
      console.log();
    }
    
    console.log('-'.repeat(70));
  }

  console.log('\n' + '='.repeat(70));
  console.log('DISCOVERY COMPLETE');
  console.log('='.repeat(70));
  console.log('\nNext steps:');
  console.log('1. Identify which endpoints returned valid responses');
  console.log('2. Update AudioflowClient.js with the correct endpoints');
  console.log('3. Test zone control endpoints manually with curl or Postman');
  console.log('\nExample curl commands to test zone control:');
  console.log(`  curl -X POST http://${AUDIOFLOW_IP}/zone/1/state -H "Content-Type: application/json" -d '{"state":"on"}'`);
  console.log(`  curl -X POST http://${AUDIOFLOW_IP}/zone/1/state -H "Content-Type: application/json" -d '{"state":"off"}'`);
  console.log(`  curl -X POST http://${AUDIOFLOW_IP}/zones/all -H "Content-Type: application/json" -d '{"state":"on"}'`);
}

// Run discovery
if (!process.argv[2]) {
  console.log('Usage: node api-discovery.js <audioflow-ip>');
  console.log('Example: node api-discovery.js 192.168.1.100');
  process.exit(1);
}

runDiscovery().catch(console.error);