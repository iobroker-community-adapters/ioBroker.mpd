# ioBroker MPD Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

**MPD Adapter Specific Context:**
This adapter connects ioBroker to Music Player Daemon (MPD) servers. MPD is a flexible, powerful server-side application for playing music. The adapter allows:
- Connecting to remote or local MPD servers
- Controlling music playback (play, pause, stop, next, previous, seek)
- Managing playlists and queues
- Retrieving current song information and player status
- Sending commands and receiving events from MPD protocol
- Supporting various MPD commands as specified in the MPD Protocol Documentation: http://www.musicpd.org/doc/protocol/

Key dependencies:
- `mpd`: Node.js library for MPD protocol communication
- `@iobroker/adapter-core`: ioBroker adapter framework

The adapter communicates with MPD servers over TCP connections and maintains real-time status updates.

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Verify expected states exist
                        const currentlyStates = await harness.states.getKeysAsync('your-adapter.0.currently.*');
                        
                        if (currentlyStates.length === 0) {
                            return reject(new Error('No states created for currently forecast'));
                        }

                        console.log(`✅ Found ${currentlyStates.length} states created`);
                        resolve('Test completed successfully');
                        
                    } catch (e) {
                        console.error(`❌ Test failed with error: ${e.message}`);
                        reject(e);
                    }
                });
            });
        });
    }
});
```

#### MPD Adapter Specific Testing Considerations:

For the MPD adapter, integration tests should focus on:
- **Mock MPD Server**: Since MPD servers may not be available in CI environments, create mock servers for testing
- **Connection Testing**: Test connection establishment and error handling
- **Command Testing**: Test common MPD commands (play, pause, status, etc.)
- **Event Handling**: Test MPD event processing and state updates
- **Error Recovery**: Test reconnection logic when MPD server becomes unavailable

Example MPD-specific test configuration:
```javascript
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('MPD Adapter Integration Tests', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should connect to mock MPD server and retrieve status', async function() {
                this.timeout(30000);
                
                const obj = await harness.objects.getObjectAsync('system.adapter.mpd.0');
                
                // Configure with mock/test MPD server settings
                Object.assign(obj.native, {
                    host: 'localhost',
                    port: 6600,
                    password: '',
                    // Add other MPD-specific config
                });

                await harness.objects.setObjectAsync(obj._id, obj);
                await harness.startAdapterAndWait();
                
                // Wait for connection and initial status
                await wait(5000);
                
                // Check connection state
                const connectionState = await harness.states.getStateAsync('mpd.0.info.connection');
                // Add assertions based on expected behavior
            });
        });
    }
});
```

## Code Standards

### ioBroker Adapter Structure
```javascript
const utils = require('@iobroker/adapter-core');

class MpdAdapter extends utils.Adapter {
  constructor(options) {
    super({
      ...options,
      name: 'mpd'
    });
    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
  }

  async onReady() {
    // Initialize MPD connection
    // Set up states and channels
    // Start periodic status updates
  }

  onStateChange(id, state) {
    if (state && !state.ack) {
      // Handle control commands from ioBroker
      // Send appropriate MPD commands
    }
  }

  onUnload(callback) {
    try {
      // Clean up MPD connections
      if (this.mpdConnection) {
        this.mpdConnection.disconnect();
      }
      // Clear timers
      if (this.statusTimer) {
        this.clearTimeout(this.statusTimer);
        this.statusTimer = undefined;
      }
      if (this.connectionTimer) {
        this.clearTimeout(this.connectionTimer);
        this.connectionTimer = undefined;
      }
      // Close connections, clean up resources
      callback();
    } catch (e) {
      callback();
    }
  }
}
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

**MPD Adapter Specific Considerations:**
- Test MPD connection with different server configurations
- Test graceful handling of MPD server disconnections
- Verify proper cleanup of resources when adapter stops
- Test playback control commands and status updates
- Use mock MPD responses for consistent testing