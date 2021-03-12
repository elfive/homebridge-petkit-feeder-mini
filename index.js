'use strict';

let PlatformAccessory, Accessory, Service, Characteristic, UUIDGen;


const logUtil = require('./utils/log');
const configUtil = require('./utils/config');

const pluginName = 'homebridge-petkit-feeder-mini';
const platformName = 'petkit_feeder_mini';

const globalVariables = Object.freeze({
    'default_headers': {
        'X-Client': 'ios(14.0;iPhone12,3)',
        'Accept': '*/*',
        'X-Timezone': '8.0',
        'Accept-Language': 'en-US;q=1, zh-Hans-US;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'X-Api-Version': '7.18.1',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'PETKIT/7.18.1 (iPhone; iOS 14.0; Scale/3.00)',
        'X-TimezoneId': 'Asia/Shanghai',
        'X-Locale': 'en_US'
    },
    'support_settings': {
        'manualLock' : 'settings.manualLock',      // 1 for off, 0 for on
        'lightMode' : 'settings.lightMode',
    },
    'global_urls': {
        'cn': {
            'owndevices': 'http://api.petkit.cn/6/discovery/device_roster',
            'deviceState': 'http://api.petkit.cn/6/feedermini/devicestate?id={}',
            'deviceDetail': 'http://api.petkit.cn/6/feedermini/device_detail?id={}',
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
            'deviceDetail': 'http://api.petktasia.com/latest/feedermini/device_detail?id={}',
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
            'deviceDetail': 'http://api.petkt.com/latest/feedermini/device_detail?id={}',
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
        this.log = new logUtil(log, this.config.fulfill('log_level', logUtil.LOGLV_INFO));
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
        const conf = new configUtil(config);
        


        return conf;
    }

    // REQUIRED - Homebridge will call the "configureAccessory" method once for every cached accessory restored
    // This function is invoked when homebridge restores cached accessories from disk at startup.
    // It should be used to setup event handlers for characteristics and update respective values.
    configureAccessory(accessory) {
        this.log.info('Configuring cached accessory: [' + accessory.displayName + ']  ' + accessory.UUID);
        const accessoryData = {
            'accessory': accessory,
            'config' : undefined,
            'status': undefined
        };
        this.accessories.set(accessory.UUID, accessoryData);
    }

    setupAccessory(accessoryData) {
        let accessory = accessoryData.accessory;
        let config = accessoryData.config;  // instance of configUtil
        let status = accessoryData.status;

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
                .on('set', this.hb_dropMeal_set.bind(this));
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
                .on('set', this.hb_mealAmount_set.bind(this))
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

            food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, this.deviceDetailInfo['food'])
            food_storage_service.getCharacteristic(Characteristic.OccupancyDetected)
                .on('get', this.hb_foodStorageStatus_get.bind(this));
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
                (this.deviceDetailInfo['desiccantLeftDays'] < this.alert_desiccant_threshold ? 1 : 0));
            desiccant_level_service.getCharacteristic(Characteristic.FilterChangeIndication)
                .on('get', this.hb_desiccantIndicator_get.bind(this));

            desiccant_level_service.setCharacteristic(Characteristic.FilterLifeLevel, this.deviceDetailInfo['desiccantLeftDays']);
            desiccant_level_service.getCharacteristic(Characteristic.FilterLifeLevel)
                .on('get', this.hb_desiccantLeftDays_get.bind(this))
                .setProps({
                    minValue: globalVariables.min_desiccantLeftDays,
                    maxValue: globalVariables.max_desiccantLeftDays,
                    minStep: 1
                });

            desiccant_level_service.getCharacteristic(Characteristic.ResetFilterIndication)
                .on('set', this.hb_desiccantLeftDays_reset.bind(this));
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

            manualLock_service.setCharacteristic(Characteristic.On, this.deviceDetailInfo['manualLock']);
            manualLock_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_manualLockStatus_get.bind(this))
                .on('set', this.hb_manualLockStatus_set.bind(this));
        }

        // setup lightMode setting service
        if (config.get('enable_lightMode')) {
            service_name = config.get('LightMode_name');
            let lightMode_service = accessory.getService(service_name);
            if (!lightMode_service) {
                // service not exist, create service
                lightMode_service = accessory.addService(Service.OccupancySensor, service_name, service_name);
                if (!lightMode_service) {
                    this.log.error('petkit device service create failed: lightMode_service');
                    return false;
                }
            }

            lightMode_service.setCharacteristic(Characteristic.On, this.deviceDetailInfo['manualLock']);
            lightMode_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_manualLockStatus_get.bind(this))
                .on('set', this.hb_manualLockStatus_set.bind(this));
        }

        // setup battery status service
        if (true) {
            service_name = config.get('Battery_name');
            let battery_status_service = accessory.getService(service_name);
            if (!battery_status_service) {
                // service not exist, create service
                battery_status_service = accessory.addService(Service.OccupancySensor, service_name, service_name);
                if (!battery_status_service) {
                    this.log.error('petkit device service create failed: battery_status_service');
                    return false;
                }
            }

            battery_status_service.setCharacteristic(Characteristic.BatteryLevel, this.deviceDetailInfo['batteryPower']);
            battery_status_service.getCharacteristic(Characteristic.BatteryLevel)
                .on('get', this.hb_deviceBatteryLevel_get.bind(this));

            battery_status_service.setCharacteristic(Characteristic.ChargingState, (this.deviceDetailInfo['batteryStatus'] == 0 ?
                Characteristic.ChargingState.CHARGING :
                Characteristic.ChargingState.NOT_CHARGING));
            battery_status_service.getCharacteristic(Characteristic.ChargingState)
                .on('get', this.hb_deviceChargingState_get.bind(this));

            battery_status_service.setCharacteristic(Characteristic.StatusLowBattery, (this.deviceDetailInfo['batteryPower'] <= 50 ?
                Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
                Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL));
            battery_status_service.getCharacteristic(Characteristic.StatusLowBattery)
                .on('get', this.hb_deviceStatusLowBattery_get.bind(this));
        }

        // setup divice information service
        if (true) {
            service_name = 'info_service';
            let info_service = accessory.getService(service_name);
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

            accessoryData = {
                'accessory': accessory,
                'config' : config,
                'status': undefined
            }
        } else if (!accessoryData.accessory) {
            // accessory not exists, create accessory
            let accessory = new this.api.platformAccessory(accessoryName, uuid, accessoryName);
            if (!accessory) {
                this.log.error('petkit device service create failed: accessory');
                return;
            }
            accessoryData.accessory = accessory;
            accessoryData.config = config;
        } else {
            accessoryData.config = config;
        }

        if (this.setupAccessory(accessoryData)) {
            // all service setup success, now update accessory
            this.accessories.set(uuid, accessory);
            this.api.registerPlatformAccessories(pluginName, platformName, [accessory]);
        }
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
