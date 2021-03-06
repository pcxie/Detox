const _ = require('lodash');
const configurationsMock = require('../configuration/configurations.mock');

const validScheme = configurationsMock.validOneDeviceAndSession;
const invalidDeviceNoBinary = configurationsMock.invalidDeviceNoBinary;

describe('Device', () => {
  let fs;
  let DeviceDriverBase;
  let SimulatorDriver;
  let emitter;
  let Device;
  let argparse;
  let Client;
  let client;
  let driverMock;

  beforeEach(async () => {
    jest.mock('fs');
    jest.mock('../utils/logger');
    jest.mock('../utils/trace');

    fs = require('fs');

    jest.mock('../utils/argparse');
    argparse = require('../utils/argparse');

    jest.mock('./drivers/DeviceDriverBase');
    DeviceDriverBase = require('./drivers/DeviceDriverBase');

    SimulatorDriver = require('./drivers/ios/SimulatorDriver');

    jest.mock('../client/Client');
    Client = require('../client/Client');

    jest.mock('../utils/AsyncEmitter');
    const AsyncEmitter = require('../utils/AsyncEmitter');
    emitter = new AsyncEmitter({});

    Device = require('./Device');
  });

  beforeEach(async () => {
    fs.existsSync.mockReturnValue(true);

    client = new Client(validScheme.session);
    await client.connect();

    driverMock = new DeviceDriverMock();
  });

  class DeviceDriverMock {
    constructor() {
      this.driver = new DeviceDriverBase({
        client,
        emitter,
      });
    }

    expectLaunchCalled(device, expectedArgs, languageAndLocale) {
      expect(this.driver.launchApp).toHaveBeenCalledWith(device._deviceId, device._bundleId, expectedArgs, languageAndLocale);
    }

    expectLaunchCalledContainingArgs(device, expectedArgs) {
      expect(this.driver.launchApp).toHaveBeenCalledWith(
        device._deviceId,
        device._bundleId,
        expect.objectContaining(expectedArgs),
        undefined);
    }

    expectLaunchCalledWithLaunchArg(key, value) {
      const launchArgs = this.driver.launchApp.mock.calls[0][2];
      expect(launchArgs[key]).toEqual(value);
    }

    expectLaunchCalledWithoutLaunchArg(argKey) {
      const launchArgs = this.driver.launchApp.mock.calls[0][2];
      expect(launchArgs).not.toHaveProperty(argKey);
    }

    expectWaitForLaunchCalled(device, expectedArgs, languageAndLocale) {
      expect(this.driver.waitForAppLaunch).toHaveBeenCalledWith(device._deviceId, device._bundleId, expectedArgs, languageAndLocale);
    }

    expectReinstallCalled() {
      expect(this.driver.uninstallApp).toHaveBeenCalled();
      expect(this.driver.installApp).toHaveBeenCalled();
    }

    expectReinstallNotCalled() {
      expect(this.driver.uninstallApp).not.toHaveBeenCalled();
      expect(this.driver.installApp).not.toHaveBeenCalled();
    }

    expectTerminateCalled() {
      expect(this.driver.terminate).toHaveBeenCalled();
    }

    expectTerminateNotCalled() {
      expect(this.driver.terminate).not.toHaveBeenCalled();
    }

    expectReverseTcpPortCalled(deviceId, port) {
      expect(this.driver.reverseTcpPort).toHaveBeenCalledWith(deviceId, port);
    }

    expectUnreverseTcpPortCalled(deviceId, port) {
      expect(this.driver.unreverseTcpPort).toHaveBeenCalledWith(deviceId, port);
    }
  }

  function schemeDevice(scheme, configuration, overrides) {
    const device = new Device(_.merge({
      behaviorConfig: {},
      deviceConfig: scheme.configurations[configuration],
      deviceDriver: driverMock.driver,
      sessionConfig: scheme.session,
      emitter,
    }, overrides));

    device.deviceDriver.acquireFreeDevice.mockReturnValue('mockDeviceId');

    return device;
  }

  function validDevice(overrides) {
    return schemeDevice(validScheme, 'ios.sim.release', overrides);
  }

  it('should return the name from the driver', async () => {
    driverMock.driver.name = 'mock-device-name-from-driver';

    const device = validDevice();
    expect(device.name).toEqual('mock-device-name-from-driver');
  });

  it('should return the type from the configuration', async () => {
    const device = validDevice();
    expect(device.type).toEqual('ios.simulator');
  });

  it('should return an undefined ID for an unprepared device', async() => {
    const device = validDevice();
    expect(device.id).toBeUndefined();
  });

  it('should return the device ID, as provided by acquireFreeDevice', async () => {
    const device = validDevice();
    await device.prepare();
    expect(device.id).toEqual('mockDeviceId');
  });

  describe('re/launchApp()', () => {
    const expectedDriverArgs = {
      "detoxServer": "ws://localhost:8099",
      "detoxSessionId": "test",
    };

    it(`with no args should launch app with defaults`, async () => {
      const expectedArgs = expectedDriverArgs;
      const device = validDevice();
      await device.launchApp();

      driverMock.expectLaunchCalled(device, expectedArgs);
    });

    it(`given behaviorConfig.launchApp == 'manual' should wait for the app launch`, async () => {
      const expectedArgs = expectedDriverArgs;
      const device = validDevice({
        behaviorConfig: { launchApp: 'manual' }
      });
      await device.launchApp();

      expect(driverMock.driver.launchApp).not.toHaveBeenCalled();
      driverMock.expectWaitForLaunchCalled(device, expectedArgs);
    });

    it(`args should launch app and emit appReady`, async () => {
      driverMock.driver.launchApp = async () => 42;

      const device = validDevice();
      await device.launchApp();

      expect(emitter.emit).toHaveBeenCalledWith('appReady', {
        deviceId: device._deviceId,
        bundleId: device._bundleId,
        pid: 42,
      })
    });

    it(`(relaunch) with no args should use defaults`, async () => {
      const expectedArgs = expectedDriverArgs;
      const device = validDevice();

      await device.relaunchApp();

      driverMock.expectLaunchCalled(device, expectedArgs);
    });

    it(`(relaunch) with no args should terminate the app before launch - backwards compat`, async () => {
      const device = validDevice();

      await device.relaunchApp();

      driverMock.expectTerminateCalled();
    });

    it(`(relaunch) with newInstance=false should not terminate the app before launch`, async () => {
      const device = validDevice();

      await device.relaunchApp({newInstance: false});

      driverMock.expectTerminateNotCalled();
    });

    it(`(relaunch) with newInstance=true should terminate the app before launch`, async () => {
      const device = validDevice();

      await device.relaunchApp({newInstance: true});

      driverMock.expectTerminateCalled();
    });

    it(`(relaunch) with delete=true`, async () => {
      const expectedArgs = expectedDriverArgs;
      const device = validDevice();

      await device.relaunchApp({delete: true});

      driverMock.expectReinstallCalled();
      driverMock.expectLaunchCalled(device, expectedArgs);
    });

    it(`(relaunch) with delete=false when reuse is enabled should not uninstall and install`, async () => {
      const expectedArgs = expectedDriverArgs;
      const device = validDevice();
      argparse.getArgValue.mockReturnValue(true);

      await device.relaunchApp();

      driverMock.expectReinstallNotCalled();
      driverMock.expectLaunchCalled(device, expectedArgs);
    });

    it(`(relaunch) with url should send the url as a param in launchParams`, async () => {
      const expectedArgs = {...expectedDriverArgs, "detoxURLOverride": "scheme://some.url"};
      const device = await validDevice();

      await device.relaunchApp({url: `scheme://some.url`});

      driverMock.expectLaunchCalled(device, expectedArgs);
    });

    it(`(relaunch) with url should send the url as a param in launchParams`, async () => {
      const expectedArgs = {
        ...expectedDriverArgs,
        "detoxURLOverride": "scheme://some.url",
        "detoxSourceAppOverride": "sourceAppBundleId",
      };
      const device = await validDevice();
      await device.relaunchApp({url: `scheme://some.url`, sourceApp: 'sourceAppBundleId'});

      driverMock.expectLaunchCalled(device, expectedArgs);
    });

    it(`(relaunch) with userNofitication should send the userNotification as a param in launchParams`, async () => {
      const expectedArgs = {
        ...expectedDriverArgs,
        "detoxUserNotificationDataURL": "url",
      };
      const device = validDevice();

      device.deviceDriver.createPayloadFile = jest.fn(() => 'url');

      await device.relaunchApp({userNotification: 'json'});

      driverMock.expectLaunchCalled(device, expectedArgs);
    });

    it(`(relaunch) with url and userNofitication should throw`, async () => {
      const device = validDevice();
      try {
        await device.relaunchApp({url: "scheme://some.url", userNotification: 'notif'});
        fail('should fail');
      } catch (ex) {
        expect(ex).toBeDefined();
      }
    });

    it(`(relaunch) with permissions should send trigger setpermissions before app starts`, async () => {
      const device = await validDevice();
      await device.relaunchApp({permissions: {calendar: "YES"}});

      expect(driverMock.driver.setPermissions).toHaveBeenCalledWith(device._deviceId, device._bundleId, {calendar: "YES"});
    });

    it('with languageAndLocale should launch app with a specific language/locale', async () => {
      const expectedArgs = expectedDriverArgs;
      const device = validDevice();

      const languageAndLocale = {
        language: 'es-MX',
        locale: 'es-MX'
      };

      await device.launchApp({languageAndLocale});

      driverMock.expectLaunchCalled(device, expectedArgs, languageAndLocale);
    });

    it(`with disableTouchIndicators should send a boolean switch as a param in launchParams`, async () => {
      const expectedArgs = {...expectedDriverArgs, "detoxDisableTouchIndicators": true};
      const device = await validDevice();

      await device.launchApp({disableTouchIndicators: true});

      driverMock.expectLaunchCalled(device, expectedArgs);
    });

    it(`with newInstance=false should check if process is in background and reopen it`, async () => {
      const processId = 1;
      const device = validDevice();

      device.deviceDriver.getBundleIdFromBinary.mockReturnValue('test.bundle');
      device.deviceDriver.launchApp.mockReturnValue(processId);

      await device.prepare();
      await device.launchApp({newInstance: true});
      await device.launchApp({newInstance: false});

      expect(driverMock.driver.deliverPayload).not.toHaveBeenCalled();
    });

    it(`with a url should check if process is in background and use openURL() instead of launch args`, async () => {
      const processId = 1;
      const device = validDevice();
      device.deviceDriver.getBundleIdFromBinary.mockReturnValue('test.bundle');
      device.deviceDriver.launchApp.mockReturnValue(processId);

      await device.prepare();
      await device.launchApp({newInstance: true});
      await device.launchApp({url: 'url://me'});

      expect(driverMock.driver.deliverPayload).toHaveBeenCalledTimes(1);
    });

    it(`with a url should check if process is in background and if not use launch args`, async () => {
      const launchParams = {url: 'url://me'};
      const processId = 1;
      const newProcessId = 2;

      const device = validDevice();
      device.deviceDriver.getBundleIdFromBinary.mockReturnValue('test.bundle');
      device.deviceDriver.launchApp.mockReturnValueOnce(processId).mockReturnValueOnce(newProcessId);

      await device.prepare();
      await device.launchApp(launchParams);

      expect(driverMock.driver.deliverPayload).not.toHaveBeenCalled();
    });

    it(`with a url should check if process is in background and use openURL() instead of launch args`, async () => {
      const launchParams = {url: 'url://me'};
      const processId = 1;

      const device = validDevice();
      device.deviceDriver.getBundleIdFromBinary.mockReturnValue('test.bundle');
      device.deviceDriver.launchApp.mockReturnValue(processId);

      await device.prepare();
      await device.launchApp({newInstance: true});
      await device.launchApp(launchParams);

      expect(driverMock.driver.deliverPayload).toHaveBeenCalledWith({delayPayload: true, url: 'url://me'});
    });

    it('with userActivity should check if process is in background and if it is use deliverPayload', async () => {
      const launchParams = {userActivity: 'userActivity'};
      const processId = 1;

      const device = validDevice();
      device.deviceDriver.getBundleIdFromBinary.mockReturnValue('test.bundle');
      device.deviceDriver.launchApp.mockReturnValueOnce(processId).mockReturnValueOnce(processId);
      device.deviceDriver.createPayloadFile = () => 'url';

      await device.prepare();
      await device.launchApp({newInstance: true});
      await device.launchApp(launchParams);

      expect(driverMock.driver.deliverPayload).toHaveBeenCalledWith({delayPayload: true, detoxUserActivityDataURL: 'url'});
    });


    it('with userNotification should check if process is in background and if it is use deliverPayload', async () => {
      const launchParams = {userNotification: 'notification'};
      const processId = 1;

      const device = validDevice();
      device.deviceDriver.getBundleIdFromBinary.mockReturnValue('test.bundle');
      device.deviceDriver.launchApp.mockReturnValueOnce(processId).mockReturnValueOnce(processId);
      device.deviceDriver.createPayloadFile = () => 'url';

      await device.prepare();
      await device.launchApp({newInstance: true});
      await device.launchApp(launchParams);

      expect(driverMock.driver.deliverPayload).toHaveBeenCalledTimes(1);
    });

    it(`with userNotification should check if process is in background and if not use launch args`, async () => {
      const launchParams = {userNotification: 'notification'};
      const processId = 1;
      const newProcessId = 2;

      const device = validDevice();
      device.deviceDriver.getBundleIdFromBinary.mockReturnValue('test.bundle');
      device.deviceDriver.launchApp.mockReturnValueOnce(processId).mockReturnValueOnce(newProcessId);

      await device.prepare();
      await device.launchApp(launchParams);

      expect(driverMock.driver.deliverPayload).not.toHaveBeenCalled();
    });

    it(`with userNotification and url should fail`, async () => {
      const launchParams = {userNotification: 'notification', url: 'url://me'};
      const processId = 1;
      driverMock.driver.getBundleIdFromBinary.mockReturnValue('test.bundle');
      driverMock.driver.launchApp.mockReturnValueOnce(processId).mockReturnValueOnce(processId);

      const device = validDevice();

      await device.prepare();

      try {
        await device.launchApp(launchParams);
        fail('should throw');
      } catch (ex) {
        expect(ex).toBeDefined();
      }

      expect(device.deviceDriver.deliverPayload).not.toHaveBeenCalled();
    });

    describe('with user launchArgs', () => {
      it('should pass on-site launch-args to device via driver', async () => {
        const launchArgs = {
          arg1: "1",
          arg2: 2,
        };
        const expectedArgs = {
          "detoxServer": "ws://localhost:8099",
          "detoxSessionId": "test",
          "arg1": "1",
          "arg2": 2,
        };

        const device = validDevice();
        await device.launchApp({launchArgs});

        driverMock.expectLaunchCalled(device, expectedArgs);
      });

      it('should keep args unmodified', async () => {
        const params = {
          url: 'some.url',
          launchArgs: {
            some: 'userArg',
          }
        };
        const paramsClone = _.cloneDeep(params);

        const device = validDevice();
        await device.launchApp(params);

        expect(params).toEqual(paramsClone);
      });

      it('should allow for pre-baked launch-args setup using device.setLaunchArg()', async () => {
        const params = {
          launchArgs: {
            some: 'onsiteArg',
          }
        };
        const prebakedArg = {
          key: 'prebakedArgKey',
          value: {
            prebakedArg: 'value',
          },
        };
        const expectedArgs = {
          some: 'onsiteArg',
          [prebakedArg.key]: prebakedArg.value,
        };

        const device = validDevice();
        device.setLaunchArg(prebakedArg.key, prebakedArg.value);
        await device.launchApp(params);

        driverMock.expectLaunchCalledContainingArgs(device, expectedArgs);
      });

      it('should give priority to on-site launch-args over pre-baked launch-args', async () => {
        const params = {
          launchArgs: {
            aLaunchArg: 'aValue?',
          }
        };
        const prebakedArg = {
          key: 'aLaunchArg',
          value: 'aValue!',
        };
        const expectedArgs = params.launchArgs;

        const device = validDevice();
        device.setLaunchArg(prebakedArg.key, prebakedArg.value);
        await device.launchApp(params);

        driverMock.expectLaunchCalledContainingArgs(device, expectedArgs);
      });
    });

    it('should allow for explicit clearing of prebaked launch-args', async () => {
      const prebakedArg1 = {
        key: 'arg1',
        value: 'value1',
      };
      const prebakedArg2 = {
        key: 'arg2',
        value: 'value2',
      };

      const device = validDevice();
      device.setLaunchArg(prebakedArg1.key, prebakedArg1.value);
      device.setLaunchArg(prebakedArg2.key, prebakedArg2.value);
      device.clearLaunchArg(prebakedArg1.key);
      await device.launchApp();

      driverMock.expectLaunchCalledWithLaunchArg(prebakedArg2.key, prebakedArg2.value);
      driverMock.expectLaunchCalledWithoutLaunchArg(prebakedArg1.key);
    });

    it('should allow for implicit clearing of prebaked launch-args', async () => {
      const prebakedArg1 = {
        key: 'arg1',
        value: 'value1',
      };
      const prebakedArg2 = {
        key: 'arg2',
        value: 'value2',
      };

      const device = validDevice();
      device.setLaunchArg(prebakedArg1.key, prebakedArg1.value);
      device.setLaunchArg(prebakedArg2.key, prebakedArg2.value);
      device.setLaunchArg(prebakedArg1.key, undefined);
      await device.launchApp();

      driverMock.expectLaunchCalledWithLaunchArg(prebakedArg2.key, prebakedArg2.value);
      driverMock.expectLaunchCalledWithoutLaunchArg(prebakedArg1.key);
    });
  });

  describe('installApp()', () => {
    it(`with a custom app path should use custom app path`, async () => {
      const device = validDevice();
      await device.installApp('newAppPath');
      expect(driverMock.driver.installApp).toHaveBeenCalledWith(device._deviceId, 'newAppPath', device._deviceConfig.testBinaryPath);
    });

    it(`with a custom test app path should use custom test app path`, async () => {
      const device = validDevice();
      await device.installApp('newAppPath', 'newTestAppPath');
      expect(driverMock.driver.installApp).toHaveBeenCalledWith(device._deviceId, 'newAppPath', 'newTestAppPath');
    });

    it(`with no args should use the default path given in configuration`, async () => {
      const device = validDevice();
      await device.installApp();
      expect(driverMock.driver.installApp).toHaveBeenCalledWith(device._deviceId, device._deviceConfig.binaryPath, device._deviceConfig.testBinaryPath);
    });
  });

  describe('uninstallApp()', () => {
    it(`with a custom app path should use custom app path`, async () => {
      const device = validDevice();
      await device.uninstallApp('newBundleId');
      expect(driverMock.driver.uninstallApp).toHaveBeenCalledWith(device._deviceId, 'newBundleId');
    });

    it(`with no args should use the default path given in configuration`, async () => {
      const device = validDevice();
      await device.uninstallApp();
      expect(driverMock.driver.uninstallApp).toHaveBeenCalledWith(device._deviceId, device._bundleId);
    });
  });

  describe('installBinary()', () => {
    const configurationName = 'android.emu.release';
    const scheme = configurationsMock.validOneAndroidDevice;

    it('should install the set of util binaries', async () => {
      const device = schemeDevice(scheme, configurationName);
      await device.installUtilBinaries();
      expect(driverMock.driver.installUtilBinaries).toHaveBeenCalledWith(
        device._deviceId,
        scheme.configurations[configurationName].utilBinaryPaths
      );
    });

    it('should break if driver installation fails', async () => {
      driverMock.driver.installUtilBinaries.mockRejectedValue(new Error());
      const device = schemeDevice(scheme, configurationName);
      try {
        await device.installUtilBinaries();
        fail('');
      } catch (e) {}
    });

    it('should not install anything if util-binaries havent been configured', async () => {
      const _scheme = _.cloneDeep(scheme);
      delete _scheme.configurations[configurationName].utilBinaryPaths;

      const device = schemeDevice(_scheme, configurationName);
      await device.installUtilBinaries();
      expect(driverMock.driver.installUtilBinaries).not.toHaveBeenCalled();
    });
  });

  it(`sendToHome() should pass to device driver`, async () => {
    const device = validDevice();
    await device.sendToHome();

    expect(driverMock.driver.sendToHome).toHaveBeenCalledTimes(1);
  });

  it(`setBiometricEnrollment(true) should pass YES to device driver`, async () => {
    const device = validDevice();
    await device.setBiometricEnrollment(true);

    expect(driverMock.driver.setBiometricEnrollment).toHaveBeenCalledWith(device._deviceId, 'YES');
    expect(driverMock.driver.setBiometricEnrollment).toHaveBeenCalledTimes(1);
  });

  it(`setBiometricEnrollment(false) should pass NO to device driver`, async () => {
    const device = validDevice();
    await device.setBiometricEnrollment(false);

    expect(driverMock.driver.setBiometricEnrollment).toHaveBeenCalledWith(device._deviceId, 'NO');
    expect(driverMock.driver.setBiometricEnrollment).toHaveBeenCalledTimes(1);
  });

  it(`matchFace() should pass to device driver`, async () => {
    const device = validDevice();
    await device.matchFace();

    expect(driverMock.driver.matchFace).toHaveBeenCalledTimes(1);
  });

  it(`unmatchFace() should pass to device driver`, async () => {
    const device = validDevice();
    await device.unmatchFace();

    expect(driverMock.driver.unmatchFace).toHaveBeenCalledTimes(1);
  });

  it(`matchFinger() should pass to device driver`, async () => {
    const device = validDevice();
    await device.matchFinger();

    expect(driverMock.driver.matchFinger).toHaveBeenCalledTimes(1);
  });

  it(`unmatchFinger() should pass to device driver`, async () => {
    const device = validDevice();
    await device.unmatchFinger();

    expect(driverMock.driver.unmatchFinger).toHaveBeenCalledTimes(1);
  });

  it(`setStatusBar() should pass to device driver`, async () => {
    const device = validDevice();
    const params = {};
    await device.setStatusBar(params);

    expect(driverMock.driver.setStatusBar).toHaveBeenCalledWith(device._deviceId, params);
  });

  it(`resetStatusBar() should pass to device driver`, async () => {
    const device = validDevice();
    await device.resetStatusBar();

    expect(driverMock.driver.resetStatusBar).toHaveBeenCalledWith(device._deviceId);
  });

  it(`shake() should pass to device driver`, async () => {
    const device = validDevice();
    await device.shake();

    expect(driverMock.driver.shake).toHaveBeenCalledTimes(1);
  });

  it(`terminateApp() should pass to device driver`, async () => {
    const device = validDevice();
    await device.terminateApp();

    expect(driverMock.driver.terminate).toHaveBeenCalledTimes(1);
  });

  it(`shutdown() should pass to device driver`, async () => {
    const device = validDevice();
    await device.shutdown();

    expect(driverMock.driver.shutdown).toHaveBeenCalledTimes(1);
  });

  it(`openURL({url:url}) should pass to device driver`, async () => {
    const device = validDevice();
    await device.openURL({url: 'url'});

    expect(driverMock.driver.deliverPayload).toHaveBeenCalledWith({url: 'url'}, device._deviceId);
  });

  it(`openURL(notAnObject) should pass to device driver`, async () => {
    const device = validDevice();
    try {
      await device.openURL('url');
      fail('should throw');
    } catch (ex) {
      expect(ex).toBeDefined();
    }
  });

  it(`reloadReactNative() should pass to device driver`, async () => {
    const device = validDevice();
    await device.reloadReactNative();

    expect(driverMock.driver.reloadReactNative).toHaveBeenCalledTimes(1);
  });

  it(`setOrientation() should pass to device driver`, async () => {
    const device = validDevice();
    await device.setOrientation('param');

    expect(driverMock.driver.setOrientation).toHaveBeenCalledWith(device._deviceId, 'param');
  });

  it(`sendUserNotification() should pass to device driver`, async () => {
    const device = validDevice();
    await device.sendUserNotification('notif');

    expect(driverMock.driver.createPayloadFile).toHaveBeenCalledTimes(1);
    expect(driverMock.driver.deliverPayload).toHaveBeenCalledTimes(1);
  });

  it(`sendUserActivity() should pass to device driver`, async () => {
    const device = validDevice();
    await device.sendUserActivity('notif');

    expect(driverMock.driver.createPayloadFile).toHaveBeenCalledTimes(1);
    expect(driverMock.driver.deliverPayload).toHaveBeenCalledTimes(1);
  });

  it(`setLocation() should pass to device driver`, async () => {
    const device = validDevice();
    await device.setLocation(30.1, 30.2);

    expect(driverMock.driver.setLocation).toHaveBeenCalledWith(device._deviceId, '30.1', '30.2');
  });

  it(`reverseTcpPort should pass to device driver`, async () => {
    const device = validDevice();
    await device.reverseTcpPort(666);

    await driverMock.expectReverseTcpPortCalled(device._deviceId, 666);
  });

  it(`unreverseTcpPort should pass to device driver`, async () => {
    const device = validDevice();
    await device.unreverseTcpPort(777);

    await driverMock.expectUnreverseTcpPortCalled(device._deviceId, 777);
  });

  it(`setURLBlacklist() should pass to device driver`, async () => {
    const device = validDevice();
    await device.setURLBlacklist();

    expect(driverMock.driver.setURLBlacklist).toHaveBeenCalledTimes(1);
  });

  it(`enableSynchronization() should pass to device driver`, async () => {
    const device = validDevice();
    await device.enableSynchronization();

    expect(driverMock.driver.enableSynchronization).toHaveBeenCalledTimes(1);
  });

  it(`disableSynchronization() should pass to device driver`, async () => {
    const device = validDevice();
    await device.disableSynchronization();

    expect(driverMock.driver.disableSynchronization).toHaveBeenCalledTimes(1);
  });

  it(`resetContentAndSettings() should pass to device driver`, async () => {
    const device = validDevice();
    await device.resetContentAndSettings();

    expect(driverMock.driver.resetContentAndSettings).toHaveBeenCalledTimes(1);
  });

  it(`getPlatform() should pass to device driver`, async () => {
    const device = validDevice();
    device.getPlatform();

    expect(driverMock.driver.getPlatform).toHaveBeenCalledTimes(1);
  });

  it(`_cleanup() should pass to device driver`, async () => {
    const device = validDevice();
    await device._cleanup();

    expect(driverMock.driver.cleanup).toHaveBeenCalledTimes(1);
  });

  it(`new Device() with invalid device config (no binary) should throw`, () => {
    // TODO: this is an invalid test, because it will pass only on SimulatorDriver
    expect(() => new Device({
      deviceConfig: invalidDeviceNoBinary.configurations['ios.sim.release'],
      deviceDriver: new SimulatorDriver(client),
      sessionConfig: validScheme.session,
      emitter,
    })).toThrowError(/binaryPath.* is missing/);
  });

  it(`should accept absolute path for binary`, async () => {
    const actualPath = await launchAndTestBinaryPath('absolutePath');
    expect(actualPath).toEqual(process.platform === 'win32' ? 'C:\\Temp\\abcdef\\123' : '/tmp/abcdef/123');
  });

  it(`should accept relative path for binary`, async () => {
    const actualPath = await launchAndTestBinaryPath('relativePath');
    expect(actualPath).toEqual('abcdef/123');
  });

  it(`pressBack() should invoke driver's pressBack()`, async () => {
    const device = validDevice();

    await device.pressBack();

    expect(driverMock.driver.pressBack).toHaveBeenCalledWith(device._deviceId);
  });

  it(`clearKeychain() should invoke driver's clearKeychain()`, async () => {
    const device = validDevice();

    await device.clearKeychain();

    expect(driverMock.driver.clearKeychain).toHaveBeenCalledWith(device._deviceId);
  });

  describe('get ui device', () => {
    it(`getUiDevice should invoke driver's getUiDevice`, async () => {
      const device = validDevice();

      await device.getUiDevice();

      expect(driverMock.driver.getUiDevice).toHaveBeenCalled();
    });

    it('should call return UiDevice when call getUiDevice', async () => {
      const uiDevice = {
        uidevice: true,
      };

      const device = validDevice();
      driverMock.driver.getUiDevice = () =>  uiDevice;

      const result = await device.getUiDevice();

      expect(result).toEqual(uiDevice);
    })
  });

  it('takeScreenshot(name) should throw an exception if given name is empty', async () => {
    await expect(validDevice().takeScreenshot()).rejects.toThrowError(/empty name/);
  });

  it('takeScreenshot(name) should delegate the work to the driver', async () => {
    device = validDevice();

    await device.takeScreenshot('name');
    expect(device.deviceDriver.takeScreenshot).toHaveBeenCalledWith(device._deviceId, 'name');
  });

  it('captureViewHierarchy(name) should delegate the work to the driver', async () => {
    device = validDevice();

    await device.captureViewHierarchy('name');
    expect(device.deviceDriver.captureViewHierarchy).toHaveBeenCalledWith(device._deviceId, 'name');
  });

  it('captureViewHierarchy([name]) should set name = "capture" by default', async () => {
    device = validDevice();

    await device.captureViewHierarchy();
    expect(device.deviceDriver.captureViewHierarchy).toHaveBeenCalledWith(device._deviceId, 'capture');
  });

  async function launchAndTestBinaryPath(configuration) {
    const device = schemeDevice(configurationsMock.pathsTests, configuration);

    await device.prepare();
    await device.installApp();

    return driverMock.driver.installApp.mock.calls[0][1];
  }
});
