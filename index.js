'use strict';

let PlatformAccessory, Accessory, Service, Characteristic, UUIDGen;

const format = require('string-format');
const axios = require('axios');
const dayjs = require('dayjs');
const pollingtoevent = require('polling-to-event');

const logUtil = require('./utils/log');
const configUtil = require('./utils/config');

const pluginName = 'homebridge-petkit-feeder-mini';
const platformName = 'petkit_feeder_mini';

const globalVariables = Object.freeze({
    'support_device_type': [                // valid petkit feeder device type
        'Feeder',                           // Petkit Feeder Element
        'FeederMini'                        // Petkit Feeder Mini
    ],
    'support_settings': {
        'manualLock' : 'settings.manualLock',      // 1 for off, 0 for on
        'lightMode' : 'settings.lightMode',
    },
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
    'default_http_options': {
        'method': 'POST',
        'timeout': 5000,
        'responseType': 'json',
        'retry' : {
            'enabled': true,
            'max_retry': 3,                 // http request retry count
        }
    },
    'global_urls': {
        'Feeder': {
            'cn': {
                'owndevices': 'http://api.petkit.cn/6/discovery/device_roster',
                'deviceState': 'http://api.petkit.cn/6/feeder/devicestate?id={}',
                'deviceDetailInfo': 'http://api.petkit.cn/6/feeder/device_detail?id={}',
                'saveDailyFeed': 'http://api.petkit.cn/6/feeder/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
                'removeDailyFeed': 'http://api.petkit.cn/6/feeder/remove_dailyfeed?deviceId={}&day={}&id=d{}',
                'dailyfeeds': 'http://api.petkit.cn/6/feeder/dailyfeeds?deviceId={}&days={}',
                'restoreDailyFeeds': 'http://api.petkit.cn/6/feeder/restore_dailyfeed?deviceId={}&day={}&id=s{}',
                'disableDailyFeeds': 'http://api.petkit.cn/6/feeder/remove_dailyfeed?deviceId={}&day={}&id=s{}',
                'resetDesiccant': 'http://api.petkit.cn/6/feeder/desiccant_reset?deviceId={}',
                'updateSettings': 'http://api.petkit.cn/6/feeder/update?id={}&kv={}',
            },
            'asia':{
                'owndevices': 'http://api.petktasia.com/latest/discovery/device_roster',
                'deviceState': 'http://api.petktasia.com/latest/feeder/devicestate?id={}',
                'deviceDetailInfo': 'http://api.petktasia.com/latest/feeder/device_detail?id={}',
                'saveDailyFeed': 'http://api.petktasia.com/latest/feeder/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
                'removeDailyFeed': 'http://api.petktasia.com/latest/feeder/remove_dailyfeed?deviceId={}&day={}&id=d{}',
                'dailyfeeds': 'http://api.petktasia.com/latest/feeder/dailyfeeds?deviceId={}&days={}',
                'restoreDailyFeeds': 'http://api.petktasia.com/latest/feeder/restore_dailyfeed?deviceId={}&day={}&id=s{}',
                'disableDailyFeeds': 'http://api.petktasia.com/latest/feeder/remove_dailyfeed?deviceId={}&day={}&id=s{}',
                'resetDesiccant': 'http://api.petktasia.com/latest/feeder/desiccant_reset?deviceId={}',
                'updateSettings': 'http://api.petktasia.com/latest/feeder/update?id={}&kv={}',
            },
            'north_america':{
                'owndevices': 'http://api.petkt.com/latest/discovery/device_roster',
                'deviceState': 'http://api.petkt.com/latest/feeder/devicestate?id={}',
                'deviceDetail': 'http://api.petkt.com/latest/feeder/device_detail?id={}',
                'saveDailyFeed': 'http://api.petkt.com/latest/feeder/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
                'removeDailyFeed': 'http://api.petkt.com/latest/feeder/remove_dailyfeed?deviceId={}&day={}&id=d{}',
                'dailyfeeds': 'http://api.petkt.com/latest/feeder/dailyfeeds?deviceId={}&days={}',
                'restoreDailyFeeds': 'http://api.petkt.com/latest/feeder/restore_dailyfeed?deviceId={}&day={}&id=s{}',
                'disableDailyFeeds': 'http://api.petkt.com/latest/feeder/remove_dailyfeed?deviceId={}&day={}&id=s{}',
                'resetDesiccant': 'http://api.petkt.com/latest/feeder/desiccant_reset?deviceId={}',
                'updateSettings': 'http://api.petkt.com/latest/feeder/update?id={}&kv={}',
            }
        },
        'FeederMini': {
            'cn': {
                'owndevices': 'http://api.petkit.cn/6/discovery/device_roster',
                'deviceState': 'http://api.petkit.cn/6/feedermini/devicestate?id={}',
                'deviceDetailInfo': 'http://api.petkit.cn/6/feedermini/device_detail?id={}',
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
                'deviceDetailInfo': 'http://api.petktasia.com/latest/feedermini/device_detail?id={}',
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
                'deviceDetailInfo': 'http://api.petkt.com/latest/feedermini/device_detail?id={}',
                'saveDailyFeed': 'http://api.petkt.com/latest/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
                'removeDailyFeed': 'http://api.petkt.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
                'dailyfeeds': 'http://api.petkt.com/latest/feedermini/dailyfeeds?deviceId={}&days={}',
                'restoreDailyFeeds': 'http://api.petkt.com/latest/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
                'disableDailyFeeds': 'http://api.petkt.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
                'resetDesiccant': 'http://api.petkt.com/latest/feedermini/desiccant_reset?deviceId={}',
                'updateSettings': 'http://api.petkt.com/latest/feedermini/update?id={}&kv={}',
            }
        }
    },
    'config': {
        'min_amount': 0,                    // in meal(same in app)
        'max_amount': 10,                   // in meal(same in app)
        'min_desiccantLeftDays': 0,         // in day
        'max_desiccantLeftDays': 30,        // in day
        'min_batteryLevel': 0,              // level(same in app)
        'max_batteryLevel': 4,              // level(same in app)
        'batteryPersentPerLevel': 100 / 4,
        'min_pollint_interval': 60,         // in second
        'max_pollint_interval': 3600,       // in second
        'min_fetch_status_interval': 10,    // in second
        'foodStorage_alerm_threshold': 300,
    }
});

class PetkitFeederDevice {
    constructor() {
        let accessory = undefined;
        this.config = undefined;
        this.events = {
            'polling_event': undefined
        }
        this.services = {
            'drop_meal_service': undefined,
            'meal_amount_service': undefined,
            'food_storage_service': undefined,
            'desiccant_level_service': undefined,
            'lightMode_service': undefined,
            'battery_status_service': undefined,
            'info_service': undefined
        };
        this.status = {     // petkit status value
            'lastUpdate': 0,
            'food' : 0,                 // this.config.get('reverse_foodStorage_indicator') ? !petkitDevice.status.food : petkitDevice.status.food
            'batteryPower': 0,  
            'batteryStatus': 1,
            'desiccantLeftDays' : 0,    // petkitDevice.status.desiccantLeftDays < petkitDevice.config.get('alert_desiccant_threshold') ? 1 : 0
            'manualLock': 0,
            'lightMode': 0,
            'meals': {}
        };
        this.savedData = {
            'mealAmount': 2,
        };

        Object.defineProperty(this, 'accessory', {
            get() {
                return accessory;
            },
            set(value) {
                accessory = value;
                this.load();
            }
        });

        this.load();
    }

    save() {
        if (this.accessory && this.savedData) {
            this.accessory.context = this.savedData;
        }
    }

    load() {
        if (this.accessory && this.accessory.context) {
            this.savedData = Object.assign(this.savedData, this.accessory.context);
        }
    }

    getFoodStatusForHomebridge() {
        if (this.config.get('model') === 'Feeder') {
            if (this.config.get('reverse_foodStorage_indicator')) {
                return (this.status.food < globalVariables.config.foodStorage_alerm_threshold ? 1 : 0);
            } else {
                return (this.status.food < globalVariables.config.foodStorage_alerm_threshold ? 0 : 1);
            }
        } else if (this.config.get('model') === 'FeederMini') {
            if (this.config.get('reverse_foodStorage_indicator')) {
                return (this.status.food != 1);
            } else {
                return (this.status.food == 1);
            }
        } else {
            return 0;
        }
    }
};

function getTimestamp() {
    return Math.floor(Date.now() / 1000);
};

function getDataString() {
    return dayjs(new Date()).format('YYYYMMDD');
}

class petkit_feeder_plugin {
    constructor(log, config, api) {
        this.log = new logUtil(log, config.log_level || logUtil.LOGLV_INFO);
        this.log.info('begin to initialize Petkit Feeder Platform.');

        if (!api) {
            this.log.error("Homebridge's version is too old, please upgrade!");
            return;
        }
        this.api = api;
        this.accessories = new Map();

        if (!config || !config.devices) {
            this.log.error("no configure found for Petkit Feeder device.");
            this.log.error("you may need to convert old config to new config? or double check your config.json");
            this.log.error("goto https://github.com/elfive/homebridge-petkit-feeder-mini/wiki/How-to-convert-v1.x.x-config-to-v2.x.x for more detail.");
            return;
        } else {
            // When this event is fired, homebridge restored all cached accessories from disk and did call their respective
            // `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
            // after this event was fired, in order to ensure they weren't added to homebridge already.
            // This event can also be used to start discovery of new accessories.
            this.api.on('didFinishLaunching', () => {
                // check config usability
                config.devices.forEach(device_config => {
                    // probably parse config or something here
                    const config = this.configCheck(device_config);
                    if (config) {
                        this.initializeAccessory(config);
                    }
                });
            });
            this.log.info('Petkit Feeder Platform loaded.');
        }
    }

    // check and modify configure value
    // @prama config: config Object from config.json
    // @return: if success return instance of configUtil or failed return undefined;
    configCheck(config) {
        const fulfill_headerset = (headers, key, value) => {
            let header = headers.find(header => header.key == key);
            if (undefined === header) {
                this.log.debug(format('missing header: {0}, using \'{1}\' instead.', key, value));
                headers.push({'key': key, 'value': value});
            } else if ('' === header) {
                this.log.warn(format('header \'{0}\' value is empty, using \'{1}\' instead.', key, value));
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

        // device model
        const device_model = conf.fulfill('model', 'FeederMini');
        if (-1 === globalVariables.support_device_type.indexOf(device_model)) {
            this.log.error(format('unsupported device type: {}.', device_model));
            return undefined;
        }

        // location
        let location = conf.get('location');
        if (!location) {
            this.log.error('missing dataset: location in your config.');
            return undefined;
        } else {
            const validLocations = Object.keys(globalVariables.global_urls[device_model]);
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
        config_headers.forEach(header => {
            http_headers[header.key] = header.value;
        });
        conf.set('headers', http_headers)

        // urls
        conf.set('urls', globalVariables.global_urls[device_model][location]);

        // optional configure items
        // conf.fulfill('name', 'PetkitFeederMini');
        // conf.fulfill('sn', 'PetkitFeederMini');
        // conf.fulfill('firmware', '0.0.0')
        conf.fulfill('manufacturer', 'Petkit');
        conf.fulfill('enable_polling', true);

        const polling_interval = conf.get('polling_interval');
        const min_polling_interval = globalVariables.config.min_pollint_interval;
        const max_polling_interval = globalVariables.config.max_pollint_interval;
        if (polling_interval < min_polling_interval) {
            this.log.warn(format('value of polling_interval({0}) should great than {1}, now using {1} instead', polling_interval, min_polling_interval));
            conf.set('polling_interval', min_polling_interval);
        } else if (polling_interval > max_polling_interval) {
            this.log.warn(format('value of polling_interval({0}) should smaller than {1}, now using {1} instead', polling_interval, max_polling_interval));
            conf.set('polling_interval', max_polling_interval);
        }

        conf.fulfill('enable_manualLock', false);
        conf.fulfill('enable_lightMode', false);
        conf.fulfill('reverse_foodStorage_indicator', false);
        conf.fulfill('fast_response', false);

        // service name field
        conf.fulfill('DropMeal_name', 'DropMeal');
        conf.fulfill('FoodStorage_name', (conf.get('reverse_foodStorage_indicator') ? 'FoodStorage_Empty' : 'FoodStorage'));
        conf.fulfill('DesiccantLevel_name', 'DesiccantLevel');
        conf.fulfill('ManualLock_name', 'ManualLock');
        conf.fulfill('LightMode_name', 'LightMode');
        conf.fulfill('Battery_name', 'Battery');

        // print config log
        conf.print(content => {this.log.debug(content)});

        return conf;
    }

    // REQUIRED - Homebridge will call the "configureAccessory" method once for every cached accessory restored
    // This function is invoked when homebridge restores cached accessories from disk at startup.
    // It should be used to setup event handlers for characteristics and update respective values.
    configureAccessory(accessory) {
        const petkitDevice = Object.assign(new PetkitFeederDevice(), {
            'accessory': accessory,
        });
        this.accessories.set(accessory.UUID, petkitDevice);
    }

    // setup accessory's service include handlers,value
    // @return: if success return true or failed return false;
    setupAccessory(petkitDevice) {
        let accessory = petkitDevice.accessory;
        let config = petkitDevice.config;  // instance of configUtil
        let service_name = undefined;
        let service_status = undefined;

        // setup meal drop service
        if (true) {
            service_name = config.get('DropMeal_name');
            let drop_meal_service = accessory.getService(service_name);
            if (!drop_meal_service) {
                // service not exist, create service
                drop_meal_service = accessory.addService(Service.Switch, service_name, service_name);
                if (!drop_meal_service) {
                    this.log.error('petkit device service create failed: ' + service_name);
                    return false;
                }
            }

            drop_meal_service.getCharacteristic(Characteristic.On)
                .on('get', callback => callback(null, 0))
                .on('set', this.hb_dropMeal_set.bind(this, petkitDevice));

            petkitDevice.services.drop_meal_service = drop_meal_service;
        }

        // setup meal amount service
        if (true) {
            service_name = config.get('MealAmount_name');
            let meal_amount_service = accessory.getService(service_name);
            if (!meal_amount_service) {
                // service not exist, create service
                meal_amount_service = accessory.addService(Service.Fan, service_name, service_name);
                if (!meal_amount_service) {
                    this.log.error('petkit device service create failed: ' + service_name);
                    return false;
                }
            }

            meal_amount_service.getCharacteristic(Characteristic.On)
                .on('get', callback => callback(null, petkitDevice.savedData.mealAmount !== 0));
            meal_amount_service.getCharacteristic(Characteristic.RotationSpeed)
                .on('get', callback => callback(null, petkitDevice.savedData.mealAmount))
                .on('set', this.hb_mealAmount_set.bind(this, petkitDevice))
                .setProps({
                    minValue: globalVariables.config.min_amount,
                    maxValue: globalVariables.config.max_amount,
                    minStep: 1
                });

            petkitDevice.services.meal_amount_service = meal_amount_service;
        }

        // setup food storage indicator service
        if (true) {
            service_name = config.get('FoodStorage_name');
            let food_storage_service = accessory.getService(service_name);
            if (!food_storage_service) {
                // service not exist, create service
                food_storage_service = accessory.addService(Service.OccupancySensor, service_name, service_name);
                if (!food_storage_service) {
                    this.log.error('petkit device service create failed: ' + service_name);
                    return false;
                }
            }

            service_status = petkitDevice.getFoodStatusForHomebridge();
            food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, service_status)
            food_storage_service.getCharacteristic(Characteristic.OccupancyDetected)
                .on('get', this.hb_foodStorageStatus_get.bind(this, petkitDevice));

            petkitDevice.services.food_storage_service = food_storage_service;
        }

        // setup desiccant left days service
        if (config.get('enable_desiccant')) {
            service_name = config.get('DesiccantLevel_name');
            let desiccant_level_service = accessory.getService(service_name);
            if (!desiccant_level_service) {
                // service not exist, create service
                desiccant_level_service = accessory.addService(Service.FilterMaintenance, service_name, service_name);
                if (!desiccant_level_service) {
                    this.log.error('petkit device service create failed: ' + service_name);
                    return false;
                }
            }

            desiccant_level_service.setCharacteristic(Characteristic.FilterChangeIndication,
                (petkitDevice.status.desiccantLeftDays < this.alert_desiccant_threshold ? 1 : 0));
            desiccant_level_service.getCharacteristic(Characteristic.FilterChangeIndication)
                .on('get', this.hb_desiccantIndicator_get.bind(this, petkitDevice));

            desiccant_level_service.setCharacteristic(Characteristic.FilterLifeLevel, petkitDevice.status.desiccantLeftDays);
            desiccant_level_service.getCharacteristic(Characteristic.FilterLifeLevel)
                .on('get', this.hb_desiccantLeftDays_get.bind(this, petkitDevice))
                .setProps({
                    minValue: globalVariables.config.min_desiccantLeftDays,
                    maxValue: globalVariables.config.max_desiccantLeftDays,
                    minStep: 1
                });

            desiccant_level_service.getCharacteristic(Characteristic.ResetFilterIndication)
                .on('set', this.hb_desiccantLeftDays_reset.bind(this, petkitDevice));

            petkitDevice.services.desiccant_level_service = desiccant_level_service;
        }

        // setup manualLock setting service
        if (config.get('enable_manualLock')) {
            service_name = config.get('ManualLock_name');
            let manualLock_service = accessory.getService(service_name);
            if (!manualLock_service) {
                // service not exist, create service
                manualLock_service = accessory.addService(Service.Switch, service_name, service_name);
                if (!manualLock_service) {
                    this.log.error('petkit device service create failed: ' + service_name);
                    return false;
                }
            }

            manualLock_service.setCharacteristic(Characteristic.On, petkitDevice.status.manualLock);
            manualLock_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_manualLockStatus_get.bind(this, petkitDevice))
                .on('set', this.hb_manualLockStatus_set.bind(this, petkitDevice));

            petkitDevice.services.manualLock_service = manualLock_service;
        }

        // setup lightMode setting service
        if (config.get('enable_lightMode')) {
            service_name = config.get('LightMode_name');
            let lightMode_service = accessory.getService(service_name);
            if (!lightMode_service) {
                // service not exist, create service
                lightMode_service = accessory.addService(Service.Switch, service_name, service_name);
                if (!lightMode_service) {
                    this.log.error('petkit device service create failed: ' + service_name);
                    return false;
                }
            }

            lightMode_service.setCharacteristic(Characteristic.On, petkitDevice.status.lightMode);
            lightMode_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_lightModeStatus_get.bind(this, petkitDevice))
                .on('set', this.hb_lightModeStatus_set.bind(this, petkitDevice));

            petkitDevice.services.lightMode_service = lightMode_service;
        }

        // setup battery status service, only for Petkit Feeder Mini
        if (petkitDevice.config.get('model') === 'FeederMini') {
            service_name = config.get('Battery_name');
            let battery_status_service = accessory.getService(service_name);
            if (!battery_status_service) {
                // service not exist, create service
                battery_status_service = accessory.addService(Service.BatteryService, service_name, service_name);
                if (!battery_status_service) {
                    this.log.error('petkit device service create failed: ' + service_name);
                    return false;
                }
            }

            battery_status_service.setCharacteristic(Characteristic.BatteryLevel, petkitDevice.status.batteryPower);
            battery_status_service.getCharacteristic(Characteristic.BatteryLevel)
                .on('get', this.hb_deviceBatteryLevel_get.bind(this, petkitDevice));

            battery_status_service.setCharacteristic(Characteristic.ChargingState, (petkitDevice.status.batteryStatus == 0 ?
                Characteristic.ChargingState.CHARGING :
                Characteristic.ChargingState.NOT_CHARGING));
            battery_status_service.getCharacteristic(Characteristic.ChargingState)
                .on('get', this.hb_deviceChargingState_get.bind(this, petkitDevice));

            battery_status_service.setCharacteristic(Characteristic.StatusLowBattery, (petkitDevice.status.batteryPower <= 50 ?
                Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
                Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL));
            battery_status_service.getCharacteristic(Characteristic.StatusLowBattery)
                .on('get', this.hb_deviceStatusLowBattery_get.bind(this, petkitDevice));

            petkitDevice.services.battery_status_service = battery_status_service;
        }

        // setup divice information service
        if (true) {
            let info_service = accessory.getService(Service.AccessoryInformation);
            if (!info_service) {
                // service not exist, create service
                info_service = accessory.addService(Service.AccessoryInformation);
                if (!info_service) {
                    this.log.error('petkit device service create failed: info_service');
                    return false;
                }
            }

            info_service
                .setCharacteristic(Characteristic.Identify, config.get('deviceId'))
                .setCharacteristic(Characteristic.Manufacturer, config.get('manufacturer'))
                .setCharacteristic(Characteristic.Model, config.get('model'))
                .setCharacteristic(Characteristic.SerialNumber, config.get('sn'))
                // infomation below changed from petkit app require a homebridge reboot to take effect.
                .setCharacteristic(Characteristic.Name, config.get('name'))
                .setCharacteristic(Characteristic.FirmwareRevision, config.get('firmware'));

            petkitDevice.services.info_service = info_service;
        }
        return true;
    }

    // initialize one accessory
    // @param config: instance of configUtil
    initializeAccessory(config) {
        this.log.info('initializing Petkit Feeder device.');

        // get deviceId from server
        let validDevice = undefined;
        this.log.debug('request device info from Petkit server.');
        this.http_getOwnDevice(config)
            .then(owned_device_raw => {
                if (owned_device_raw) {
                    const user_deviceId = config.get('deviceId');
                    const owned_devices = this.praseGetOwnedDevice(owned_device_raw);
                    if (owned_devices.length === 0) {
                        this.log.error(format('sorry that this plugin only works with these device type:{}.', JSON.stringify(globalVariables.support_device_type)));
                    } else if (owned_devices.length === 1) {
                        if (!user_deviceId || owned_devices[0].id == user_deviceId) {
                            this.log.info(format('found you ownd one {} with deviceId: {}.', owned_devices[0].type, owned_devices[0].id));
                        } else {
                            this.log.warn(format('found you just ownd one {} with deviceId: ', owned_devices[0].type , owned_devices[0].id));
                            this.log.warn(format('which is not the same with the deviceId you set: {}', user_deviceId));
                            this.log.warn(format('will use {} instead', owned_devices[0].id));
                        }
                        validDevice = owned_devices[0];
                    } else {
                        let match_device = owned_devices.find(device => user_deviceId && device.id == user_deviceId);
                        if (undefined === match_device) {
                            const devicesIds = owned_devices.map(device => {
                                return { 'id': device.id, 'name': device.name };
                            });
                            this.log.error('seems that you ownd more than one feeder, but the device id you set is not here.');
                            this.log.error(format('do you mean one of this: ', JSON.stringify(devicesIds)));
                        } else {
                            this.log.info(format('found you ownd one {} with deviceId: {}', match_device.type, match_device.id));
                            validDevice = match_device;
                        }
                    }
                } else {
                    this.log.error('unable to fetch information from petkit server. skip adding this petkit device.');
                }

            })
            .catch(error => {
                this.log.error('unable to determine whether the deviceId you set is valid: ' + error.stack ? error.stack : error);
            })
            .then(() => {
                if (!validDevice) {
                    this.log.error('initialize Petkit Feeder failed: could not find supported device.');
                    return;
                }
                config.set('deviceId', validDevice.id);
                config.set('name', validDevice.name);
                config.set('model', validDevice.type);

                // uuid must be generated from a unique but not changing data source,
                // name should not be used in the most cases. But works in this specific example.
                const uuid = UUIDGen.generate(validDevice.name);
                let petkitDevice = this.accessories.get(uuid);
                if (!petkitDevice) {
                    // petkitDevice not exists, create petkitDevice and accessory
                    let accessory = new this.api.platformAccessory(validDevice.name, uuid, validDevice.name);
                    if (!accessory) {
                        this.log.error('initialize Petkit Feeder failed: could not create accessory');
                        return;
                    }

                    petkitDevice = new PetkitFeederDevice();
                    petkitDevice.accessory = accessory;
                    petkitDevice.config = config;
                } else if (!petkitDevice.accessory) {
                    // accessory not exists, create accessory
                    let accessory = new this.api.platformAccessory(validDevice.name, uuid, validDevice.name);
                    if (!accessory) {
                        this.log.error('initialize Petkit Feeder failed: could not create accessory');
                        return;
                    }
                    petkitDevice.accessory = accessory;
                    petkitDevice.config = config;
                } else {
                    // accessory exists
                    petkitDevice.config = config;
                }

                this.log.debug('request initial device status from Petkit server.');
                this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                    if (deviceDetailInfo) {
                        petkitDevice.config.set('sn', deviceDetailInfo.sn);
                        petkitDevice.config.set('firmware', deviceDetailInfo.firmware);
                        petkitDevice.config.assign('headers', {key: 'X-TimezoneId', value: deviceDetailInfo.locale})
    
                        if (this.setupAccessory(petkitDevice)) {
                            // all service setup success, now update accessory
                            if (!this.accessories.get(uuid)) {
                                this.api.registerPlatformAccessories(pluginName, platformName, [petkitDevice.accessory]);
                            }
                            this.accessories.set(uuid, petkitDevice.accessory);
    
                            this.log.info(format('initialize Petkit Feeder device({}) success.', config.get('name')));
    
                            // polling
                            this.setupPolling(petkitDevice);
                        } else {
                            this.log.error(format('initialize Petkit Feeder device({}) failed.', config.get('name')));
                        }
                    } else {
                        this.log.warn(format('bypass initialize Petkit Feeder device({}).', config.get('name')));
                    }
                });
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
            this.log.error('server reply an error: ' + jsonStr);
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
            this.log.error('seems you didn\'t owned a Petkit Feeder device.');
            return false;
        }

        var valid_devices = [];
        jsonObj.result.devices.forEach(device => {
            const index = globalVariables.support_device_type.indexOf(device.type);
            if (index !== -1 && device.data) {
                valid_devices.push(Object.assign(device.data, {'type': device.type}));
            }
        });
        return valid_devices;
    }

    praseGetDeviceDetailInfo(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseGetDeviceDetailInfo error: jsonObj is nothing.');
            return false;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error')) {
            this.log.error('server reply an error: ' + jsonStr);
            this.log.error('you may need to check your X-Session and other header configure');
            return false;
        }

        if (!jsonObj.hasOwnProperty('result') ||
            !jsonObj.result.hasOwnProperty('state') ||
            !jsonObj.result.hasOwnProperty('settings')) {
            this.log.error('unable to parse device info reply from server with data: ' + jsonStr);
            return false;
        }

        const deviceInfo = jsonObj.result;

        let deviceDetailInfo = {};
        if (deviceInfo.name) deviceDetailInfo.name = deviceInfo.name;
        if (deviceInfo.sn) deviceDetailInfo.sn = deviceInfo.sn;
        if (deviceInfo.firmware) deviceDetailInfo.firmware = deviceInfo.firmware;
        if (deviceInfo.timezone) deviceDetailInfo.timezone = deviceInfo.timezone;
        if (deviceInfo.locale) deviceDetailInfo.locale = deviceInfo.locale;

        deviceDetailInfo.status = {};
        // 1 for status ok, 0 for empty
        if (deviceInfo.state.food !== undefined) deviceDetailInfo.status.food = deviceInfo.state.food;
        // this.log.debug('device food storage status is: ' + (deviceDetailInfo.status.food ? 'Ok' : 'Empty'));

        if (deviceInfo.state.batteryPower !== undefined) deviceDetailInfo.status.batteryPower = deviceInfo.state.batteryPower;
        // this.log.debug('device battery level is: ' + deviceDetailInfo.status.batteryPower * globalVariables.config.batteryPersentPerLevel);

        // 0 for charging mode, 1 for battery mode
        if (deviceInfo.state.batteryStatus !== undefined) deviceDetailInfo.status.batteryStatus = deviceInfo.state.batteryStatus;
        // this.log.debug('device battery status is: ' + (deviceDetailInfo.status.batteryStatus ? 'charging mode' : 'battery mode'));

        if (deviceInfo.state.desiccantLeftDays !== undefined) deviceDetailInfo.status.desiccantLeftDays = deviceInfo.state.desiccantLeftDays;
        // this.log.debug('device desiccant remain: ' + (deviceDetailInfo.status.desiccantLeftDays + ' day(s)'));
        
        // 0 for unlocked, 1 for locked
        if (deviceInfo.settings.manualLock !== undefined) deviceDetailInfo.status.manualLock = deviceInfo.settings.manualLock;
        // this.log.debug('device manual lock status is: ' + (deviceDetailInfo.status.manualLock ? 'unlocked' : 'locked'));

        // 0 for light off, 1 for lignt on
        if (deviceInfo.settings.lightMode !== undefined) deviceDetailInfo.status.lightMode = deviceInfo.settings.lightMode;
        // this.log.debug('device light status is: ' + (deviceDetailInfo.status.lightMode ? 'on' : 'off'));

        return deviceDetailInfo;
    }

    praseUpdateDeviceSettingsResult(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseUpdateDeviceSettingsResult error: jsonObj is nothing.');
            return false;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error')) {
            this.log.error('server reply an error: ' + jsonStr);
            this.log.error('you may need to check your X-Session and other header configure');
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.error('JSON.parse error with:' + jsonStr);
            return false;
        }

        return (jsonObj.result === 'success');
    }

    praseSaveDailyFeedResult(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseSaveDailyFeedResult error: jsonObj is nothing.');
            return false;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error')) {
            this.log.error('server reply an error: ' + jsonStr);
            this.log.error('you may need to check your X-Session and other header configure');
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.error('JSON.parse error with:' + jsonStr);
            return false;
        }

        return (jsonObj.result.isExecuted === 1);
    }

    // success return data, failed return undefined
    async http_request(options) {
        // return.data and return.error are mutual exclusion
        const request_once = async options => {
            return new Promise(resolve => {
                let result = undefined;
                axios.request(options)
                    .then(response => {
                        if (response.status != 200) {
                            result = {error: 'http request received a invalid response code: ' + response.status};
                        } else {
                            this.log.debug('http request success')
                            result = {data: response.data};
                        }
                    })
                    .catch(error => {
                        result = {error: 'http request failed: ' + error};
                    })
                    .then(() => {
                        resolve(result);
                    });
            });
        };

        let result = undefined;
        result = await request_once(options);

        // retry logic
        if (result.error &&
            options.retry.enabled &&
            options.timeout > 0) {
            const max_retry = globalVariables.default_http_options.retry.max_retry;
            for (let retry = 2; retry <= max_retry; retry++) {
                result = await request_once(options);
                if (result.error) {
                    this.log.warn(result.error);
                    this.log.warn(format('retry http request: {}/{}', retry, max_retry));
                } else if (result.data) {
                    break;
                }
            }
        }

        if (result.error) {
            this.log.error(result.error);
            this.log.error(format('http request failed: ' + result.error));
        }

        return result.data;
    }

    async http_getOwnDevice(config) {
        const url = config.get('urls').owndevices;
        const options = Object.assign(globalVariables.default_http_options, {
            url: url,
            headers: config.get('headers'),
            responseType: 'json'
        });
        return await this.http_request(options);
    }

    async http_getDeviceInfo(petkitDevice) {
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').deviceDetailInfo;
        const url = format(url_template, deviceId);
        const options = Object.assign(globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json'
        });
        return await this.http_request(options);
    }

    async http_getDeviceDailyFeeds(petkitDevice) {
        const date = getDataString();
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').dailyfeeds;
        const url = format(url_template, deviceId, date);
        const options = Object.assign(globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json'
        });
        return await this.http_request(options);
    }

    async http_getDeviceState(petkitDevice) {
        // {
        //     "result": {
        //         "batteryPower":4,"batteryStatus":0,"desiccantLeftDays":6,
        //         "errorPriority":0,"feeding":0,"food":1,"ota":0,"overall":1,
        //         "pim":1,"runtime":49677,"wifi":{
        //             "bssid":"xxxxxxxxxxxx","rsq":-37,"ssid":"xxxxxxxxxx"
        //         }
        //     }
        // }
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').deviceState;
        const url = format(url_template, deviceId);
        const options = Object.assign(globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json'
        });
        return await this.http_request(options);
    }

    // date：20200920、time: 68400(-1 stand for current)、amount in app unit，1 for 5g, 10 is max(50g)
    async http_saveDailyFeed(petkitDevice, amount, time) {
        const date = getDataString();
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').saveDailyFeed;
        const url = format(url_template, deviceId, date, time, amount * 5);
        const options = Object.assign(globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json'
        });
        return await this.http_request(options);
    }

    // key see support_settings.
    async http_updateDeviceSettings(petkitDevice, key, value) {
        const setting_key = globalVariables.support_settings[key];
        if (setting_key !== undefined) {
            let data = {};
            data[setting_key] = value;
            const deviceId = petkitDevice.config.get('deviceId');
            const url_template = petkitDevice.config.get('urls').updateSettings;
            const url = format(url_template, deviceId, JSON.stringify(data));
            const options = Object.assign(globalVariables.default_http_options, {
                url: url,
                headers: petkitDevice.config.get('headers'),
                responseType: 'json'
            });
            return await this.http_request(options);
        } else {
            this.log.warn('unsupport setting: ' + key);
            return false;
        }
    }

    async http_resetDesiccant(petkitDevice) {
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').resetDesiccant;
        const url = format(url_template, deviceId);
        const options = Object.assign(globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json'
        });
        return await this.http_request(options);
    }

    async http_getDeviceDetailStatus(petkitDevice, callback) {
        let deviceDetailInfo = undefined;
        this.http_getDeviceInfo(petkitDevice)
        .then(device_detail_raw => {
            deviceDetailInfo = this.praseGetDeviceDetailInfo(device_detail_raw);
        })
        .catch(error => {
            this.log.error(format('unable to get device({}) status: {}', petkitDevice.config.get('deviceId'), error));
        })
        .then(() => {
            if (deviceDetailInfo) {
                petkitDevice.status = Object.assign(petkitDevice.status, deviceDetailInfo.status);
                petkitDevice.status.lastUpdate = getTimestamp();
            }
            if (callback) callback(deviceDetailInfo);
        });
    }
    
    uploadStatusToHomebridge(petkitDevice) {
        let service = undefined;
        let service_status = undefined;

        this.log.debug(JSON.stringify(petkitDevice.status));

        // battery service only for Petkit Feeder Mini
        if (petkitDevice.config.get('model') === 'FeederMini') {        
            // battery
            service = petkitDevice.services.battery_status_service;
            // battery level
            service_status = petkitDevice.status.batteryPower * globalVariables.config.batteryPersentPerLevel;
            this.log.info(format('battery level is {}%.', service_status));
            service.setCharacteristic(Characteristic.BatteryLevel, service_status);
            
            // charging state
            if (petkitDevice.status.batteryStatus === 0) {
                service_status = Characteristic.ChargingState.CHARGING;
                this.log.info('battery is charging.');
            } else {
                service_status = Characteristic.ChargingState.NOT_CHARGING;
                this.log.info('battery is not charging.');
            }
            service.setCharacteristic(Characteristic.ChargingState, service_status);

            // low battery status
            if (petkitDevice.status.batteryStatus !== 0 &&
                !petkitDevice.config.get('ignore_battery_when_charging') &&
                petkitDevice.status.batteryPower * globalVariables.config.batteryPersentPerLevel <= 50) {
                service_status = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
                this.log.info('battery level status is low');
            } else {
                service_status = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
                this.log.info('battery level status is normal');
            }
            service.setCharacteristic(Characteristic.StatusLowBattery, service_status);
        }


        // manualLock
        if (petkitDevice.config.get('enable_manualLock')) {
            service = petkitDevice.services.manualLock_service;
            service_status = petkitDevice.status.manualLock === 0;

            this.log.info(format('manualLock status is {}.', service_status ? 'on' : 'off'));
            const current_status = service.getCharacteristic(Characteristic.On).value;
            if (current_status != service_status) {
                service.setCharacteristic(Characteristic.On, service_status);
            }
        } else {
            this.log.info('manualLock function is disabled.');
        }

        // lightMode
        if (petkitDevice.config.get('enable_lightMode')) {
            service = petkitDevice.services.lightMode_service;
            service_status = petkitDevice.status.lightMode;

            this.log.info(format('lightMode status is {}.', service_status ? 'on' : 'off'));
            const current_status = service.getCharacteristic(Characteristic.On).value;
            if (current_status != service_status) {
                service.setCharacteristic(Characteristic.On, service_status);
            }
        } else {
            this.log.info('lightMode function is disabled.');
        }

        // food
        service = petkitDevice.services.food_storage_service;
        if (petkitDevice.config.get('model') === 'Feeder') {
            if (petkitDevice.status.food > globalVariables.config.foodStorage_alerm_threshold) {
                this.log.info('there is enough food left.');
            } else {
                this.log.warn('there is not enough food left !!!');
            }
        }
        else if(petkitDevice.config.get('model') === 'FeederMini') {
            if (petkitDevice.status.food == 0) {
                this.log.warn('there is not enough food left !!!');
            } else {
                this.log.info('there is enough food left.');
            }
        }
        service_status = petkitDevice.getFoodStatusForHomebridge();
        service.setCharacteristic(Characteristic.OccupancyDetected, service_status);

        // desiccant
        if (petkitDevice.config.get('enable_desiccant')) {
            service = petkitDevice.services.desiccant_level_service;
            if (petkitDevice.status.desiccantLeftDays < petkitDevice.config.get('alert_desiccant_threshold')) {
                if (petkitDevice.config.get('enable_autoreset_desiccant')) {
                    service_status = Characteristic.FilterChangeIndication.CHANGE_FILTER;
                    this.log.info(format('desiccant only {} day(s) left, reset it.', petkitDevice.status.desiccantLeftDays));
                    this.hb_desiccantLeftDays_reset(petkitDevice, () => {
                        service.setCharacteristic(Characteristic.FilterChangeIndication, Characteristic.FilterChangeIndication.FILTER_OK);
                    });
                } else {
                    this.log.info('desiccant auto reset function is disabled.');
                }
            } else {
                this.log.info(format('desiccant has {} days left, no need to reset.', petkitDevice.status.desiccantLeftDays));
                service_status = Characteristic.FilterChangeIndication.FILTER_OK;
            }
            service.setCharacteristic(Characteristic.FilterChangeIndication, service_status);
        } else {
            this.log.info('desiccant service is disabled');
        }
    }

    setupPolling(petkitDevice) {
        if (petkitDevice.config.get('enable_polling')) {
            const polling_interval_ms = petkitDevice.config.get('polling_interval') * 1000;
            const polling_options = {
                longpolling: true,
                interval: polling_interval_ms,
                longpollEventName: 'deviceStatusUpdatePoll'
            };
    
            setTimeout(() => {
                petkitDevice.events.polling_event = pollingtoevent(done => {
                    this.log.info('polling start...');
                    this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                        this.uploadStatusToHomebridge(petkitDevice);
                        this.log.info('polling end...');
                        done();
                    });
                }, polling_options);
            }, polling_interval_ms)
        } else {
            this.log.warn('polling is disabled.');
        }
    }

    hb_handle_set_deviceSettings(petkitDevice, settingName, status, callback = null) {
        let result = false;
        this.http_updateDeviceSettings(petkitDevice, settingName, status)
            .then(data => {
                if (!data) {
                    this.log.error('failed to commuciate with server.');
                } else if (this.praseUpdateDeviceSettingsResult(data)) {
                    result = true;
                    petkitDevice.status[settingName] = status;
                }
            }).catch(error => {
                this.log.error(error);
            }).then(() => {
                if (callback) callback(result);
                // this.updataDeviceDetail();
            });
    }

    hb_mealAmount_set(petkitDevice, value, callback) {
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response) callback(null);
        petkitDevice.savedData.mealAmount = value;
        petkitDevice.save();
        this.log.info('set meal amount to ' + value);
        if (!fast_response) callback(null);
    }

    hb_dropMeal_set(petkitDevice, value, callback) {
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response) callback(null);
        if (value) {
            if (petkitDevice.savedData.mealAmount) {
                this.log.info(format('drop food:{} meal(s)', petkitDevice.savedData.mealAmount));

                var result = false;
                this.http_saveDailyFeed(petkitDevice, petkitDevice.savedData.mealAmount, -1)
                    .then(data => {
                        if (!data) {
                            this.log.error('failed to commuciate with server.');
                        } else {
                            result = this.praseSaveDailyFeedResult(data);
                            this.log.info('food drop result: ' + result ? 'success' : 'failed');
                        }
                    })
                    .catch(error => {
                        this.log.error('food drop failed: ' + error);
                    })
                    .then(() => {
                        if (!fast_response) callback(null);
                    });
            } else {
                this.log.info('drop food with zero amount, pass.');
            }
            
            setTimeout(() => {
                petkitDevice.services.drop_meal_service.setCharacteristic(Characteristic.On, false);
            }, 200);

            setTimeout(() => {
                this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                    this.uploadStatusToHomebridge(petkitDevice);
                })
            }, 1000);
        }
        // this.updataDeviceDetail();
    }

    hb_desiccantIndicator_get(petkitDevice, callback) {
        const status = (petkitDevice.status.desiccantLeftDays < petkitDevice.config.get(' ') ? 1 : 0);
        callback(null, status);
    }

    hb_desiccantLeftDays_get(petkitDevice, callback) {
        const status = petkitDevice.status.desiccantLeftDays;
        callback(null, status);
    }

    // reset Desiccant Left Days 
    hb_desiccantLeftDays_reset(petkitDevice, callback) {
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response && callback) {callback(null);}
        this.http_resetDesiccant(petkitDevice)
            .then(data => {
                if (data && data.result) {
                    petkitDevice.status.desiccantLeftDays = data.result;
                    this.log.info(format('reset desiccant left days success, reset to {} days', data.result));
                } else {
                    this.log.warn('reset desiccant left days with a unrecognizable reply.');
                }
            })
            .catch(error => {
                this.log.error('reset desiccant left days failed: ' + error);
            })
            .then(() => {
                if (!fast_response && callback) callback(null);
                setTimeout(() => {
                    this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                        this.uploadStatusToHomebridge(petkitDevice);
                    })
                }, 1000);
            });
    }

    hb_foodStorageStatus_get(petkitDevice, callback) {
        const status = petkitDevice.getFoodStatusForHomebridge();
        callback(null, status);
    }

    hb_manualLockStatus_get(petkitDevice, callback) {
        const status = petkitDevice.status.manualLock ? 0 : 1;
        callback(null, status);
    }

    hb_manualLockStatus_set(petkitDevice, value, callback) {
        const settingName = 'manualLock';
        const settingValue = (value ? 0 : 1);
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response) callback(null);
        this.log.debug(format('set {} to: {}', settingName, settingValue));
        this.hb_handle_set_deviceSettings(petkitDevice, settingName, settingValue, result => {
            if (result) {
                this.log.info(format('set {} to: {}, success', settingName, settingValue));
            } else {
                this.log.warn(format('set {} to: {}, failed', settingName, settingValue));
            }
            if (!fast_response) callback(null);
            setTimeout(() => {
                this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                    this.uploadStatusToHomebridge(petkitDevice);
                })
            }, 1000);
        });
    }

    hb_lightModeStatus_get(petkitDevice, callback) {
        const status = petkitDevice.status.lightMode;
        callback(null, status);

        // this.hb_handle_get(petkitDevice, 'hb_lightModeStatus_get', results => {
        //     const status = petkitDevice.status.lightMode;
        //     callback(null, status);
        // });
    }

    hb_lightModeStatus_set(petkitDevice, value, callback) {
        const settingName = 'lightMode';
        const settingValue = value;
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response) callback(null);
        this.log.debug(format('set {} to: {}', settingName, settingValue));
        this.hb_handle_set_deviceSettings(petkitDevice, settingName, settingValue, result => {
            if (result) {
                this.log.info(format('set {} to: {}, success', settingName, settingValue));
            } else {
                this.log.warn(format('set {} to: {}, failed', settingName, settingValue));
            }
            if (!fast_response) callback(null);
            setTimeout(() => {
                this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                    this.uploadStatusToHomebridge(petkitDevice);
                })
            }, 1000);
        });
    }

    hb_deviceBatteryLevel_get(petkitDevice, callback) {
        const status = petkitDevice.status.batteryPower * globalVariables.config.batteryPersentPerLevel;
        callback(null, status);
    }

    hb_deviceChargingState_get(petkitDevice, callback) {
        const status = (petkitDevice.status.batteryStatus === 0 ?
            Characteristic.ChargingState.CHARGING :
            Characteristic.ChargingState.NOT_CHARGING);
        callback(null, status);
    }

    hb_deviceStatusLowBattery_get(petkitDevice, callback) {
        const status = petkitDevice.status.batteryPower * globalVariables.config.batteryPersentPerLevel < 50 ?
            Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
            Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        callback(null, status);
    }
};

module.exports = function (homebridge) {
    PlatformAccessory = homebridge.platformAccessory;
    Accessory = homebridge.hap.Accessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform(pluginName, platformName, petkit_feeder_plugin, true);
};
