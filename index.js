'use strict';

let PlatformAccessory, Accessory, Service, Characteristic, UUIDGen;

const format = require('string-format');
const axios = require('axios');
const logUtil = require('./utils/log');
const configUtil = require('./utils/config');

const pluginName = 'homebridge-petkit-feeder-mini';
const platformName = 'petkit_feeder_mini';

const globalVariables = Object.freeze({
    'default_headers': {
        'X-Client': 'ios(14.0;iPhone12,3)',
        'Accept': '*/*',
        'X-Timezone': '0.0',
        'Accept-Language': 'en-US;q=1, zh-Hans-US;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'X-Api-Version': '7.18.1',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'PETKIT/7.18.1 (iPhone; iOS 14.0; Scale/3.00)',
        'X-TimezoneId': 'Asia/Shanghai',
        'X-Locale': 'en_US'
    },
    'default_accessoryData': {
        'accessory': undefined,
        'config' : undefined,
        'status': {
            'food' : 0,
            'batteryPower': 0,
            'batteryStatus': 1,
            'desiccantLeftDays' : 0,
            'manualLock': 0,
            'lightMode': 0,
            'meals': {}
        },
        'savedData': undefined
    },
    'support_settings': {
        'manualLock' : 'settings.manualLock',      // 1 for off, 0 for on
        'lightMode' : 'settings.lightMode',
    },
    'global_urls': {
        'cn': {
            'owndevices': 'http://api.petkit.cn/6/discovery/device_roster',
            'deviceState': 'http://api.petkit.cn/6/feedermini/devicestate?id={}',
            'deviceInfo': 'http://api.petkit.cn/6/feedermini/device_detail?id={}',
            'saveDailyFeed': 'http://api.petkit.cn/6/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
            'removeDailyFeed': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
            'dailyfeeds': 'http://api.petkit.cn/6/feedermini/dailyfeeds?deviceId={}&days={}',
            'restoreDailyFeeds': 'http://api.petkit.cn/6/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
            'disableDailyFeeds': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
            'resetDesiccant': 'http://api.petkit.cn/6/feedermini/desiccant_reset?deviceId={}',
            'updateSettings': 'http://api.petkit.cn/6/feedermini/update?id={}&kv={}',
        },
        'asia':{
            'owndevices': 'http://api.petktasia.com/latest/discovery/device_roster',
            'deviceState': 'http://api.petktasia.com/latest/feedermini/devicestate?id={}',
            'deviceInfo': 'http://api.petktasia.com/latest/feedermini/device_detail?id={}',
            'saveDailyFeed': 'http://api.petktasia.com/latest/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
            'removeDailyFeed': 'http://api.petktasia.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
            'dailyfeeds': 'http://api.petktasia.com/latest/feedermini/dailyfeeds?deviceId={}&days={}',
            'restoreDailyFeeds': 'http://api.petktasia.com/latest/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
            'disableDailyFeeds': 'http://api.petktasia.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
            'resetDesiccant': 'http://api.petktasia.com/latest/feedermini/desiccant_reset?deviceId={}',
            'updateSettings': 'http://api.petktasia.com/latest/feedermini/update?id={}&kv={}',
        },
        'north_america':{
            'owndevices': 'http://api.petkt.com/latest/discovery/device_roster',
            'deviceState': 'http://api.petkt.com/latest/feedermini/devicestate?id={}',
            'deviceInfo': 'http://api.petkt.com/latest/feedermini/device_detail?id={}',
            'saveDailyFeed': 'http://api.petkt.com/latest/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
            'removeDailyFeed': 'http://api.petkt.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
            'dailyfeeds': 'http://api.petkt.com/latest/feedermini/dailyfeeds?deviceId={}&days={}',
            'restoreDailyFeeds': 'http://api.petkt.com/latest/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
            'disableDailyFeeds': 'http://api.petkt.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
            'resetDesiccant': 'http://api.petkt.com/latest/feedermini/desiccant_reset?deviceId={}',
            'updateSettings': 'http://api.petkt.com/latest/feedermini/update?id={}&kv={}',
        }
    },
    'min_amount': 0,                   // in meal(same in app)
    'max_amount': 10,                  // in meal(same in app)
    'min_desiccantLeftDays': 0,        // in day
    'max_desiccantLeftDays': 30,       // in day
    'min_batteryLevel': 0,             // level(same in app)
    'max_batteryLevel': 4,             // level(same in app)
    'min_pollint_interval': 60,        // in second
    'max_pollint_interval': 3600,      // in second
    'min_fetch_status_interval': 10,   // in second
});

class petkit_feeder_mini_plugin {
    constructor(log, config, api) {
        this.log = new logUtil(log, config.log_level || logUtil.LOGLV_INFO);
        this.log.info('begin to initialize petkit feeder platform.');

        if (!api) {
            this.log.error("Homebridge's version is too old, please upgrade!");
            return;
        }

        if (!config) {
            this.log.warn("no configure found for petkit feeder device.");
            return;
        }

        this.api = api;
        this.accessories = new Map();

        // When this event is fired, homebridge restored all cached accessories from disk and did call their respective
        // `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
        // after this event was fired, in order to ensure they weren't added to homebridge already.
        // This event can also be used to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            // check config usability
            config.devices.forEach((device_config) => {
                // probably parse config or something here
                const config = this.configCheck(device_config);
                if (config) {
                    this.initializeAccessory(config);
                }
            });
        });

        this.log.info('petkit feeder platform loaded successfully.');
    }

    // check and modify configure value
    // @prama config: config Object from config.json
    // @return: if success return instance of configUtil or failed return undefined;
    configCheck(config) {
        const fulfill_headerset = (headers, key, value) => {
            let header = headers.find(header => header.key === key);
            if (undefined === header) {
                this.log.warn(format('missing header: {0}(note: case sensitive), using \'{1}\' instead.', key, value));
                headers.push({'key': key, 'value': value});
            }
        };

        const conf = new configUtil(config);
        // required configure items
        let config_headers = conf.get('headers');
        if (!config_headers) {
            this.log.error('missing dataset: headers in your config.');
            return undefined;
        }

        let header_x_session = config_headers.find(header => header.key === 'X-Session');
        if (undefined === header_x_session) {
            this.log.error('missing header in your headers: X-Session(note: case sensitive).');
            return undefined;
        }

        let location = conf.get('location');
        if (!location) {
            this.log.error('missing dataset: location in your config.');
            return undefined;
        } else {
            const validLocations = Object.keys(globalVariables.global_urls);
            if (!conf.checkValueValid('location', validLocations)) {
                this.log.error(format('value of location({0}) should be one of {1}', location, JSON.stringify(validLocations)));
                return undefined;
            }
        }

        for (const [key, value] of Object.entries(globalVariables.default_headers)) {
            fulfill_headerset(config_headers, key, value);
        }

        // convert header format
        let http_headers = {};
        config_headers.forEach((header) => {
            http_headers[header.key] = header.value;
        });
        conf.set('headers', http_headers)

        // urls
        conf.set('urls', globalVariables.global_urls[location]);

        // optional configure items
        conf.fulfill('name', 'PetkitFeederMini');
        conf.fulfill('autoDeviceInfo', false);
        conf.fulfill('sn', 'PetkitFeederMini');
        conf.fulfill('firmware', '1.0.0')
        conf.fulfill('manufacturer', 'Petkit');
        conf.fulfill('model', 'Petkit feeder mini');
        conf.fulfill('enable_polling', true);

        const polling_interval = conf.get('polling_interval');
        if (polling_interval < globalVariables.min_pollint_interval) {
            this.log.warn(format('value of polling_interval({0}) should great than {1}, now using {1} instead', polling_interval, globalVariables.min_pollint_interval));
            conf.set('polling_interval', globalVariables.min_pollint_interval);
        } else if (polling_interval > globalVariables.max_pollint_interval) {
            this.log.warn(format('value of polling_interval({0}) should smaller than {1}, now using {1} instead', polling_interval, globalVariables.max_pollint_interval));
            conf.set('polling_interval', globalVariables.max_pollint_interval);
        }

        conf.fulfill('enable_manualLock', false);
        conf.fulfill('enable_lightMode', false);
        conf.fulfill('reverse_foodStorage_indicator', false);
        conf.fulfill('fast_response', false);

        // service name field
        conf.fulfill('DropMeal_name', 'DropMeal');
        conf.fulfill('DropMeal_name', 'MealAmount');
        conf.fulfill('FoodStorage_name', (conf.get('reverse_foodStorage_indicator') ? 'FoodStorage_Empty' : 'FoodStorage'));
        conf.fulfill('DesiccantLevel_name', 'DesiccantLevel');
        conf.fulfill('ManualLock_name', 'ManualLock');
        conf.fulfill('LightMode_name', 'LightMode');
        conf.fulfill('Battery_name', 'Battery');

        return conf;
    }

    // REQUIRED - Homebridge will call the "configureAccessory" method once for every cached accessory restored
    // This function is invoked when homebridge restores cached accessories from disk at startup.
    // It should be used to setup event handlers for characteristics and update respective values.
    configureAccessory(accessory) {
        this.log.info('Configuring cached accessory: [' + accessory.displayName + ']  ' + accessory.UUID);
        const accessoryData = Object.assign(globalVariables.default_accessoryData, {
            'accessory': accessory,
        });
        this.accessories.set(accessory.UUID, accessoryData);
    }

    // setup accessory's service include handlers,value
    // @return: if success return true or failed return false;
    setupAccessory(accessoryData) {
        let accessory = accessoryData.accessory;
        let config = accessoryData.config;  // instance of configUtil
        let service_name = undefined;

        // setup meal drop service
        if (true) {
            service_name = config.get('DropMeal_name');
            let drop_meal_service = accessory.getService(service_name);
            if (!drop_meal_service) {
                // service not exist, create service
                drop_meal_service = accessory.addService(Service.Switch, service_name, service_name);
                if (!drop_meal_service) {
                    this.log.error('petkit device service create failed: drop_meal_service');
                    return false;
                }
            }

            drop_meal_service.getCharacteristic(Characteristic.On)
                .on('get', (callback) => callback(null, 0))
                .on('set', this.hb_dropMeal_set.bind(this, accessoryData));
        }

        // setup meal amount service
        if (true) {
            service_name = config.get('MealAmount_name');
            let meal_amount_service = accessory.getService(service_name);
            if (!meal_amount_service) {
                // service not exist, create service
                meal_amount_service = accessory.addService(Service.Fan, service_name, service_name);
                if (!meal_amount_service) {
                    this.log.error('petkit device service create failed: meal_amount_service');
                    return false;
                }
            }

            meal_amount_service.getCharacteristic(Characteristic.On)
                .on('get', (callback) => callback(null, this.mealAmount != 0));
            meal_amount_service.getCharacteristic(Characteristic.RotationSpeed)
                .on('get', (callback) => callback(null, this.mealAmount))
                .on('set', this.hb_mealAmount_set.bind(this, accessoryData))
                .setProps({
                    minValue: globalVariables.min_amount,
                    maxValue: globalVariables.max_amount,
                    minStep: 1
                });
        }

        // setup food storage indicator service
        if (true) {
            service_name = config.get('FoodStorage_name');
            let food_storage_service = accessory.getService(service_name);
            if (!food_storage_service) {
                // service not exist, create service
                food_storage_service = accessory.addService(Service.OccupancySensor, service_name, service_name);
                if (!food_storage_service) {
                    this.log.error('petkit device service create failed: food_storage_service');
                    return false;
                }
            }

            food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, accessoryData.status['food'])
            food_storage_service.getCharacteristic(Characteristic.OccupancyDetected)
                .on('get', this.hb_foodStorageStatus_get.bind(this, accessoryData));
        }

        // setup desiccant left days service
        if (config.get('enable_desiccant')) {
            service_name = config.get('DesiccantLevel_name');
            let desiccant_level_service = accessory.getService(service_name);
            if (!desiccant_level_service) {
                // service not exist, create service
                desiccant_level_service = accessory.addService(Service.FilterMaintenance, service_name, service_name);
                if (!desiccant_level_service) {
                    this.log.error('petkit device service create failed: desiccant_level_service');
                    return false;
                }
            }

            desiccant_level_service.setCharacteristic(Characteristic.FilterChangeIndication,
                (accessoryData.status['desiccantLeftDays'] < this.alert_desiccant_threshold ? 1 : 0));
            desiccant_level_service.getCharacteristic(Characteristic.FilterChangeIndication)
                .on('get', this.hb_desiccantIndicator_get.bind(this, accessoryData));

            desiccant_level_service.setCharacteristic(Characteristic.FilterLifeLevel, accessoryData.status['desiccantLeftDays']);
            desiccant_level_service.getCharacteristic(Characteristic.FilterLifeLevel)
                .on('get', this.hb_desiccantLeftDays_get.bind(this, accessoryData))
                .setProps({
                    minValue: globalVariables.min_desiccantLeftDays,
                    maxValue: globalVariables.max_desiccantLeftDays,
                    minStep: 1
                });

            desiccant_level_service.getCharacteristic(Characteristic.ResetFilterIndication)
                .on('set', this.hb_desiccantLeftDays_reset.bind(this, accessoryData));
        }

        // setup manualLock setting service
        if (config.get('enable_manualLock')) {
            service_name = config.get('ManualLock_name');
            let manualLock_service = accessory.getService(service_name);
            if (!manualLock_service) {
                // service not exist, create service
                manualLock_service = accessory.addService(Service.Switch, service_name, service_name);
                if (!manualLock_service) {
                    this.log.error('petkit device service create failed: manualLock_service');
                    return false;
                }
            }

            manualLock_service.setCharacteristic(Characteristic.On, accessoryData.status['manualLock']);
            manualLock_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_manualLockStatus_get.bind(this, accessoryData))
                .on('set', this.hb_manualLockStatus_set.bind(this, accessoryData));
        }

        // setup lightMode setting service
        if (config.get('enable_lightMode')) {
            service_name = config.get('LightMode_name');
            let lightMode_service = accessory.getService(service_name);
            if (!lightMode_service) {
                // service not exist, create service
                lightMode_service = accessory.addService(Service.Switch, service_name, service_name);
                if (!lightMode_service) {
                    this.log.error('petkit device service create failed: lightMode_service');
                    return false;
                }
            }

            lightMode_service.setCharacteristic(Characteristic.On, accessoryData.status['manualLock']);
            lightMode_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_lightModeStatus_get.bind(this, accessoryData))
                .on('set', this.hb_lightModeStatus_set.bind(this, accessoryData));
        }

        // setup battery status service
        if (true) {
            service_name = config.get('Battery_name');
            let battery_status_service = accessory.getService(service_name);
            if (!battery_status_service) {
                // service not exist, create service
                battery_status_service = accessory.addService(Service.BatteryService, service_name, service_name);
                if (!battery_status_service) {
                    this.log.error('petkit device service create failed: battery_status_service');
                    return false;
                }
            }

            battery_status_service.setCharacteristic(Characteristic.BatteryLevel, accessoryData.status['batteryPower']);
            battery_status_service.getCharacteristic(Characteristic.BatteryLevel)
                .on('get', this.hb_deviceBatteryLevel_get.bind(this, accessoryData));

            battery_status_service.setCharacteristic(Characteristic.ChargingState, (accessoryData.status['batteryStatus'] == 0 ?
                Characteristic.ChargingState.CHARGING :
                Characteristic.ChargingState.NOT_CHARGING));
            battery_status_service.getCharacteristic(Characteristic.ChargingState)
                .on('get', this.hb_deviceChargingState_get.bind(this, accessoryData));

            battery_status_service.setCharacteristic(Characteristic.StatusLowBattery, (accessoryData.status['batteryPower'] <= 50 ?
                Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
                Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL));
            battery_status_service.getCharacteristic(Characteristic.StatusLowBattery)
                .on('get', this.hb_deviceStatusLowBattery_get.bind(this, accessoryData));
        }

        // setup divice information service
        if (true) {
            service_name = config.name + '_info';
            let info_service = accessory.getService(Service.AccessoryInformation);
            if (!info_service) {
                // service not exist, create service
                info_service = accessory.addService(Service.AccessoryInformation, service_name, service_name);
                if (!info_service) {
                    this.log.error('petkit device service create failed: info_service');
                    return false;
                }
            }

            info_service
                .setCharacteristic(Characteristic.Identify, config.deviceId)
                .setCharacteristic(Characteristic.Manufacturer, config.manufacturer)
                .setCharacteristic(Characteristic.Model, config.model)
                .setCharacteristic(Characteristic.SerialNumber, config.serialNumber)
                // infomation below changed from petkit app require a homebridge reboot to take effect.
                .setCharacteristic(Characteristic.Name, config.name)
                .setCharacteristic(Characteristic.FirmwareRevision, config.firmware);
        }
        return true;
    }

    // initialize one accessory
    // @param config: instance of configUtil
    initializeAccessory(config) {
        // uuid must be generated from a unique but not changing data source,
        // name should not be used in the most cases. But works in this specific example.
        const accessoryName = config.get('name');
        const uuid = UUIDGen.generate(accessoryName);
        let accessoryData = this.accessories.get(uuid);
        if (!accessoryData) {
            // accessoryData not exists, create accessoryData and accessory
            let accessory = new this.api.platformAccessory(accessoryName, uuid, accessoryName);
            if (!accessory) {
                this.log.error('petkit device service create failed: accessory');
                return;
            }

            accessoryData = Object.assign(globalVariables.default_accessoryData, {
                'accessory': accessory,
                'config' : config
            });
        } else if (!accessoryData.accessory) {
            // accessory not exists, create accessory
            let accessory = new this.api.platformAccessory(accessoryName, uuid, accessoryName);
            if (!accessory) {
                this.log.error('petkit device service create failed: accessory');
                return;
            }
            accessoryData = Object.assign(accessoryData, {
                'accessory': accessory,
                'config' : config
            });
        } else {
            accessoryData = Object.assign(globalVariables.default_accessoryData, {
                'config' : config
            });
        }

        // get deviceId from server
        let validDeviceId = undefined;
        this.http_getOwnDevice(accessoryData)
            .then(raw_data => {
                const user_deviceId = accessoryData.config.get('deviceId');
                const owned_devices = this.praseGetOwnedDevice(raw_data);
                if (owned_devices.length === 0) {
                    this.log.error('seems you does not owned a Petkit feeder mini, this plugin only works for Petkit feeder mini, sorry.');
                } else if (owned_devices.length === 1) {
                    if (!user_deviceId || owned_devices[0].id === user_deviceId) {
                        this.log.info('found you ownd one feeder mini with deviceId: '+ owned_devices[0].id);
                    } else {
                        this.log.warn('found you just ownd one feeder mini with deviceId: '+ owned_devices[0].id);
                        this.log.warn('which is not the same with the deviceId you set: '+ user_deviceId);
                        this.log.warn('will use '+ owned_devices[0].id + ' instead');
                    }
                    validDeviceId = owned_devices[0].id;
                } else {
                    let match_device = owned_devices.find(device => user_deviceId && device.id === user_deviceId);
                    if (undefined === match_device) {
                        const devicesIds = owned_devices.map((device) => {
                            return { 'id': device.id, 'name': device.name };
                        });
                        this.log.error('seems that you ownd more than one feeder mini, but the device id you set is not here.');
                        this.log.error('do you mean one of this: ' + JSON.stringify(devicesIds));
                    } else {
                        this.log.info('found you ownd one feeder mini with deviceId: '+ match_device.id);
                        validDeviceId = match_device.id;
                    }
                }
            })
            .catch((err) => {
                this.log.error('unable to determine whether the deviceId you set is valid: ' + err);
            })
            .then(() => {
                if (validDeviceId) {
                    accessoryData.config.set('deviceId', validDeviceId);
                    if (this.setupAccessory(accessoryData)) {
                        // all service setup success, now update accessory
                        if (!this.accessories.get(uuid)) {
                            this.api.registerPlatformAccessories(pluginName, platformName, [accessoryData.accessory]);
                        }
                        this.accessories.set(uuid, accessoryData.accessory);
                    }
                }
            });


    }
    
    praseGetOwnedDevice(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseGetOwnedDevice error: jsonObj is nothing.');
            return false;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error')) {
            this.log.error('server reply an error: ' + JSON.stringify(jsonObj));
            this.log.error('you may need to check your X-Session and other header configure');
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.error('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.result.hasOwnProperty('devices')) {
            this.log.error('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (jsonObj.result.devices.length === 0) {
            this.log.error('seems you\'re not owned a device.');
            return false;
        }

        var valid_devices = [];
        jsonObj.result.devices.forEach((item, index) => {
            if (item.type == 'FeederMini' && item.data) {
                valid_devices.push(item.data);
            }
        });

        return valid_devices;
    }

    async http_post(options) {
        return new Promise((resolve) => {
            var result = false;
            axios.request(options)
                .then((response) => {
                    if (response.status != 200) {
                        const error = 'post request success, but received a invalid response code: ' + response.status;
                        this.log.error(error);
                    } else {
                        this.log.debug('post request success')
                        result = response.data;
                    }
                })
                .catch((error) => {
                    this.log.error('post request failed: ' + error);
                })
                .then(() => {
                    resolve(result);
                });
        });
    }

    async http_getOwnDevice(accessoryData) {
        const url = accessoryData.config.get('urls').owndevices;
        const options = {
            url: url,
            method: 'POST',
            headers: accessoryData.config.get('headers'),
            responseType: 'json'
        };
        return await this.http_post(options);
    }

    async http_getDeviceInfo(accessoryData) {
        const deviceId = accessoryData.config.get('deviceId');
        const url_template = accessoryData.config.get('urls').deviceInfo;
        const url = format(url_template, deviceId);
        const options = {
            url: url,
            method: 'POST',
            headers: accessoryData.config.get('headers'),
            responseType: 'json'
        };
        return await this.http_post(options);
    }

    async http_getDeviceDailyFeeds(accessoryData) {
        const date = getDataString();
        const deviceId = accessoryData.config.get('deviceId');
        const url_template = accessoryData.config.get('urls').dailyfeeds;
        const url = format(url_template, deviceId, date);
        const options = {
            url: url,
            method: 'POST',
            headers: accessoryData.config.get('headers'),
            responseType: 'json'
        };
        return await this.http_post(options);
    }

    async http_getDeviceState(accessoryData) {
        // {
        //     "result": {
        //         "batteryPower":4,"batteryStatus":0,"desiccantLeftDays":6,
        //         "errorPriority":0,"feeding":0,"food":1,"ota":0,"overall":1,
        //         "pim":1,"runtime":49677,"wifi":{
        //             "bssid":"xxxxxxxxxxxx","rsq":-37,"ssid":"xxxxxxxxxx"
        //         }
        //     }
        // }
        const deviceId = accessoryData.config.get('deviceId');
        const url_template = accessoryData.config.get('urls').deviceState;
        const url = format(url_template, deviceId);
        const options = {
            url: url,
            method: 'POST',
            headers: accessoryData.config.get('headers'),
            responseType: 'json'
        };
        return await this.http_post(options);
    }

    async http_getDeviceDetailStatus(accessoryData) {
        const data = await Promise.all([this.http_getDeviceInfo(accessoryData), this.http_getDeviceDailyFeeds(accessoryData)])
        return {'deviceInfo': data[0], 'dailyfeeds': data[1]};
    }

    // date：20200920、time: 68400(-1 stand for current)、amount in app unit，1 for 5g, 10 is max(50g)
    async http_saveDailyFeed(accessoryData, amount, time) {
        const date = getDataString();
        const deviceId = accessoryData.config.get('deviceId');
        const url_template = accessoryData.config.get('urls').saveDailyFeed;
        const url = format(url_template, deviceId, date, time, amount * 5);
        const options = {
            url: url,
            method: 'POST',
            headers: accessoryData.config.get('headers'),
            responseType: 'json'
        };
        return await this.http_post(options);
    }

    // key see support_settings.
    async http_updateDeviceSettings(accessoryData, key, value) {
        const setting_key = globalVariables.support_settings[key];
        if (setting_key !== undefined) {
            const data = {setting_key: value};
            const deviceId = accessoryData.config.get('deviceId');
            const url_template = accessoryData.config.get('urls').updateSettings;
            const url = format(url_template, deviceId, JSON.stringify(data));
            const options = {
                url: url,
                method: 'POST',
                headers: accessoryData.config.get('headers'),
                responseType: 'json'
            };
            return await this.http_post(options);
        } else {
            this.log.warn('unsupport setting: ' + key);
            return false;
        }
    }

    async http_resetDesiccant() {
        const deviceId = accessoryData.config.get('deviceId');
        const url_template = accessoryData.config.get('urls').resetDesiccant;
        const url = format(url_template, deviceId);
        const options = {
            url: url,
            method: 'POST',
            headers: accessoryData.config.get('headers'),
            responseType: 'json'
        };
        return await this.http_post(options);
    }
    
    hb_mealAmount_set(accessoryData, value, callback) {
        const fast_response = accessoryData.config.get('fast_response');
        if (fast_response) callback(null);
        this.mealAmount = value;
        this.storagedConfig['mealAmount'] = value;
        this.log('set meal amount to ' + value);
        this.saveStoragedConfigToFile((fast_response ? null : callback));
    }

    hb_dropMeal_set(accessoryData, value, callback) {
        const fast_response = accessoryData.config.get('fast_response');
        if (fast_response) callback(null);
        this.log.debug('hb_dropMeal_set');
        if (value) {
            if (this.mealAmount) {
                this.log('drop food:' + this.mealAmount + ' meal(s)');

                var result = false;
                this.http_saveDailyFeed(this.mealAmount, -1)
                    .then((data) => {
                        if (!data) {
                            this.log.error('failed to commuciate with server.');
                        } else {
                            result = this.praseSaveDailyFeedResult(data);
                            this.log('food drop result: ' + result ? 'success' : 'failed');
                        }
                    })
                    .catch((error) => {
                        this.log.error('food drop failed: ' + error);
                    })
                    .then(() => {
                        if (!fast_response) callback(null);
                    });
            } else {
                this.log('drop food with zero amount, pass.');
            }
            
            setTimeout(() => {
                this.drop_meal_service.setCharacteristic(Characteristic.On, false);
            }, 200);
        }
        this.updataDeviceDetail();
    }

    hb_desiccantIndicator_get(accessoryData, callback) {
        this.hb_handle_get(accessoryData, 'hb_desiccantIndicator_get', (results) => {
            const status = (accessoryData.status['desiccantLeftDays'] < this.alert_desiccant_threshold ? 1 : 0);
            callback(null, status);
        });
    }

    hb_desiccantLeftDays_get(accessoryData, callback) {
        this.hb_handle_get(accessoryData, 'hb_desiccantLeftDays_get', (results) => {
            callback(null, accessoryData.status['desiccantLeftDays']);
        });
    }

    // reset Desiccant Left Days 
    hb_desiccantLeftDays_reset(accessoryData, callback) {
        const fast_response = accessoryData.config.get('fast_response');
        if (fast_response && callback) {callback(null);}
        this.log.debug('hb_desiccantLeftDays_reset');
        this.http_resetDesiccant()
            .then((data) => {
                if (data && data['result']) {
                    accessoryData.status['desiccantLeftDays'] = data['result'];
                    this.log('reset desiccant left days success, left days reset to ' + data['result'] + ' days');
                } else {
                    this.log('reset desiccant left days with a unrecognized return.');
                }
            })
            .catch((error) => {
                this.log.error('reset desiccant left days failed: ' + error);
            })
            .then(() => {
                if (!fast_response && callback) callback(null);
            });
    }

    hb_foodStorageStatus_get(accessoryData, callback) {
        this.hb_handle_get(accessoryData, 'hb_foodStorageStatus_get', (results) => {
            callback(null, (this.reverse_foodStorage_indicator ? !accessoryData.status['food'] : accessoryData.status['food']));
        });
    }

    hb_manualLockStatus_get(accessoryData, callback) {
        this.hb_handle_get(accessoryData, 'hb_manualLockStatus_get', (results) => {
            callback(null, accessoryData.status['manualLock']);
        });
    }

    hb_manualLockStatus_set(accessoryData, value, callback) {
        const fast_response = accessoryData.config.get('fast_response');
        if (fast_response) callback(null);
        this.hb_handle_set_deviceSettings(accessoryData, 'manualLock', (value ? 0 : 1), (result) => {
            if (!fast_response) callback(null);
        });
    }

    hb_lightModeStatus_get(accessoryData, callback) {
        this.hb_handle_get(accessoryData, 'hb_lightModeStatus_get', (results) => {
            const status = accessoryData.status['lightMode'];
            callback(null, status);
        });
    }

    hb_lightModeStatus_set(accessoryData, value, callback) {
        const fast_response = accessoryData.config.get('fast_response');
        if (fast_response) callback(null);
        this.hb_handle_set_deviceSettings(accessoryData, 'lightMode', value, (result) => {
            if (!fast_response) callback(null);
        });
    }

    hb_deviceBatteryLevel_get(accessoryData, callback) {
        this.hb_handle_get(accessoryData, 'hb_deviceBatteryLevel_get', (results) => {
            callback(null, accessoryData.status['batteryPower']);
        });
    }

    hb_deviceChargingState_get(accessoryData, callback) {
        this.hb_handle_get(accessoryData, 'hb_deviceChargingState_get', (results) => {
            const status = (accessoryData.status['batteryStatus'] == 0 ?
                Characteristic.ChargingState.CHARGING :
                Characteristic.ChargingState.NOT_CHARGING);
            callback(null, status);
        });
    }

    hb_deviceStatusLowBattery_get(accessoryData, callback) {
        this.hb_handle_get(accessoryData, 'hb_deviceStatusLowBattery_get', (results) => {
            var status = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            if (accessoryData.status['batteryPower'] < 50) {
                status = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
            }
            callback(null, status);
        });
    }
}

module.exports = function (homebridge) {
    PlatformAccessory = homebridge.platformAccessory;
    Accessory = homebridge.hap.Accessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform(pluginName, platformName, petkit_feeder_mini_plugin, true);
}
